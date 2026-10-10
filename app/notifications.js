import { api } from "./api.js";
import { el, button, showDialog, loading } from "./ui.js";
import { notificationLabel as label } from "./notification-labels.js";
export async function openNotifications(titleId = null) {
  const content = el("div", {class:"dialog-body notification-editor"}, el("h2",{id:"dialog-title"},label(titleId===null?"NotificationsAccount":"NotificationsSeries")),loading());
  const dialog=showDialog(content),cancel=new AbortController();
  const revoked=()=>dialog.close();window.addEventListener("movly-offline-revoked",revoked);
  dialog.addEventListener("close",()=>window.removeEventListener("movly-offline-revoked",revoked),{once:true});
  dialog.addEventListener("close",()=>cancel.abort(),{once:true});
  const scope=titleId===null?"defaults":`series/${Number(titleId)}`;
  let busy=false,owner;
  const status=el("p",{role:"status"});
  async function render() {
    content.replaceChildren(el("h2",{id:"dialog-title"},label(titleId===null?"NotificationsAccount":"NotificationsSeries")),status,loading());
    try {
      // Freeze authenticated ownership for all subsequent mutations.
      const session=await api("session",{signal:cancel.signal});
      owner={accountId:session.account?.id,profileId:session.profile?.id??session.selected_profile_id};
      const snapshot=await api(`notifications/${scope}`,{signal:cancel.signal});
      if(!dialog.open)return;
      content.lastChild.remove();
      let custom=structuredClone(snapshot.preferences),inherit=titleId!==null&&custom.use_defaults;
      const choices=el("div",{class:"dialog-form"});
      const inherited=el("input",{type:"checkbox",checked:inherit});
      inherited.addEventListener("change",()=>{inherit=inherited.checked;draw();});
      if(titleId!==null)content.append(el("label",{class:"notification-choice"},inherited,label("NotificationsUseDefaults")),el("p",{},label("NotificationsInheritanceHelp")));
      content.append(choices);
      function draw() {
        choices.replaceChildren();
        const displayed=inherit?snapshot.defaults:custom;
        for(const [field,keys,title] of [["events",["episode_released","stream_available","czsk_available"],"NotificationsEvents"],["channels",["in_app","mobile_push","desktop","email"],"NotificationsChannels"]]) {
          const group=el("fieldset",{},el("legend",{},label(title)));
          for(const key of keys) {
            const input=el("input",{type:"checkbox",checked:displayed[field].includes(key),disabled:inherit||busy});
            input.addEventListener("change",()=>{custom[field]=custom[field].filter(value=>value!==key);if(input.checked)custom[field].push(key);status.textContent="";});
            group.append(el("label",{class:"notification-choice"},input,label("Notifications_"+key)));
            if(field==="channels"&&snapshot.capabilities[key]!==true)group.append(el("p",{class:"muted"},label("NotificationsUnconfigured")));
          }
          choices.append(group);
        }
      }
      draw();content.append(el("p",{},label("NotificationsFutureOnly")),el("p",{},label("NotificationsDesktopHelp")));
      if("Notification" in window)content.append(button(label("NotificationsPermission"),async()=>{
        const permission=await Notification.requestPermission();status.textContent=label(permission==="granted"?"NotificationsPermissionAllowed":"NotificationsPermissionDenied");
      }));
      const save=button(label("NotificationsSave"),async()=>{
        if(busy)return;busy=true;save.disabled=true;inherited.disabled=true;draw();
        try {
          await api(`notifications/${scope}`,{method:"PUT",body:{...custom,use_defaults:inherit},signal:cancel.signal,expectedOwner:owner});
          if(dialog.open)status.textContent=label("NotificationsSaved");
        }catch(error){if(!cancel.signal.aborted)status.textContent=error.message;}
        finally{busy=false;save.disabled=false;inherited.disabled=false;draw();}
      });
      content.append(save);
      if(titleId===null) {
        const inbox=await api("notifications/inbox",{signal:cancel.signal});if(!dialog.open)return;
        content.append(el("h3",{},label("NotificationsInbox")));
        for(const item of inbox.items)content.append(button(item.message,async()=>{
          await api(`notifications/inbox/${item.id}/read`,{method:"PUT",body:{},signal:cancel.signal,expectedOwner:owner});
          dialog.close();
          const {detail}=await import("./library.js");const data=await api(`titles/${item.title_id}`);await detail(data,{save:()=>{}});
        }));
        if(!inbox.items.length)content.append(el("p",{},label("NotificationsEmpty")));
      }
    }catch(error){if(!cancel.signal.aborted){content.querySelector(".loading")?.remove();status.textContent=error.message;content.append(button(label("NotificationsRetry"),render));}}
  }
  await render();
}

export function startSystemNotifications(actions) {
  let running=false,revision=0;
  window.addEventListener("movly-offline-revoked",()=>{revision++;});
  async function poll() {
    if(running||!("Notification" in window)||Notification.permission!=="granted")return;
    running=true;const expectedRevision=revision;
    try {
      const session=await api("session");
      const owner={accountId:session.account.id,profileId:session.profile?.id};
      const key=`movly.notifications.web.${session.account.id}`;
      const seen=new Set(JSON.parse(localStorage.getItem(key)||"[]"));
      const inbox=await api("notifications/system-inbox",{expectedOwner:owner});
      if(revision!==expectedRevision)return;
      for(const item of [...inbox.items].reverse()) {
        if(seen.has(item.id)||revision!==expectedRevision)continue;
        const alert=new Notification("Movly",{body:item.message,tag:`movly-${session.account.id}-${item.id}`});
        alert.onclick=async()=>{alert.close();if(revision!==expectedRevision)return;window.focus();const data=await api(`titles/${item.title_id}`,{expectedOwner:owner});const {detail}=await import("./library.js");await detail(data,actions);};
        seen.add(item.id);localStorage.setItem(key,JSON.stringify([...seen].slice(-500)));
        await api(`notifications/system-inbox/${item.id}/delivered`,{method:"PUT",body:{},expectedOwner:owner});
      }
    }catch{ /* Unauthenticated/offline requests retry without showing cached content. */ }
    finally{running=false;}
  }
  const timer=setInterval(poll,60_000);window.addEventListener("pagehide",()=>clearInterval(timer),{once:true});void poll();
}

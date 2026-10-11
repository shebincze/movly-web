import { api } from "./api.js";
import { el, button, showDialog, loading } from "./ui.js";
import { notificationLabel as label } from "./notification-labels.js";
export const notificationEvents = ["episode_released", "stream_available", "czsk_available"];
export const notificationChannels = ["in_app", "mobile_push", "desktop", "email"];
export const notificationsEnabled = snapshot => snapshot.subscribed === true && snapshot.effective.events.length > 0 && snapshot.effective.channels.length > 0;
let activeEditor;
export async function openNotifications(titleId = null, draft = null, afterClose = null) {
  activeEditor?.abort();
  const cancel = activeEditor = new AbortController();
  const account = titleId === null;
  const content = el("div", {class:"dialog-body notification-editor"}, el("h2",{id:"dialog-title"},label(account ? "NotificationsAccount" : "NotificationsSeries")), loading());
  const dialog = showDialog(content);
  const scope = account ? "defaults" : `series/${Number(titleId)}`;
  const revoked = () => { cancel.abort(); dialog.close(); };
  window.addEventListener("movly-offline-revoked", revoked);
  dialog.addEventListener("close", () => {
    window.removeEventListener("movly-offline-revoked", revoked);
    const wasActive = activeEditor === cancel && !cancel.signal.aborted;
    cancel.abort();
    if (wasActive && !transitioning) afterClose?.();
  }, {once:true,signal:cancel.signal});
  cancel.signal.addEventListener("abort",()=>window.removeEventListener("movly-offline-revoked",revoked),{once:true});
  const status = el("p", {role:"status",class:"notification-status"});
  let busy = false, transitioning = false;
  const current = () => !cancel.signal.aborted && dialog.open && content.isConnected;
  try {
    const session = await api("session", {signal:cancel.signal});
    const owner = {accountId:session.account?.id,profileId:session.profile?.id ?? session.selected_profile_id};
    const snapshot = await api(`notifications/${scope}`, {signal:cancel.signal,expectedOwner:owner});
    if (!current()) return;
    const fields = account ? notificationChannels : notificationEvents;
    let selected = [...(draft ?? (account ? snapshot.preferences.channels : snapshot.effective.events.length ? snapshot.effective.events : snapshot.defaults.events.length ? snapshot.defaults.events : ["stream_available"]))];
    const heading = el("h2", {id:"dialog-title"}, label(account ? "NotificationsAccount" : "NotificationsSeries"));
    const group = el("fieldset", {class:"notification-group"}, el("legend", {},label(account ? "NotificationsChannels" : "NotificationsEvents")));
    content.replaceChildren(heading,status,group);
    const inputs = [];
    const save = button(label(account ? "NotificationsSave" : snapshot.subscribed ? "NotificationsSave" : "NotificationsEnable"), () => persist(false), "primary");
    const update = () => { save.disabled = busy || (!account && (!selected.length || !snapshot.defaults.channels.length)); };
    for (const key of fields) {
      const input = el("input", {type:"checkbox",role:"switch",checked:selected.includes(key)});
      inputs.push(input);
      input.addEventListener("change", () => { selected = selected.filter(value => value !== key); if(input.checked) selected.push(key);status.textContent="";update(); });
      group.append(el("label",{class:"notification-choice"},el("span",{},label("Notifications_"+key)),input));
      if(account && snapshot.capabilities[key] !== true) group.append(el("p",{class:"muted"},label("NotificationsUnconfigured")));
    }
    if(!account) {
      content.append(el("p",{class:"muted"},label("NotificationsFutureOnly")),el("p",{class:"muted"},label("NotificationsAccountDeliveryHelp")));
      if(!snapshot.defaults.channels.length) content.append(el("p",{class:"notification-warning"},label("NotificationsChooseDelivery")));
      content.append(button(label("NotificationsAccount"), () => {
        if(busy)return;
        const retained = [...selected];
        transitioning = true;
        void openNotifications(null,null,()=>void openNotifications(titleId,retained,afterClose));
      }, "secondary"));
    } else {
      content.append(el("p",{class:"muted"},label("NotificationsDesktopHelp")));
      if("Notification" in window) {
        const permission = el("p",{class:"muted"});
        const refresh = () => { permission.textContent = label(Notification.permission === "granted" ? "NotificationsPermissionAllowed" : Notification.permission === "denied" ? "NotificationsPermissionDenied" : "NotificationsPermissionPending"); };
        refresh();
        window.addEventListener("focus",refresh,{signal:cancel.signal});
        content.append(button(label("NotificationsPermission"),async()=>{ await Notification.requestPermission(); if(current()) refresh(); },"secondary"),permission);
      }
    }
    const disable = !account && snapshot.subscribed ? button(label("NotificationsDisable"),()=>persist(true),"secondary") : null;
    const actions = el("div",{class:"notification-actions"},save,disable,button(label("NotificationsCancel"),()=>dialog.close(),"secondary"));
    content.append(actions); update();
    async function persist(off) {
      if(busy || !current()) return;
      busy=true; inputs.forEach(input=>input.disabled=true); if(disable)disable.disabled=true;update();
      try {
        await api(`notifications/${scope}`, {method:"PUT",body:{events:account ? snapshot.preferences.events : off ? [] : selected,channels:account ? selected : [],use_defaults:false},signal:cancel.signal,expectedOwner:owner});
        if(!current())return;
        window.dispatchEvent(new CustomEvent("movly-notification-preferences-changed"));
        dialog.close();
      } catch(error) { if(current())status.textContent=error.message; }
      finally { busy=false;inputs.forEach(input=>input.disabled=false);if(disable)disable.disabled=false;update(); }
    }
    if(account) {
      const inbox = await api("notifications/inbox",{signal:cancel.signal,expectedOwner:owner});
      if(!current())return;
      content.append(el("h3",{},label("NotificationsInbox")));
      for(const item of inbox.items) content.append(button(item.message,async()=>{
        await api(`notifications/inbox/${item.id}/read`,{method:"PUT",body:{},signal:cancel.signal,expectedOwner:owner});
        if(!current())return;
        dialog.close();
        const data=await api(`titles/${item.title_id}`,{expectedOwner:owner});
        const {detail}=await import("./library.js");await detail(data,{save:()=>{}});
      }));
      if(!inbox.items.length)content.append(el("p",{},label("NotificationsEmpty")));
    }
  }catch(error){if(current()){content.querySelector(".loading")?.remove();status.textContent=error.message;content.append(status,button(label("NotificationsRetry"),()=>void openNotifications(titleId,draft,afterClose)));}}
}

export function seriesNotificationButton(titleId, afterClose = null) {
  const control = button(label("NotificationsEntry"),()=>void openNotifications(titleId,null,afterClose),"secondary");
  let revision=0;
  async function refresh() {
    const request=++revision;
    control.textContent=label("NotificationsEntry");control.removeAttribute("aria-pressed");
    try {
      const session=await api("session");
      const owner={accountId:session.account?.id,profileId:session.profile?.id ?? session.selected_profile_id};
      const snapshot=await api(`notifications/series/${Number(titleId)}`,{expectedOwner:owner});
      if(request!==revision || !control.isConnected)return;
      const enabled=notificationsEnabled(snapshot);
      control.textContent=label(enabled ? "NotificationsOn" : "NotificationsOff");
      control.setAttribute("aria-pressed",String(enabled));control.classList.toggle("notifications-on",enabled);
    }catch{ /* Unknown state stays neutral; never present a failed read as disabled. */ }
  }
  const changed=()=>{if(control.isConnected)void refresh();else window.removeEventListener("movly-notification-preferences-changed",changed);};
  window.addEventListener("movly-notification-preferences-changed",changed);
  const revoked=()=>{revision++;control.textContent=label("NotificationsEntry");control.removeAttribute("aria-pressed");control.classList.remove("notifications-on");window.removeEventListener("movly-notification-preferences-changed",changed);};
  window.addEventListener("movly-offline-revoked",revoked,{once:true});
  document.querySelector("#dialog").addEventListener("close",()=>{revision++;window.removeEventListener("movly-notification-preferences-changed",changed);window.removeEventListener("movly-offline-revoked",revoked);},{once:true});
  void refresh();return control;
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

import { translateUI } from "./i18n.js";
import { api, apiContextKey } from "./api.js";
import { el, button, showDialog, toast } from "./ui.js";
import { playbackOwner } from "./playback-memory.js";
import { IntroSkipMachine, chapterIntros, readIntroCache, writeIntroCache } from "./intro-skip-policy.js";
const modes = { off:"Vypnuto", manual:"Nabízet přeskočení", auto:"Automaticky" };
const scopeKey = scope => `${scope?.accountId}.${scope?.profileId}`;
function cachedMode(scope) { try { return localStorage.getItem("movly.intro.mode."+scopeKey(scope)) || "manual"; } catch {return "manual";} }
function storeMode(scope, mode) { try {localStorage.setItem("movly.intro.mode."+scopeKey(scope), mode);} catch {} }
export async function openIntroSettings() {
  const scope=playbackOwner(), revision=apiContextKey();
  const select=el("select", {"aria-label":translateUI("Přeskakování intra")}, ...Object.entries(modes).map(([value,label])=>el("option",{value},translateUI(label))));
  const status=el("p",{role:"status"});select.value=cachedMode(scope);select.disabled=true;
  showDialog(el("div",{class:"dialog-body"},el("h2",{id:"dialog-title"},translateUI("Přeskakování intra")),select,status));
  try {const value=await api("playback/preferences",{expectedOwner:scope});if(revision!==apiContextKey())return;select.value=value.intro_skip_mode;storeMode(scope,value.intro_skip_mode);} catch {status.textContent=translateUI("Nastavení se nepodařilo synchronizovat.");} finally {select.disabled=!scope;}
  select.addEventListener("change",async()=>{
    if(revision!==apiContextKey())return;select.disabled=true;
    try {const saved=await api("playback/preferences",{method:"PUT",body:{intro_skip_mode:select.value},expectedOwner:scope});if(revision!==apiContextKey())return;storeMode(scope,saved.intro_skip_mode);status.textContent=translateUI("Uloženo.");}
    catch {select.value=cachedMode(scope);status.textContent=translateUI("Změna nebyla uložena. Zkus to znovu.");}finally{select.disabled=false;}
  });
}
export function mountIntroSkip({container,scope,title,episode,duration,position,playing,canSeek,seek,chapters=[],current,offline=false,machine=new IntroSkipMachine()}) {
  let mode=cachedMode(scope), response=null, closed=false, loading=false;
  const revision=apiContextKey(), abort=new AbortController();
  const permitted=()=>!closed && current() && revision===apiContextKey() && canSeek();
  const jump=target=>{if(target!==null && permitted())Promise.resolve(seek(target/1000,machine)).catch(e=>toast(e.message));};
  const skip=button(translateUI("Přeskočit intro"),()=>jump(machine.request(Math.round(position()*1000),performance.now())),"small");
  const cancel=button(translateUI("Nepřeskakovat"),()=>machine.cancel(),"small");
  const undo=button(translateUI("Vrátit přeskočení"),()=>jump(machine.undo()),"small");
  container.append(undo,skip,cancel);
  const key=`${scopeKey(scope)}.${title}.${episode?.season_number}.${episode?.episode_number}.${Math.floor(duration)}`;
  response=readIntroCache(localStorage,key);
  const load=async()=>{
    if(loading || offline || !scope || !episode || !Number.isFinite(duration)||duration<5||duration>21600)return;
    loading=true;
    try {
    try {const p=await api("playback/preferences",{expectedOwner:scope,signal:abort.signal});if(closed||revision!==apiContextKey())return;mode=p.intro_skip_mode;storeMode(scope,mode);}catch{}
    if(closed||mode==="off"||response&&!response.stale&&response.expires_at*1000>Date.now())return;
    const q=new URLSearchParams({title_id:title,season:episode.season_number,episode:episode.episode_number,duration_ms:Math.round(duration*1000)});
    try {const value=await api("playback/segments?"+q,{expectedOwner:scope,signal:abort.signal});if(closed||revision!==apiContextKey())return;if(!Array.isArray(value.segments))return;response=value;writeIntroCache(localStorage,key,value);}catch{}
    } finally {loading=false;}
  };
  void load();
  const tick=()=>{
    const selected=cachedMode(scope);
    if(mode==="off"&&selected!=="off")void load();
    mode=selected;
    const local=chapterIntros(chapters);
    const remote=response?.expires_at*1000>Date.now()&&!response?.stale ? response?.segments||[] : (response?.segments||[]).map(s=>({...s,auto_eligible:false}));
    const segments=local.length?local:remote;
    const target=machine.tick({position:Math.round(position()*1000),duration:Math.round(duration*1000),now:performance.now(),playing:playing(),canSeek:permitted(),mode,segments});
    skip.hidden=!machine.offer;skip.textContent=machine.countdown===null?translateUI("Přeskočit intro"):translateUI("Přeskočit intro za {0} s",machine.countdown);
    skip.disabled=cancel.disabled=undo.disabled=!permitted();
    cancel.hidden=machine.countdown===null;undo.hidden=machine.undoPosition===null;container.hidden=skip.hidden&&undo.hidden;
    jump(target);
  };
  tick();const timer=setInterval(tick,250);
  return ()=>{closed=true;abort.abort();clearInterval(timer);container.remove();};
}

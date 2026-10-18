import { translateUI } from "./i18n.js";
import { api, apiContextKey } from "./api.js";
import { el, button, showDialog, toast } from "./ui.js";
import { playbackOwner } from "./playback-memory.js";
import { IntroSkipMachine, creditsOffer, mergeChapterIntros, readIntroCache, writeIntroCache } from "./intro-skip-policy.js";
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
const skipLabel = (kind, countdown) => kind === "recap"
  ? countdown === null ? translateUI("Přeskočit rekapitulaci") : translateUI("Přeskočit rekapitulaci za {0} s", countdown)
  : countdown === null ? translateUI("Přeskočit intro") : translateUI("Přeskočit intro za {0} s", countdown);
// Web nemá samostatné „Další díl“: u titulků se zvýrazní stálé tlačítko další epizody (nextButton), vlastní tlačítko je jen „Přeskočit titulky“.
export function mountIntroSkip({container,scope,title,episode,movie=false,duration,position,playing,canSeek,seek,chapters=[],current,offline=false,
  hasNextEpisode=()=>false,upNextVisible=()=>false,nextButton=()=>null,machine=new IntroSkipMachine()}) {
  let mode=cachedMode(scope), response=null, closed=false, loading=false;
  const revision=apiContextKey(), abort=new AbortController();
  const permitted=()=>!closed && current() && revision===apiContextKey() && canSeek();
  const jump=target=>{if(target!==null && permitted())Promise.resolve(seek(target/1000,machine)).catch(e=>toast(e.message));};
  const skip=button(translateUI("Přeskočit intro"),()=>jump(machine.request(Math.round(position()*1000),performance.now())),"small");
  const cancel=button(translateUI("Nepřeskakovat"),()=>machine.cancel(),"small");
  const undo=button(translateUI("Vrátit přeskočení"),()=>jump(machine.undo()),"small");
  let creditsTarget=null;
  const credits=button(translateUI("Přeskočit titulky"),()=>{if(creditsTarget!==null&&permitted())Promise.resolve(seek(creditsTarget/1000,machine)).catch(e=>toast(e.message));},"small");
  const emphasize=on=>{const b=nextButton();if(!b)return;b.classList.toggle("pk-next-credits",on);if(on)b.setAttribute("aria-label",translateUI("Další díl"));else b.removeAttribute("aria-label");};
  container.append(undo,skip,cancel,credits);
  const key=`${scopeKey(scope)}.${title}.${episode?.season_number}.${episode?.episode_number}.${Math.floor(duration)}`;
  response=readIntroCache(localStorage,key);
  const load=async()=>{
    if(loading || offline || !scope || !episode&&!movie || !Number.isFinite(duration)||duration<5||duration>21600)return;
    loading=true;
    try {
    try {const p=await api("playback/preferences",{expectedOwner:scope,signal:abort.signal});if(closed||revision!==apiContextKey())return;mode=p.intro_skip_mode;storeMode(scope,mode);}catch{}
    if(closed||mode==="off"||response&&!response.stale&&response.expires_at*1000>Date.now())return;
    // Film posílá jen title_id + duration_ms; díl bez známých čísel se nedotazuje vůbec.
    const q=new URLSearchParams(episode?{title_id:title,season:episode.season_number,episode:episode.episode_number,duration_ms:Math.round(duration*1000)}:{title_id:title,duration_ms:Math.round(duration*1000)});
    try {const value=await api("playback/segments?"+q,{expectedOwner:scope,signal:abort.signal});if(closed||revision!==apiContextKey())return;if(!Array.isArray(value.segments))return;response=value;writeIntroCache(localStorage,key,value);}catch{}
    } finally {loading=false;}
  };
  void load();
  const tick=()=>{
    const selected=cachedMode(scope);
    if(mode==="off"&&selected!=="off")void load();
    mode=selected;
    const remote=response?.expires_at*1000>Date.now()&&!response?.stale ? response?.segments||[] : (response?.segments||[]).map(s=>({...s,auto_eligible:false}));
    const segments=mergeChapterIntros(chapters,remote), now=Math.round(position()*1000), total=Math.round(duration*1000), can=permitted();
    const target=machine.tick({position:now,duration:total,now:performance.now(),playing:playing(),canSeek:can,mode,segments});
    skip.hidden=!machine.offer;skip.textContent=skipLabel(machine.offer?.kind,machine.countdown);
    // Další díl se dohledá až těsně před titulky, ne při každém spuštění dílu.
    const nearCredits=segments.some(s=>s.kind==="credits"&&now>=s.start_ms-30000&&now<s.end_ms);
    const offer=creditsOffer(now,total,segments,mode,can,nearCredits&&!!nextButton()&&hasNextEpisode(),upNextVisible());
    creditsTarget=offer?.action==="skip"?offer.target:null;credits.hidden=creditsTarget===null;emphasize(offer?.action==="nextEpisode");
    skip.disabled=cancel.disabled=undo.disabled=credits.disabled=!can;
    cancel.hidden=machine.countdown===null;undo.hidden=machine.undoPosition===null;container.hidden=skip.hidden&&undo.hidden&&credits.hidden;
    jump(target);
  };
  tick();const timer=setInterval(tick,250);
  return ()=>{closed=true;abort.abort();clearInterval(timer);emphasize(false);container.remove();};
}

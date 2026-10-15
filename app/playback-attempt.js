import { CLIENT_VERSION, BUILD_UNKNOWN } from "./build-info.js";
// Anonymous, sampled startup protocol. No storage, retry queue or media metadata.
const stages = new Map([["start",0],["source_discovery",1],["resume_lookup",2],["session_prepare",3],["media_opened",4],["terminal",5],["playback_failure",6],["source_switch",7]]);
const engines = new Set(["unknown","hls_mse","native_hls","html5","avplayer","media3","libvlc","mpv"]);
const providers = new Set(["webshare","hellspy","sosac","fastshare","stremio","database","direct","vlc","avplayer"]);
const bounded = value => Number.isFinite(value) ? Math.max(0,Math.min(3_600_000,Math.round(value))) : 0;
let active = 0, windowAt = 0, sent = 0;
const maxActive = 4, maxPerSecond = 16;
export function createPlaybackAttempt({owner, supported=false, eligible=()=>true, ownerEligible=eligible, fetcher=globalThis.fetch,
  now=()=>performance.now(), random=()=>Math.random(), crypto=globalThis.crypto, startedAt=now(), version=CLIENT_VERSION, buildUnknown=BUILD_UNKNOWN, provider="", engine="unknown"}={}) {
  const sampled = supported && random()<0.1 && /^[0-9]{1,7}(\.[0-9]{1,7}){0,3}$/.test(version);
  let id="", closed=false, terminal=null;
  const observed=new Set(), requests=new Set();
  if(sampled){try{id=Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,"0")).join("");}catch{}}
  const current=()=>!!id&&!closed&&eligible();
  function send(stage,outcome,stageDuration=0,at=now(),errorClass="none"){
    if(!current()||observed.has(stage)||!stages.has(stage)||!owner?.accountId||!owner?.profileId)return false;
    if(stage!=="start"&&!observed.has("start"))send("start","success",0,startedAt);
    observed.add(stage);
    const time=now();if(time-windowAt>=1000||time<windowAt){windowAt=time;sent=0;}
    if(active>=maxActive||sent>=maxPerSecond)return false;
    const elapsed=bounded(at-startedAt);
    const payload={attempt_id:id,sequence:stages.get(stage),stage,outcome,elapsed_ms:elapsed,duration_ms:Math.min(elapsed,bounded(stageDuration)),
      provider:providers.has(String(provider).toLowerCase())?String(provider).toLowerCase():"none",client_version:version,error_class:["failure","timeout"].includes(outcome) && ["source_resolve","session_prepare","media_prepare","media_network","media_decode","unsupported","unknown"].includes(errorClass)?errorClass:(["failure","timeout"].includes(outcome)?"unknown":"none"),build_unknown:buildUnknown!==false,engine:engines.has(engine)?engine:"unknown",sample_rate:1000};
    const controller=new AbortController();requests.add(controller);active++;sent++;
    const timeout=setTimeout(()=>controller.abort(),3000);
    Promise.resolve().then(()=>{
      if(!ownerEligible()) {controller.abort();return;}
      return fetcher("/api/app/telemetry/playback-attempts",{method:"POST",credentials:"same-origin",cache:"no-store",signal:controller.signal,
        headers:{"Content-Type":"application/json","X-Movly-App":"1","X-Movly-Expected-Account":String(owner.accountId),"X-Movly-Expected-Profile":String(owner.profileId)},body:JSON.stringify(payload)});
    }).catch(()=>{}).finally(()=>{clearTimeout(timeout);requests.delete(controller);active--;});
    return true;
  }
  function finish(outcome,at=now(),errorClass="none"){
    if(terminal||!current())return false;
    if(!["first_frame","playing","failure","timeout","cancelled","source_switch"].includes(outcome))return false;
    terminal=outcome;return send("terminal",outcome,at-startedAt,at,errorClass);
  }
  function failure(outcome="failure",errorClass="unknown"){
    if(!["failure","timeout"].includes(outcome))return false;
    return terminal?send("playback_failure",outcome,now()-startedAt,now(),errorClass):finish(outcome,now(),errorClass);
  }
  function dispose(reason="cancelled"){
    if(closed)return;
    if(eligible()) {
      if(reason==="source_switch" && terminal && terminal!=="source_switch")send("source_switch","source_switch",now()-startedAt);
      else finish(reason);
    }
    else for(const request of requests)request.abort();
    closed=true;
  }
  send("start","success",0,startedAt);
  return {sampled:!!id,correlation:()=>current() ? id : null,stage:(name,duration)=>["source_discovery","resume_lookup","session_prepare","media_opened"].includes(name)&&send(name,"success",duration),
    finish,failure,dispose,setEngine:value=>{if(engines.has(value))engine=value;},setProvider:value=>{provider=typeof value==="string"?value.toLowerCase():"";}};
}

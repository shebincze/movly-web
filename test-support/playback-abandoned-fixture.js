import Hls from '../app/vendor/hls.mjs';
const {sources,stop}=await import('../app/player.js'+(new URLSearchParams(location.search).get('baseline')==='1'?'?baseline=1':''));
import {api,invalidateApiContext} from '../app/api.js';
import {setPlaybackOwner} from '../app/playback-memory.js';
import {preparePlaybackAttemptSupport} from '../app/playback-attempt-support.js';
const mediaEvents=[];const snapshot=()=>{const v=document.querySelector('video');return v?{currentTime:v.currentTime,ended:v.ended,paused:v.paused}:null;};
const destroy=Hls.prototype.destroy;Hls.prototype.destroy=function(...args){mediaEvents.push({type:'beforeDestroy',media:snapshot()});try{return destroy.apply(this,args);}finally{mediaEvents.push({type:'afterDestroy',media:snapshot()});}};
const mode=new URLSearchParams(location.search).get('mode')||'negotiated';await fetch('/fixture/reset?mode='+mode);
// Deterministic sampling only. Capability support still requires the real
// production negotiation request, positive offer, validation and context cache.
Math.random=()=>0;
const login=await api('login',{method:'POST',body:{username:'test',password:'movly-test'}});
const selected=await api('profile',{method:'POST',body:{id:1}});
document.body.dataset.currentProfile=String(selected.profile.id);setPlaybackOwner(login.account,selected.profile);invalidateApiContext({accountId:login.account.id,profile:selected.profile});
document.body.dataset.negotiated=String(await preparePlaybackAttemptSupport());
const stats=async()=>document.querySelector('#counters').textContent=JSON.stringify({currentProfile:Number(document.body.dataset.currentProfile),...await(await fetch('/fixture/stats')).json(),mediaEvents},null,2);
const start=document.querySelector('#start');start.disabled=false;start.onclick=()=>void sources({id:1,title:'Controlled engine fixture',type:'movie'},null,{skipResume:true});
document.querySelector('.dialog-close').onclick=async()=>{mediaEvents.push({type:'beforeClose',media:snapshot()});document.querySelector('#dialog').close();await stop();mediaEvents.push({type:'afterStop',media:snapshot()});await stats();};
document.querySelector('#owner').onclick=async()=>{const changed=await api('profile',{method:'POST',body:{id:2,pin:'1234'}});if(changed.profile?.id!==2)throw new Error('Synthetic profile handoff did not complete');document.body.dataset.currentProfile='2';setPlaybackOwner(login.account,changed.profile);invalidateApiContext({accountId:login.account.id,profile:changed.profile});document.querySelector('#dialog').close();await stop();await stats();};
document.querySelector('#release').onclick=async()=>{await fetch('/fixture/release');await stats();};document.querySelector('#stats').onclick=stats;

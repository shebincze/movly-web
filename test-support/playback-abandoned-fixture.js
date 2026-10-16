import {sources,stop} from '../app/player.js';
import {api,invalidateApiContext} from '../app/api.js';
import {setPlaybackOwner} from '../app/playback-memory.js';
import {preparePlaybackAttemptSupport} from '../app/playback-attempt-support.js';
const mode=new URLSearchParams(location.search).get('mode')||'negotiated';await fetch('/fixture/reset?mode='+mode);
// Deterministic sampling only. Capability support still requires the real
// production negotiation request, positive offer, validation and context cache.
Math.random=()=>0;
const login=await api('login',{method:'POST',body:{username:'test',password:'movly-test'}});
const selected=await api('profile',{method:'POST',body:{id:1}});
document.body.dataset.currentProfile=String(selected.profile.id);setPlaybackOwner(login.account,selected.profile);invalidateApiContext({accountId:login.account.id,profile:selected.profile});
document.body.dataset.negotiated=String(await preparePlaybackAttemptSupport());
const stats=async()=>document.querySelector('#counters').textContent=JSON.stringify({currentProfile:Number(document.body.dataset.currentProfile),...await(await fetch('/fixture/stats')).json()},null,2);
const start=document.querySelector('#start');start.disabled=false;start.onclick=()=>void sources({id:1,title:'Controlled engine fixture',type:'movie'},null,{skipResume:true});
document.querySelector('.dialog-close').onclick=()=>{document.querySelector('#dialog').close();void stop();};
document.querySelector('#owner').onclick=async()=>{const changed=await api('profile',{method:'POST',body:{id:2,pin:'1234'}});if(changed.profile?.id!==2)throw new Error('Synthetic profile handoff did not complete');document.body.dataset.currentProfile='2';setPlaybackOwner(login.account,changed.profile);invalidateApiContext({accountId:login.account.id,profile:changed.profile});document.querySelector('#dialog').close();await stop();await stats();};
document.querySelector('#release').onclick=async()=>{await fetch('/fixture/release');await stats();};document.querySelector('#stats').onclick=stats;

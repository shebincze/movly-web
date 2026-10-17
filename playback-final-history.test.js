'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
async function harness({reject=false,ended=false,staleOwner=false}={}) {
 const source=await fs.readFile('app/player.js','utf8');
 const history=source.slice(source.indexOf('    const history = async () => {'),source.indexOf('    handle.history = history;'));
 const stop=source.slice(source.indexOf('export async function stop('),source.indexOf('\nfunction feedbackButton('));
 const events=[],requests=[],video={currentTime:4.67,ended,pause(){events.push('pause');},removeAttribute(name){events.push('detach:'+name);},load(){}};
 let release;const pending=new Promise(r=>release=r);
 const fixture={events,requests,video,pending,reject,staleOwner};globalThis.__finalHistory=fixture;
 const setup=`const f=globalThis.__finalHistory;const video=f.video,t={id:1,type:'movie'},episode=null,session={duration:8},scope={accountId:1,profileId:2,generation:3},offset=0;const positionNow=()=>Math.min(session.duration,offset+(video.currentTime||0));const playbackOwner=()=>f.staleOwner?{...scope,generation:4}:scope;const setProgress=()=>f.events.push('overlay');const api=async(path,options)=>{f.events.push(path);f.requests.push({path,...options});if(path==='watch-history'){await f.pending;if(f.reject)throw Error('synthetic failure');}};const toast=()=>f.events.push('toast'),translateUI=x=>x,endPartyPlayback=()=>{};`;
 const tail=`let current={video,history,hls:{destroy(){f.events.push('destroy');video.currentTime=0;}}};`;
 const player=await import('data:text/javascript;base64,'+Buffer.from(setup+history+tail+stop+'\n//'+Math.random()).toString('base64'));
 return {player,events,requests,release};
}
for(const ended of [false,true])test(`final history snapshots media before HLS detach (ended=${ended})`,async()=>{
 const h=await harness({ended});const stopping=h.player.stop();
 assert.deepEqual(h.events,['pause','overlay','watch-history','destroy','detach:src']);
 assert.equal(h.requests[0].body.progress_seconds,4);assert.equal(h.requests[0].body.duration_seconds,8);
 assert.equal(h.requests[0].body.watch_status,ended?'completed':'watching');
 assert.deepEqual(h.requests[0].expectedOwner,{accountId:1,profileId:2,generation:3});
 h.release();await stopping;assert.equal(h.requests.some(r=>r.path.startsWith('playback/')),false);
});
test('history rejection remains contained and session cleanup completes',async()=>{
 const h=await harness({reject:true});const stopping=h.player.stop();h.release();await stopping;
 assert.deepEqual(h.events,['pause','overlay','watch-history','destroy','detach:src','toast']);
});

test('changed owner rejects final history before local overlay or HTTP',async()=>{
 const h=await harness({staleOwner:true});const stopping=h.player.stop();h.release();await stopping;
 assert.deepEqual(h.events,['pause','destroy','detach:src']);
 assert.equal(h.requests.some(r=>r.path==='watch-history'),false);
});

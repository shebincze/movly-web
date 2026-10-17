'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
async function harness(mode){
 let release;const held=new Promise(r=>release=r);let entered;const waiting=new Promise(r=>entered=r);let posts=0,deletes=0;
 const scope={accountId:1,profileId:2,generation:1},dialog={open:true};
 const reporter={failure(){},stage(){},dispose(){}};
 const deps={scope,dialog,reporter,mode,
  async api(path,options){if(path.startsWith('watch-history/position/')){if(mode==='resume'){entered();await held;}return {progress_seconds:0};}
   if(path==='playback'){posts++;return null;}if(options?.method==='DELETE'){deletes++;return {}; }throw Error(path);}};
 globalThis.__cancelFixture=deps;
 const original=await fs.readFile('app/player.js','utf8');
 const source=original.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\n/gm,'');
 const prefix=`const fixture=globalThis.__cancelFixture;const api=fixture.api,playbackOwner=()=>fixture.scope,showDialog=()=>fixture.dialog,el=()=>({}),translateUI=x=>x,recalledPlayback=()=>null,samePlaybackSource=()=>false,createPlaybackTelemetryReporter=()=>fixture.reporter,beginPartyPlayback=()=>null,partyPlaybackMatches=()=>false,endPartyPlayback=()=>{},toast=()=>{};const localStorage={getItem:()=>null};`;
 const player=await import('data:text/javascript;base64,'+Buffer.from(prefix+source+'\nexport {play};\n//'+Math.random()).toString('base64'));
 return {player,scope,dialog,release,waiting,replaceOwner:()=>{deps.scope={...scope,generation:scope.generation+1};},counts:()=>({posts,deletes})};
}
for(const mode of ['resume'])test(`production player rejects session admission after ${mode} cancellation`,async()=>{
 const h=await harness(mode);const pending=h.player.play({id:1,title:'Fixture',type:'movie'},null,{title_id:1});await h.waiting;h.dialog.open=false;await h.player.stop();h.release();await pending;assert.deepEqual(h.counts(),{posts:0,deletes:0});
});
for(const mode of ['resume'])test(`production player rejects stale owner after ${mode}`,async()=>{
 const h=await harness(mode);const pending=h.player.play({id:1,title:'Fixture',type:'movie'},null,{title_id:1});await h.waiting;h.replaceOwner();h.release();await pending;assert.equal(h.counts().posts,0);await h.player.stop();
});
for(const mode of ['resume'])test(`production player rejects closed dialog before close event after ${mode}`,async()=>{
 const h=await harness(mode);const pending=h.player.play({id:1,title:'Fixture',type:'movie'},null,{title_id:1});await h.waiting;h.dialog.open=false;h.release();await pending;assert.deepEqual(h.counts(),{posts:0,deletes:0});await h.player.stop();
});

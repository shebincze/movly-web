const {test}=require('node:test');const assert=require('node:assert/strict');
test('narrow work option sends only current sampled correlation, rejects disposed response and fences owner ABA',async t=>{
 const api=await import('./app/api.js');const previous=global.fetch,calls=[];t.after(()=>{global.fetch=previous;api.invalidateApiContext();});
 api.invalidateApiContext({accountId:1,profile:{id:2}});const id='a'.repeat(32);let current=id;
 const attempt={correlation:()=>current};global.fetch=async(url,options)=>{calls.push({url,options});return new Response('{}');};
 await api.api('playback',{method:'POST',playbackAttempt:attempt});assert.equal(calls.at(-1).options.headers['X-Movly-Playback-Attempt'],id);
 await api.api('profiles',{playbackAttempt:attempt});assert.equal(calls.at(-1).options.headers['X-Movly-Playback-Attempt'],undefined);
 current=null;await api.api('playback',{method:'POST',playbackAttempt:attempt});assert.equal(calls.at(-1).options.headers['X-Movly-Playback-Attempt'],undefined);
 current=id;let release;global.fetch=()=>new Promise(r=>release=r);const pending=api.api('playback',{method:'POST',playbackAttempt:attempt});current=null;release(new Response('{}'));await assert.rejects(pending,{name:'AbortError'});
 current=id;const p=api.api('playback',{method:'POST',playbackAttempt:attempt});api.invalidateApiContext({accountId:2,profile:{id:3}});api.invalidateApiContext({accountId:1,profile:{id:2}});release(new Response('{}'));await assert.rejects(p,{name:'AbortError'});
});

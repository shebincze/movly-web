'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('./app/external-lists.js');
test('external titles prefer Czech catalog metadata and retain available fallback', async () => {
  const { localizedExternalTitle } = await modulePromise;
  assert.equal(localizedExternalTitle({id:42,title:'The Big Bang Theory',all_titles:{cs:'Teorie velkého třesku'},type:'tv'}, {name:'Remote'}).title, 'Teorie velkého třesku');
  assert.equal(localizedExternalTitle({id:42,title:'Available title',all_titles:{cs:' '},type:'movie'}, {name:'Remote'}).title, 'Available title');
});
test('metadata queue limits concurrency and separates movie from series identities', async () => {
  const { createExternalCardResolver } = await modulePromise;
  let active=0, peak=0; const calls=[];
  const resolve=createExternalCardResolver(async path => {
    calls.push(path); active++; peak=Math.max(peak,active);
    await new Promise(r=>setTimeout(r,5)); active--;
    return {id:calls.length,title:path};
  },new AbortController().signal);
  await Promise.all(Array.from({length:24},(_,i)=>resolve({tmdb_id: i%12+1,kind:i<12?'movie':'tv'})));
  assert.equal(peak,4); assert.equal(calls.length,24);
  await resolve({tmdb_id:1,kind:'movie'}); assert.equal(calls.length,24);
});
test('unknown identity is retained by caller without a guessed metadata lookup', async () => {
  const { createExternalCardResolver }=await modulePromise;
  let calls=0; const resolve=createExternalCardResolver(async()=>{calls++;},new AbortController().signal);
  await assert.rejects(resolve({tmdb_id:0,kind:'movie'}));
  await assert.rejects(resolve({tmdb_id:550,kind:'person'}));
  assert.equal(calls,0);
});
test('aborting owner scope prevents queued metadata reads',async()=>{
  const {createExternalCardResolver}=await modulePromise;
  const controller=new AbortController(); let calls=0; const releases=[];
  const resolve=createExternalCardResolver(async()=>{calls++; await new Promise(r=>releases.push(r)); return {id:1,title:'T'};},controller.signal);
  const jobs=Array.from({length:8},(_,i)=>resolve({tmdb_id:i+1,kind:'movie'}));
  await new Promise(r=>setImmediate(r)); controller.abort(); releases.forEach(r=>r());
  const result=await Promise.allSettled(jobs);
  assert.equal(calls,4); assert.equal(result.filter(x=>x.status==='rejected').length,4);
});

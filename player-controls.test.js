'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('./app/player-controls.js');
const ranges=(...pairs)=>({length:pairs.length,start:i=>pairs[i][0],end:i=>pairs[i][1]});
const key=(k,target={tagName:'DIV',closest:()=>null},extra={})=>({key:k,target,...extra});
test('seeking inside the loaded session range stays local, outside reopens the session',async()=>{
 const {seekPlan}=await load();
 assert.deepEqual(seekPlan(130,{offset:100,duration:3600,seekable:ranges([0,60])}),{position:130,local:30});
 assert.deepEqual(seekPlan(190,{offset:100,duration:3600,seekable:ranges([0,60])}),{position:190,restart:true});
 assert.deepEqual(seekPlan(90,{offset:100,duration:3600,seekable:ranges([0,60])}),{position:90,restart:true});
 assert.deepEqual(seekPlan(-20,{offset:0,duration:3600,seekable:ranges([0,60])}),{position:0,local:0});
 assert.deepEqual(seekPlan(4000,{offset:0,duration:3600,seekable:ranges([0,3600])}),{position:3600,restart:true});
 assert.deepEqual(seekPlan(30,{offset:0,duration:3600,seekable:null}),{position:30,restart:true});
});
test('keyboard shortcuts leave form controls and track pickers alone',async()=>{
 const {playerKeyAction}=await load();
 assert.equal(playerKeyAction(key(' ')),'toggle');
 assert.equal(playerKeyAction(key('K')),'toggle');
 assert.equal(playerKeyAction(key('ArrowLeft')),'back');
 assert.equal(playerKeyAction(key('l')),'forward');
 assert.equal(playerKeyAction(key('ArrowUp')),'volume-up');
 assert.equal(playerKeyAction(key('m')),'mute');
 assert.equal(playerKeyAction(key('f')),'fullscreen');
 assert.equal(playerKeyAction(key('p')),'pip');
 assert.equal(playerKeyAction(key(' ',{tagName:'BUTTON',closest:()=>null})),null);
 assert.equal(playerKeyAction(key('ArrowRight',{tagName:'INPUT',type:'range',closest:()=>null})),null);
 assert.equal(playerKeyAction(key('k',{tagName:'INPUT',type:'number',closest:()=>null})),null);
 assert.equal(playerKeyAction(key('f',{tagName:'SELECT',closest:()=>null})),null);
 assert.equal(playerKeyAction(key('ArrowDown',{tagName:'BUTTON',closest:()=>({})})),null);
 assert.equal(playerKeyAction(key('f',undefined,{ctrlKey:true})),null);
 assert.equal(playerKeyAction(key('x')),null);
});
test('next-episode countdown shows only in the last seconds when the next episode is known',async()=>{
 const {nextCountdown,NEXT_COUNTDOWN_SECONDS}=await load();
 assert.equal(nextCountdown(NEXT_COUNTDOWN_SECONDS+1,{available:true}),null);
 assert.equal(nextCountdown(9.2,{available:true}),10);
 assert.equal(nextCountdown(0.1,{available:true}),1);
 assert.equal(nextCountdown(5,{available:false}),null);
 assert.equal(nextCountdown(5,{available:true,cancelled:true}),null);
 assert.equal(nextCountdown(5,{available:true,enabled:false}),null);
});
test('stored volume is bounded and survives malformed storage',async()=>{
 const {readVolume}=await load();
 const store=v=>({getItem:()=>v});
 assert.deepEqual(readVolume(store('{"volume":0.4,"muted":true}')),{volume:0.4,muted:true});
 assert.deepEqual(readVolume(store('{"volume":7}')),{volume:1,muted:false});
 assert.deepEqual(readVolume(store('nope')),{volume:1,muted:false});
 assert.deepEqual(readVolume({getItem(){throw Error('blocked');}}),{volume:1,muted:false});
});

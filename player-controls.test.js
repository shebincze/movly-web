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
// Minimální DOM pro mountPlayerControls: jen to, co lišta skutečně používá.
function fakeNode(tag='div'){
 const classes=new Set(),listeners={};
 return {tagName:tag.toUpperCase(),dataset:{},attributes:{},children:[],hidden:false,disabled:false,
  classList:{toggle:(c,on)=>{on?classes.add(c):classes.delete(c);},contains:c=>classes.has(c)},
  setAttribute(k,v){this.attributes[k]=String(v);},replaceChildren(...c){this.children=c;},
  addEventListener(n,h){(listeners[n]||=[]).push(h);},removeEventListener(n,h){listeners[n]=(listeners[n]||[]).filter(x=>x!==h);},
  fire(n,e={}){for(const h of listeners[n]||[])h(e);},listeners};
}
async function mountFake({screenApi,options={}}){
 const {mountPlayerControls}=await load();
 const doc=fakeNode('#document');doc.documentElement=fakeNode('html');doc.fullscreenElement=null;
 globalThis.document=doc;
 const nodes=[];
 const el=(tag,attrs={},...children)=>{const n=fakeNode(tag);Object.assign(n,attrs);n.children=children;if(attrs.onClick)n.click=attrs.onClick;if(attrs['aria-label'])n.label=attrs['aria-label'];nodes.push(n);return n;};
 const video=Object.assign(fakeNode('video'),{paused:true,ended:false,volume:1,muted:false,play:async()=>{},pause(){},
  webkitEnterFullscreen(){video.native=(video.native||0)+1;}});
 const screen=Object.assign(fakeNode('div'),screenApi);
 const controls=mountPlayerControls({el,glyph:()=>({}),translate:s=>s,video,screen,keyRoot:fakeNode(),storage:{getItem:()=>null,setItem(){}},positionNow:()=>0,seekTo(){},...options});
 const button=nodes.find(n=>n.label==='Celá obrazovka');
 return {doc,video,screen,controls,button};
}
test('without element fullscreen (iPhone Safari) the player fills the page instead of the native session-only player',async()=>{
 const {doc,video,screen,controls,button}=await mountFake({screenApi:{}});
 try{
  button.click();
  assert.equal(video.native,undefined,'native webkitEnterFullscreen only knows the current HLS session window');
  assert.equal(screen.classList.contains('pk-page-fullscreen'),true);
  assert.equal(doc.documentElement.classList.contains('pk-page-fullscreen-open'),true);
  assert.equal(button.dataset.full,'true');
  assert.equal(button.attributes['aria-label'],'Ukončit celou obrazovku');
  doc.fire('keydown',{key:'f',target:{tagName:'DIV',closest:()=>null},preventDefault(){}});
  assert.equal(screen.classList.contains('pk-page-fullscreen'),false);
  assert.equal(button.dataset.full,'false');
  button.click();
  controls.cleanup();
  assert.equal(screen.classList.contains('pk-page-fullscreen'),false);
  assert.equal(doc.documentElement.classList.contains('pk-page-fullscreen-open'),false);
 }finally{delete globalThis.document;}
});
test('element fullscreen stays preferred and falls back to the page when the browser refuses it',async()=>{
 let calls=0;
 const granted=await mountFake({screenApi:{requestFullscreen(){calls++;return Promise.resolve();}}});
 try{
  granted.button.click();
  assert.equal(calls,1);
  assert.equal(granted.screen.classList.contains('pk-page-fullscreen'),false);
 }finally{delete globalThis.document;}
 const refused=await mountFake({screenApi:{requestFullscreen:()=>Promise.reject(new TypeError('not allowed'))}});
 try{
  refused.button.click();
  await new Promise(r=>setImmediate(r));
  assert.equal(refused.screen.classList.contains('pk-page-fullscreen'),true);
  assert.equal(refused.video.native,undefined);
 }finally{delete globalThis.document;}
});
test('a reopened session keeps the page fullscreen, element fullscreen is never forced without a gesture',async()=>{
 const first=await mountFake({screenApi:{}});
 let keep;
 try{
  first.button.click();
  keep=first.controls.pageFullscreen();
  first.controls.cleanup();
 }finally{delete globalThis.document;}
 assert.equal(keep,true);
 const next=await mountFake({screenApi:{},options:{pageFullscreen:keep}});
 try{
  assert.equal(next.screen.classList.contains('pk-page-fullscreen'),true);
  assert.equal(next.button.dataset.full,'true');
  assert.equal(next.controls.pageFullscreen(),true);
 }finally{delete globalThis.document;}
 let calls=0;
 const desktop=await mountFake({screenApi:{requestFullscreen(){calls++;return Promise.resolve();}},options:{pageFullscreen:false}});
 try{
  assert.equal(calls,0);
  assert.equal(desktop.controls.pageFullscreen(),false);
 }finally{delete globalThis.document;}
});
test('a refusal arriving after the player closed does not lock the page',async()=>{
 let refuse;
 const late=await mountFake({screenApi:{requestFullscreen:()=>new Promise((_,reject)=>{refuse=reject;})}});
 try{
  late.button.click();
  late.controls.cleanup();
  refuse(new TypeError('not allowed'));
  await new Promise(r=>setImmediate(r));
  assert.equal(late.screen.classList.contains('pk-page-fullscreen'),false);
  assert.equal(late.doc.documentElement.classList.contains('pk-page-fullscreen-open'),false);
 }finally{delete globalThis.document;}
});

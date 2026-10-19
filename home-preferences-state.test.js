'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict'),state=require('./app/tv/home-preferences-state');
const document=()=>({profile_id:2,revision:0,catalog_revision:'a'.repeat(64),sections:[{slug:'hero',kind:'hero',name:'Hero',visible:true,display_order:0,default_order:0},{slug:'empty',kind:'rail',name:'Empty eligible row',visible:false,display_order:1,default_order:1},{slug:'continue',kind:'continue',name:'Continue',visible:true,display_order:2,default_order:2}]});
test('Home editor includes hidden and empty eligible rows and permits moving/hiding hero',()=>{
 const input=document(),doc=state.document(input,2),draft=state.draft(doc);state.move(draft,'continue',-1);state.move(draft,'continue',-1);state.toggle(draft,'hero');state.toggle(draft,'empty');
 assert.deepEqual(state.body(doc,draft,false),{revision:0,catalog_revision:'a'.repeat(64),order:['continue','hero','empty'],hidden:['hero']});assert.equal(input.sections[0].visible,true);assert.equal(doc.sections[0].visible,true);
});
test('Home reset carries the exact CAS tokens and both empty arrays without mutating the draft',()=>{
 const doc=state.document(document(),2),draft=state.draft(doc);state.toggle(draft,'continue');assert.deepEqual(state.body(doc,draft,true),{revision:0,catalog_revision:'a'.repeat(64),order:[],hidden:[]});assert.deepEqual(draft.hidden,['empty','continue']);
 const body=state.body(doc,draft,false);body.order.push('not-authoritative');assert.equal(draft.order.length,3);
});
test('Home document rejects another profile, malformed/duplicate server identities and unbounded revisions',()=>{
 const variants=[v=>{v.profile_id=9},v=>{v.revision=-1},v=>{v.revision=Number.MAX_SAFE_INTEGER+1},v=>{v.catalog_revision=''},v=>{v.sections.push(v.sections[0])},v=>{v.sections[0].slug='../bad'},v=>{v.sections[0].visible=1},v=>{v.sections[0].display_order=-1}];
 for(const change of variants){const v=document();change(v);assert.throws(()=>state.document(v,2));}
 assert.deepEqual(state.document({...document(),sections:[]},2).sections,[]);
});
test('Home all-hidden is valid and unknown/boundary moves do not invent server rows',()=>{
 const doc=state.document(document(),2),draft=state.draft(doc);state.toggle(draft,'hero');state.toggle(draft,'continue');state.toggle(draft,'unknown');state.move(draft,'hero',-1);state.move(draft,'unknown',1);assert.deepEqual(draft.order,['hero','empty','continue']);assert.deepEqual(draft.hidden,['empty','hero','continue']);
 for(const lang of ['cs','sk','en'])for(const key of ['title','save','reset','conflict','context','show','hide'])assert.notEqual(state.text(key,lang),key);
});

test('Home catalogue accepts signed default order but requires exact slugs and catalogue hash',()=>{
 const good=document();good.sections[0].default_order=-20;assert.equal(state.document(good,2).sections[0].default_order,-20);
 for(const change of [v=>{v.catalog_revision='opaque'},v=>{v.sections[0].slug='bad_slug'},v=>{v.sections[0].slug='a'.repeat(81)},v=>{v.sections[0].default_order=-Number.MAX_SAFE_INTEGER-1}]){const v=document();change(v);assert.throws(()=>state.document(v,2));}
});
test('Home receipts require dense unique effective positions and an advancing revision',()=>{
 const valid=document();valid.revision=5;assert.equal(state.receipt(valid,2,4).revision,5);assert.throws(()=>state.receipt(valid,2,5));assert.throws(()=>state.receipt({...valid,revision:3},2,4));
 for(const change of [v=>{v.sections[1].display_order=0},v=>{v.sections[1].display_order=7}]){const v=document();change(v);assert.throws(()=>state.document(v,2));}
});
test('Home foreground reconciles clean documents but preserves dirty drafts until explicit review',()=>{
 const old=state.document(document(),2),value=state.draft(old);state.move(value,'continue',-1);
 const same=state.reconcile(old,value,state.document(document(),2),true,true);assert.equal(same.draft,value);assert.equal(same.ready,true);assert.equal(same.conflict,false);assert.equal(state.reconcile(old,value,old,true,true,true).conflict,true);assert.equal(state.reconcile(old,value,old,false,true,true).conflict,true);
 const newer=state.document({...document(),revision:1},2),conflict=state.reconcile(old,value,newer,true,true);assert.equal(conflict.document,old);assert.equal(conflict.draft,value);assert.equal(conflict.conflict,true);
 assert.equal(state.reconcile(old,value,old,true,false).ready,false);assert.equal(state.reconcile(old,value,{...newer,catalog_revision:'b'.repeat(64)},true,true).conflict,true);
 const reload=state.reconcile(old,value,newer,false,true);assert.equal(reload.document,newer);assert.equal(reload.dirty,false);assert.equal(reload.conflict,false);assert.deepEqual(reload.draft.order,['hero','empty','continue']);
});

test('Page documents fence page identity while legacy Home stays shape-compatible',()=>{
 for(const page of ['home','movies','series']){const source={...document(),page};const accepted=state.document(source,2,page);assert.equal(accepted.page,page);assert.equal(state.receipt({...source,revision:1},2,0,page).page,page);assert.throws(()=>state.document({...source,page:'foreign'},2,page));assert.throws(()=>state.document(document(),2,page));}
 assert.equal(Object.hasOwn(state.document({...document(),page:'home'},2),'page'),false);assert.throws(()=>state.document({...document(),page:'unknown'},2,'unknown'));
 const old=state.document({...document(),page:'movies'},2,'movies'),other=state.document({...document(),page:'series'},2,'series');assert.equal(state.reconcile(old,state.draft(old),other,true,true).conflict,true);
});
test('Handle relocation changes a bounded draft only and cancel snapshots remain independent',()=>{
 const doc=state.document({...document(),page:'movies'},2,'movies'),draft=state.draft(doc),before=draft.order.slice();state.relocate(draft,'hero',2);assert.deepEqual(draft.order,['empty','continue','hero']);assert.deepEqual(before,['hero','empty','continue']);for(const index of [-1,3,1.5])state.relocate(draft,'hero',index);state.relocate(draft,'unknown',0);assert.deepEqual(draft.order,['empty','continue','hero']);assert.deepEqual(state.body(doc,draft,false).order,draft.order);
});
test('Visible page watcher bounds requests, compares document/catalogue/policy and fences late reads',()=>{
 let visible=true,changed=0,abort=0,done,queued=[],reads=0;const watch=state.watch({active:()=>visible,changed:()=>changed++,setTimer:fn=>{queued.push(fn);return fn},clearTimer:fn=>{queued=queued.filter(v=>v!==fn)},read:cb=>{reads++;done=cb;return{abort:()=>abort++}}});
 const doc={page:'movies',profile_id:2,revision:1,catalog_revision:'a',policy_revision:'p'};watch.start();watch.start();assert.equal(reads,1);done(null,doc);assert.equal(queued.length,1);queued.shift()();done(null,doc);assert.equal(changed,0);queued.shift()();done(null,{...doc,catalog_revision:'b'});assert.equal(changed,1);queued.shift()();const old=done;watch.stop();assert.equal(abort,1);old(null,{...doc,revision:9});assert.equal(changed,1);assert.equal(queued.length,0);visible=false;watch.start();assert.equal(reads,4);visible=true;watch.start();assert.equal(reads,5);done(null,{...doc,revision:2});assert.equal(changed,2);watch.stop();
});

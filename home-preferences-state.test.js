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

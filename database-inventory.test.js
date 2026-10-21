"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),inventory=require("./app/tv/database-availability.js");
const raw={title_id:42,providers:[{provider_id:1,streams_count:19,video_height:2160,audio_languages:["eng"]},{provider_id:2,streams_count:2,video_height:1080,audio_languages:["cze"]}],episodes:{101:[{provider_id:2,streams_count:8,video_height:1080,audio_languages:["cs","eng","und"]}]}};
test("only connected provider counts quality and audio contribute",()=>{
 const filtered=inventory.filtered(raw,{}); assert.deepEqual(inventory.summary(filtered.providers),{count:2,quality:"FHD",audio:"CZ"});
 assert.deepEqual(inventory.summary(inventory.filtered(raw,{webshare:true}).providers),{count:21,quality:"4K",audio:"CZ / EN"});
 assert.deepEqual(inventory.summary(filtered.episodes[101]),{count:8,quality:"FHD",audio:"CZ / EN"});
});
test("incomplete or malformed snapshots stay unknown and confirmed empty is zero",()=>{
 for(const value of [null,{}, {...raw,title_id:43},{...raw,episodes:null},{...raw,degraded:true},{...raw,providers:[raw.providers[0],raw.providers[0]]},{...raw,episodes:{0:[]}}]) assert.equal(inventory.valid(value,42),false);
 assert.equal(inventory.summary(null),null); assert.deepEqual(inventory.summary([]),{count:0,quality:null,audio:""});
 assert.equal(inventory.filtered({...raw,providers:[{provider_id:999,provider_name:"unknown",streams_count:10}]},{}).providers.length,0);
});

test("filtered inventory only forwards public metadata fields",()=>{
 const value={...raw,providers:[{...raw.providers[1],url:"https://private.invalid/file",token:"synthetic-secret"}]};
 const text=JSON.stringify(inventory.filtered(value,{}));assert.doesNotMatch(text,/private.invalid|synthetic-secret|token|url/);
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("./app/tv/tv.js"), "utf8");
function fixture() {
  const values = new Map();
  const context = vm.createContext({ account: {id: 1}, profile: {id: 2}, searchEnvironment: "local", localStorage: {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)} });
  vm.runInContext(source.slice(source.indexOf("  function each("), source.indexOf("  function h(")) + source.slice(source.indexOf("  var DIACRITICS"), source.indexOf("  // ---------- API")) + source.slice(source.indexOf("  function searchOwner()"),source.indexOf("  function searchScreen()")), context);
  return {context,values,run:code=>{const value=vm.runInContext(code,context);return value===undefined?undefined:JSON.parse(JSON.stringify(value));}};
}
test("TV history is bounded, deduplicated and partitioned by environment, account and profile",()=>{
 const f=fixture();f.run('rememberTerm(searchOwner()," Duna "); rememberTerm(searchOwner(),"duna")');assert.deepEqual(f.run('historyTerms(searchOwner())'),["duna"]);
 for(let i=0;i<25;i++)f.run(`rememberTerm(searchOwner(),"Film${i}")`);assert.equal(f.run('historyTerms(searchOwner())').length,20);
 for(const code of ['profile={id:3}', 'profile={id:2};account={id:2}', 'account={id:1};searchEnvironment="test"']) {f.run(code);assert.deepEqual(f.run('historyTerms(searchOwner())'),[]);}
 f.run('searchEnvironment="local"');assert.equal(f.run('historyTerms(searchOwner())').length,20);
 f.run('storeTerms("local:99:99",["foreign"])');assert.equal(f.values.has('movly.searchHistory.v2.local:99:99'),false);
 f.run('searchEnvironment="";rememberTerm(searchOwner(),"no trusted environment")');assert.equal(f.values.has('movly.searchHistory.v2.'),false);
});
test("TV history rejects malformed storage and supports individual removal/clear",()=>{
 const f=fixture(),key='movly.searchHistory.v2.local:1:2';f.values.set(key,'{"bad":true}');assert.deepEqual(f.run('historyTerms(searchOwner())'),[]);
 f.values.set(key,'[null,123,"", "safe"]');assert.deepEqual(f.run('historyTerms(searchOwner())'),['safe']);
 f.run('rememberTerm(searchOwner(),"next");storeTerms(searchOwner(),filter(historyTerms(searchOwner()),function(v){return v!=="safe";}))');assert.deepEqual(f.run('historyTerms(searchOwner())'),['next']);
 f.run('storeTerms(searchOwner(),[])');assert.deepEqual(f.run('historyTerms(searchOwner())'),[]);
});
test("TV structured queries preserve all shared filter fields and singular API CSV keys",()=>{
 const f=fixture();assert.deepEqual(f.run('filterQuery({type:"movie",genre_ids:[1,2],genre_match:"all",year_from:2020,rating_from:0,runtime_to:120,video_height_min:2160,hdr:true,has_streams:true,audio_languages:["cs","en"],subtitle_languages:["sk"],original_languages:["en"],countries:["CZ","US"],sort_by:"rating",sort_order:"desc"})'),{type:'movie',genre_ids:'1,2',genre_match:'all',year_from:2020,rating_from:0,runtime_to:120,video_height_min:2160,hdr:true,has_streams:true,audio_language:'cs,en',subtitle_language:'sk',original_language:'en',countries:'CZ,US',sort_by:'rating',sort_order:'desc'});
 assert.deepEqual(f.run('filterQuery({hdr:false,type:"",audio_languages:[]})'),{});
});

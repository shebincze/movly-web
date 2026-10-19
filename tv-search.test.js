"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("./app/tv/tv.js"), "utf8");
function fixture() {
  const values = new Map();
  const context = vm.createContext({ account: {id: 1}, profile: {id: 2}, searchEnvironment: "local", localStorage: {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)} });
  vm.runInContext(source.slice(source.indexOf("  function arrayList("), source.indexOf("  function h(")) + source.slice(source.indexOf("  var DIACRITICS"), source.indexOf("  // ---------- API")) + source.slice(source.indexOf("  function titleOf("),source.indexOf("  function posterCard(")) + source.slice(source.indexOf("  function exactTitleKey("),source.indexOf("  function searchScreen()")), context);
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

test("TV exact titles are grouped first, deduplicated and keep original raw result rank",()=>{
 const f=fixture();
 assert.deepEqual(f.run('exactSearchGroups([{id:1,title:"Related Matrix",type:"movie"},null,{id:2,title:"Matrix QA",type:"movie"},{id:2,title:"Matrix QA",type:"movie"},{id:3,title:"Český název",original_title:"Matrix QA",type:"tv"}],"Matrix—QA!",60)'),{exact:[{title:{id:2,title:"Matrix QA",type:"movie"},position:63},{title:{id:3,title:"Český název",original_title:"Matrix QA",type:"tv"},position:65}],related:[{title:{id:1,title:"Related Matrix",type:"movie"},position:61}]});
 assert.equal(f.run('exactTitleKey("Pán prstenů!")'),'pan prstenu');
 assert.equal(f.run('exactTitleKey("東京!")'),'東京');
});

// Execute the production search screen with a small DOM and deterministic timers.
function searchFlow() {
 const f=fixture(),timers=new Map(),requests=[];let next=0,current,scope='owner';
 function node(tag,attrs={},children=[]) {const n={tag,attrs,children:[],value:attrs.value||'',hidden:false,events:{},textContent:attrs.text||'',appendChild(c){this.children.push(c);return c;},setAttribute(k,v){this.attrs[k]=String(v);},addEventListener(k,fn){this.events[k]=fn;},contains(c){return this===c||this.children.some(x=>x.contains&&x.contains(c));}};children.forEach(c=>n.appendChild(c));return n;}
 const policy={schema_version:1,user_id:1,profile_id:2,is_kids:false,age_controls_active:false,revision:'ep1.'+'a'.repeat(64)};
 Object.assign(f.context,{h:node,button:(label,fn)=>{const n=node('button',{text:label});n.click=fn;return n;},statusBox:text=>node('status',{text}),setStatus:(n,text)=>{n.textContent=text;},clear:n=>{n.children=[];},header:()=>node('header'),makeScreen:(name,children,extra)=>Object.assign({el:node('screen',{},children)},extra),current:()=>current,searchScope:()=>scope,query:params=>'?'+new URLSearchParams(params),filterDescription:()=>'',posterCard:(title,fn)=>{const n=node('card');n.click=fn;return n;},firstFocusable:n=>n.children[0]||n,focusEl:()=>{},setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id),api:(path,options,done)=>{const req={path,options,done,aborted:false,abort(){this.aborted=true;}};requests.push(req);if(path==='profiles/effective-content-policy')done(null,policy);else if(path.startsWith('autocomplete?'))done(null,{suggestions:['Duna']});return req;}});
 vm.runInContext(source.slice(source.indexOf('  function searchScreen()'),source.indexOf('  function filterDescription(')),f.context);
 current=vm.runInContext('searchScreen()',f.context);current.onShow();
 const nodes=(n=current.el)=>[n,...n.children.flatMap(nodes)],input=nodes().find(n=>n.tag==='input'),click=label=>nodes().find(n=>n.tag==='button'&&n.textContent===label).click();
 return {requests,input,click,screen:current,nodes,change:value=>{input.value=value;input.events.input();},flush:()=>{const pending=[...timers.values()];timers.clear();pending.forEach(v=>v.fn());},history:()=>f.run('historyTerms(searchOwner())'),primary:()=>requests.filter(r=>/^search(?:\?|\/filters\?)/.test(r.path)),changeScope:()=>{scope='foreign';}};
}
test('TV draft pauses and focus do not submit primary/NLP/history; Enter submits only the committed full query',()=>{
 const f=searchFlow();for(const draft of ['D','Du','Duna']){f.change(draft);f.flush();assert.equal(f.primary().length,0);assert.deepEqual(f.history(),[]);}
 f.screen.onBlur();f.screen.el.hidden=false;f.screen.onShow();assert.equal(f.primary().length,0,'focus must not commit a draft');
 const form=f.nodes().find(n=>n.tag==='form');form.onsubmit({preventDefault(){}});
 assert.equal(f.primary().length,1);assert.equal(new URLSearchParams(f.primary()[0].path.split('?')[1]).get('q'),'Duna');assert.deepEqual(f.history(),['Duna']);
 f.primary()[0].done(null,{results:[{id:4,title:'Duna',type:'movie'}],total:1});assert.equal(f.nodes().filter(n=>n.tag==='card').length,1);
 f.screen.onBlur();f.screen.el.hidden=false;f.screen.onShow();assert.equal(f.primary().length,1,'focus restores policy-matched results without another primary query');assert.equal(f.nodes().filter(n=>n.tag==='card').length,1);
 const old=f.nodes().find(n=>n.tag==='card');f.change('new draft');f.flush();assert.equal(f.nodes().filter(n=>n.tag==='card').length,0);old.click();assert.equal(f.requests.filter(r=>r.path==='track-search').length,0);
 f.change('');f.flush();assert.equal(f.primary().length,1);assert.equal(f.nodes().some(n=>n.textContent==='Poslední hledání'),true);
});
test('TV suggestion confirmation and retry preserve the committed query while detached retries and foreign owners cannot submit',()=>{
 const f=searchFlow();f.change('Du');f.flush();f.click('Duna');assert.equal(f.primary().length,1);assert.equal(f.input.value,'Duna');
 f.primary()[0].done({message:'synthetic failure'});f.click('Zkusit znovu');assert.equal(f.primary().length,2);assert.equal(f.primary()[1].path,f.primary()[0].path);
 f.primary()[1].done({message:'synthetic failure'});const oldRetry=f.nodes().find(n=>n.textContent==='Zkusit znovu');f.change('different');oldRetry.click();f.flush();assert.equal(f.primary().length,2);
 f.changeScope();f.click('Hledat');assert.equal(f.primary().length,2);
});

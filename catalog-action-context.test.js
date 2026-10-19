'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
let next=0;
async function fixture(){
 const runtime={context:'adult-owner',hash:'#search',listeners:new Map(),buttons:[]},key='catalog_action_fixture_'+next++;globalThis[key]=runtime;
 const original=await fs.readFile('app/catalog.js','utf8'),names=new Set();
 const source=original.replace(/^import\s*\{([\s\S]*?)\}\s*from\s+["'][^"']+["'];\n/gm,(_,list)=>{for(const n of list.split(','))if(n.trim())names.add(n.trim().split(/\s+as\s+/).pop());return '';});
 const prefix=`const runtime=globalThis[${JSON.stringify(key)}];const location={get hash(){return runtime.hash}};const document={addEventListener(k,f){runtime.listeners.set(k,f)},querySelector(){return null}};`+[...names].map(n=>n==='button'?'const button=(label,click)=>{const node={label,click};runtime.buttons.push(node);return node;};':n==='apiContextKey'?'const apiContextKey=()=>runtime.context;':`const ${n}=()=>undefined;`).join('');
 const module=await import('data:text/javascript;base64,'+Buffer.from(prefix+source+'\nexport {catalogActionGuard};').toString('base64'));delete globalThis[key];return {runtime,module};
}
test('catalog action admission rejects aborted routes, foreign contexts, hash changes and detached screens before an action',async()=>{
 const {runtime,module}=await fixture();
 for(const change of [(_r,c)=>c.abort(),r=>{r.context='kids-owner'},r=>{r.hash='#movies'},(_r,_c,connected)=>{connected.value=false}]){
  runtime.context='adult-owner';runtime.hash='#search';const c=new AbortController(),connected={value:true},admit=module.catalogActionGuard(c.signal,()=>connected.value);let mutations=0;
  const queued=()=>{if(admit())mutations++};queued();assert.equal(mutations,1);change(runtime,c,connected);queued();assert.equal(mutations,1);
 }
});
test('same-owner effective-policy change invalidates held actions but unrelated catalogue cache refresh does not',async()=>{
 const {runtime,module}=await fixture(),c=new AbortController(),admit=module.catalogActionGuard(c.signal,()=>true);
 assert.equal(admit(),true);module.resetCatalogCache();assert.equal(admit(),true,'watch/personal cache invalidation is not a policy change');
 runtime.listeners.get('movly:effective-policy-changed')();assert.equal(admit(),false);
 const fresh=module.catalogActionGuard(c.signal,()=>true);assert.equal(fresh(),true,'new screen admits its current policy generation');
});

test('Search pagination checks the captured admission before changing route',async()=>{
 const {runtime,module}=await fixture(),admit=module.catalogActionGuard(undefined,()=>true);
 module.pagination('search',new URLSearchParams('q=old'),1,2,admit);
 runtime.context='new-profile';runtime.buttons[1].click();assert.equal(runtime.hash,'#search');
});

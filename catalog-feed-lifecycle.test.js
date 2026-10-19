'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');let sequence=0;
async function fixture(){
 const runtime={context:'owner:profile:environment:session',pending:[],policies:[]},name='typed_feed_fixture_'+sequence++;globalThis[name]=runtime;
 const names=new Set(),source=(await fs.readFile('app/catalog.js','utf8')).replace(/^import\s*\{([\s\S]*?)\}\s*from\s+["'][^"']+["'];\n/gm,(_,list)=>{for(const n of list.split(','))if(n.trim())names.add(n.trim().split(/\s+as\s+/).pop());return '';});
 const stubs={apiContextKey:'()=>runtime.context',api:'(path,options)=>new Promise(resolve=>runtime.pending.push({path,options,resolve}))',effectiveContentPolicy:'async options=>{runtime.policies.push(options);return{revision:"p"}}',assertEffectivePolicyUnchanged:'async()=>{}',array:'value=>Array.isArray(value)?value:[]',warning:'()=>null',loading:'()=>({loading:true})'};
 const prefix=`const runtime=globalThis[${JSON.stringify(name)}],document={addEventListener(){},querySelector(){return null}},window={addEventListener(){}},location={hash:"#movies"};`+[...names].map(n=>`const ${n}=${stubs[n]||'()=>undefined'};`).join('');
 const module=await import('data:text/javascript;base64,'+Buffer.from(prefix+source+'\nexport{revalidateCatalog,catalogCache,catalogKey};').toString('base64'));delete globalThis[name];
 const rails={children:[],replaceChildren(...items){this.children=items}},page={isConnected:true,dataset:{catalogType:'movie'},movlyCatalogContext:runtime.context,querySelector(){return rails}};module.catalogCache.set(module.catalogKey('movie'),{data:{lists:[],marker:'old'}});return{runtime,module,page,rails};
}
test('Required typed refresh replaces loading even when server lists are unchanged',async()=>{
 const{runtime,module,page,rails}=await fixture(),run=module.revalidateCatalog('movie',page,{},undefined,true);await Promise.resolve();assert.equal(rails.children[0].loading,true);assert.equal(runtime.pending[0].path,'main?type=movie&limit=30');runtime.pending[0].resolve({lists:[],marker:'fresh'});await run;assert.deepEqual(rails.children,[]);assert.equal(module.catalogCache.get(module.catalogKey('movie')).data.marker,'fresh');
});
test('An older typed response cannot overwrite the newer admitted feed',async()=>{
 const{runtime,module,page}=await fixture(),old=module.revalidateCatalog('movie',page,{},undefined,true),newer=module.revalidateCatalog('movie',page,{},undefined,true);await Promise.resolve();runtime.pending[1].resolve({lists:[],marker:'new'});await newer;runtime.pending[0].resolve({lists:[],marker:'late-old'});await old;assert.equal(module.catalogCache.get(module.catalogKey('movie')).data.marker,'new');
});
test('Aborted route drops its late content and does not own a shared policy probe',async()=>{
 const{runtime,module,page}=await fixture(),route=new AbortController(),run=module.revalidateCatalog('movie',page,{},route.signal,true);await Promise.resolve();assert.equal(runtime.policies[0].signal,undefined);assert.equal(runtime.pending[0].options.signal,route.signal);route.abort();runtime.pending[0].resolve({lists:[],marker:'late'});await run;assert.equal(module.catalogCache.get(module.catalogKey('movie')).data.marker,'old');
});

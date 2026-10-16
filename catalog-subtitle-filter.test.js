'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
// Loads the real catalog filter helpers with every import replaced by a stub.
async function catalog(){
 const original=await fs.readFile('app/catalog.js','utf8');
 const names=new Set();
 const source=original.replace(/^import\s*\{([\s\S]*?)\}\s*from\s+["'][^"']+["'];\n/gm,(_,list)=>{for(const n of list.split(','))if(n.trim())names.add(n.trim().split(/\s+as\s+/).pop());return '';});
 assert.doesNotMatch(source,/^import /m);
 const prefix='const document={addEventListener(){}};'+[...names].map(n=>n==='translateUI'?'const translateUI=(s,...v)=>s.replace(/\\{(\\d)\\}/g,(_,i)=>v[i]);':`const ${n}=()=>undefined;`).join('');
 return import('data:text/javascript;base64,'+Buffer.from(prefix+source+'\nexport {paramsToDefinition,definitionToParams,definitionQuery,hasCriteria,definitionChips};\n').toString('base64'));
}
test('subtitle languages round-trip through grid URL, API query and chips',async()=>{
 const c=await catalog();
 const d=c.paramsToDefinition(new URLSearchParams('view=grid&sub=EN,cs,cs,c1'),'movie');
 assert.deepEqual(d.subtitle_languages,['cs','en']);
 assert.equal(c.hasCriteria(d),true);
 assert.equal(c.definitionToParams(d).get('sub'),'cs,en');
 assert.equal(c.definitionQuery(d).get('subtitle_language'),'cs,en');
 assert.ok(c.definitionChips(d,new Map()).includes('titulky CS, EN'));
 const none=c.paramsToDefinition(new URLSearchParams('view=grid'),'movie');
 assert.deepEqual(none.subtitle_languages,[]);
 assert.equal(c.definitionQuery(none).has('subtitle_language'),false);
 assert.equal(c.hasCriteria(none),false);
});
test('a saved filter from another app keeps its subtitle languages',async()=>{
 const c=await catalog();
 const saved={type:'movie',subtitle_languages:['sk','cs'],sort_by:'popularity'};
 const back=c.paramsToDefinition(c.definitionToParams(saved),'movie');
 assert.deepEqual(back.subtitle_languages,['cs','sk']);
});

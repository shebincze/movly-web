'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
// Loads the real catalog filter helpers with every import replaced by a stub.
async function catalog(){
 const original=await fs.readFile('app/catalog.js','utf8');
 const names=new Set();
 const source=original.replace(/^import\s*\{([\s\S]*?)\}\s*from\s+["'][^"']+["'];\n/gm,(_,list)=>{for(const n of list.split(','))if(n.trim())names.add(n.trim().split(/\s+as\s+/).pop());return '';});
 assert.doesNotMatch(source,/^import /m);
 const prefix='const document={addEventListener(){}};'+[...names].map(n=>n==='translateUI'?'const translateUI=(s,...v)=>s.replace(/\\{(\\d)\\}/g,(_,i)=>v[i]);':`const ${n}=()=>undefined;`).join('');
 return import('data:text/javascript;base64,'+Buffer.from(prefix+source+'\nexport {paramsToDefinition,definitionToParams,definitionQuery,hasCriteria,definitionChips,searchParams};\n').toString('base64'));
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
test('Search keeps a numeric title query separate from video quality',async()=>{
 const c=await catalog();
 const d=c.paramsToDefinition(new URLSearchParams('q=1917&quality=2160&yf=2000'),null,{grid:false});
 assert.equal(d.video_height_min,2160);
 assert.equal(d.year_from,2000);
 assert.equal(c.paramsToDefinition(new URLSearchParams('q=1917'),null,{grid:false}).video_height_min,null);
 assert.equal(c.paramsToDefinition(new URLSearchParams('quality=1080'),null,{grid:false}).video_height_min,1080);
 // Existing Movies/Series grid links retain their historical q=quality contract.
 assert.equal(c.paramsToDefinition(new URLSearchParams('q=2160'),'movie').video_height_min,2160);
});
test('saved filters use quality rather than the Search text query parameter',async()=>{
 const c=await catalog();
 const saved={type:'movie',video_height_min:2160,subtitle_languages:['cs'],sort_by:'rating'};
 const params=c.definitionToParams(saved,{grid:false});
 assert.equal(params.get('quality'),'2160');
 assert.equal(params.has('q'),false);
 assert.equal(c.paramsToDefinition(params,'movie',{grid:false}).video_height_min,2160);
 assert.equal(c.definitionToParams(saved).get('q'),'2160');
});
test('changing or clearing Search text keeps criteria and resets pagination',async()=>{
 const c=await catalog();
 const applied=new URLSearchParams('q=old&quality=2160&t=movie&yf=2000&sub=cs,en&page=4&unknown=discard');
 const changed=c.searchParams(applied,' 1917 ');
 assert.equal(changed.get('q'),'1917');
 for(const key of ['quality','t','yf','sub']) assert.equal(changed.get(key),applied.get(key));
 assert.equal(changed.has('page'),false);
 assert.equal(changed.has('unknown'),false);
 const empty=c.searchParams(applied,'');
 assert.equal(empty.has('q'),false);
 assert.equal(empty.get('quality'),'2160');
});

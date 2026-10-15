const {test}=require('node:test');const assert=require('node:assert/strict');
const {createWorkTiming}=require('./playback-work-timing');
const id='a'.repeat(32);
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v}};}
test('invalid identifiers create no observer or response changes',()=>{for(const value of [null,'',id.toUpperCase(),id+'a',['a']]){const res=response();assert.equal(createWorkTiming(value,res),null);assert.deepEqual(res.headers,{});}});
test('closed host-local timing measures held work and never reflects arbitrary names/outcomes',async()=>{
 let now=0;const res=response(),t=createWorkTiming(id,res,()=>now);let release;const pending=t.measure('bff_source_resolve',()=>new Promise(r=>release=r));now=42;release(7);assert.equal(await pending,7);assert.equal(res.headers['Server-Timing'],'bff_source_resolve;dur=42.000;desc="success"');
 await assert.rejects(t.measure('bff_probe',async()=>{now=55;throw Object.assign(Error('SENSITIVE'),{name:'AbortError'});}));
 assert.match(res.headers['Server-Timing'],/bff_probe;dur=13.000;desc="cancelled"/);
 await t.measure('SENSITIVE',async()=>{});assert(!res.headers['Server-Timing'].includes('SENSITIVE'));
});
test('Go timings require matching admitted echo and closed bounded grammar; duplicates and huge headers ignored',()=>{
 const res=response(),t=createWorkTiming(id,res);const h=(s,echo=id)=>new Headers({'server-timing':s,'x-movly-playback-attempt':echo});
 t.merge(h('movly_probe_wait;dur=12.000;desc="success"','b'.repeat(32)));assert.equal(res.headers['Server-Timing'],undefined);
 t.merge(h('total;dur=3, movly_probe_wait;dur=12.000;desc="success", private;dur=1;desc="TOKEN"'));
 assert.equal(res.headers['Server-Timing'],'movly_probe_wait;dur=12.000;desc="success"');
 t.merge(h('movly_probe_wait;dur=99.000;desc="failure"'));t.merge(h('x'.repeat(1025)));assert(!res.headers['Server-Timing'].includes('99.000'));
});
test('request-local count and duration stay bounded and completed responses are immutable',async()=>{
 const res=response();let now=0;const t=createWorkTiming(id,res,()=>now);
 for(const name of ['bff_source_discovery','bff_source_resolve','bff_session_prepare','bff_probe','bff_init'])await t.measure(name,async()=>{now+=999999;});
 t.merge(new Headers({'x-movly-playback-attempt':id,'server-timing':'movly_stream_read;dur=999999.000;desc="success", movly_probe_wait;dur=1.000;desc="success", movly_profile_policy;dur=1.000;desc="success"'}));
 const header=res.headers['Server-Timing'];assert.equal(header.split(',').length,8);assert(Buffer.byteLength(header)<=1024);assert(!header.includes('999999'));res.headersSent=true;await t.measure('bff_probe',async()=>{});assert.equal(res.headers['Server-Timing'],header);
});

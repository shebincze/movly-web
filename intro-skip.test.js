const {test}=require('node:test');
const assert=require('node:assert/strict');
const segment={id:'intro',kind:'intro',start_ms:10000,end_ms:70000,source:'fixture',auto_eligible:true};
const tick=(m,p,n,more={})=>m.tick({position:p,duration:180000,now:n,playing:true,canSeek:true,mode:'auto',segments:[segment],...more});
test('auto countdown observes seek before offering undo, rewind suppresses repeat',async()=>{
 const {IntroSkipMachine}=await import('./app/intro-skip-policy.js');const m=new IntroSkipMachine();
 assert.equal(tick(m,10000,0),null);assert.equal(m.countdown,3);assert.equal(tick(m,13000,3000),70000);assert.equal(m.undoPosition,null);
 assert.equal(tick(m,70000,3250),null);assert.equal(m.undo(),13000);assert.equal(tick(m,13000,4000),null);assert.equal(tick(m,18000,9000),null);assert.ok(m.offer);assert.equal(m.countdown,null);
});
test('cancel, pause, guest and off never perform automatic seek',async()=>{
 const {IntroSkipMachine}=await import('./app/intro-skip-policy.js');for(const more of [{playing:false},{canSeek:false},{mode:'off'}]){const m=new IntroSkipMachine();tick(m,10000,0,more);assert.equal(tick(m,15000,5000,more),null);}
 const m=new IntroSkipMachine();tick(m,10000,0);m.cancel();assert.equal(tick(m,15000,5000),null);assert.equal(m.countdown,null);
});
test('failed seek suppresses another automatic attempt',async()=>{
 const {IntroSkipMachine}=await import('./app/intro-skip-policy.js');const m=new IntroSkipMachine();tick(m,10000,0);m.request(10000,0);tick(m,19000,9000);assert.equal(tick(m,23000,13000),null);assert.equal(m.countdown,null);
});
test('invalid intervals and uncorroborated results cannot auto-skip',async()=>{
 const {IntroSkipMachine}=await import('./app/intro-skip-policy.js');for(const bad of [{...segment,start_ms:-1},{...segment,end_ms:190000},{...segment,end_ms:11000}]){const m=new IntroSkipMachine();tick(m,10000,0,{segments:[bad]});assert.equal(m.offer,null);}
 const m=new IntroSkipMachine();tick(m,10000,0,{segments:[{...segment,auto_eligible:false}]});assert.ok(m.offer);assert.equal(tick(m,15000,5000,{segments:[{...segment,auto_eligible:false}]}),null);
});
test('bounded persistent cache isolates profile and release, stale entries are manual only',async()=>{
 const {readIntroCache,writeIntroCache}=await import('./app/intro-skip-policy.js');const map=new Map();const storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};const value={segments:[segment],duration_ms:180000,expires_at:2000,stale:false};
 writeIntroCache(storage,'profile1.release1',value,1000000);assert.equal(readIntroCache(storage,'profile2.release1',1000000),null);assert.equal(readIntroCache(storage,'profile1.release2',1000000),null);
 assert.equal(readIntroCache(storage,'profile1.release1',1500000).stale,false);assert.equal(readIntroCache(storage,'profile1.release1',2500000).segments[0].auto_eligible,false);
 assert.equal(readIntroCache(storage,'profile1.release1',1000000+7*86400000),null);
 for(let i=0;i<220;i++)writeIntroCache(storage,'key'+i,value,1000000+i);assert.equal(Object.keys(JSON.parse(map.values().next().value)).length,200);
});

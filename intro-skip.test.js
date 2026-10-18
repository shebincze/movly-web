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
// #1110: recap/credits/post_credits kinds, fixture copied from the main repo (test-support/intro-segments-fixture-source.md).
const fixture=JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname,'test-support/intro-segments-kinds.response.json'),'utf8'));
const D=fixture.duration_ms, credits={id:'credits:3590000:3690000',kind:'credits',start_ms:3590000,end_ms:3690000,source:'introdb',auto_eligible:false};
test('fixture parses: four kinds sorted by start, ids encode kind:start:end, only intro/recap may auto',()=>{
 assert.deepEqual(fixture.segments.map(s=>s.kind),['recap','intro','credits','post_credits']);
 for(const s of fixture.segments){assert.equal(s.id,`${s.kind}:${s.start_ms}:${s.end_ms}`);assert.deepEqual(Object.keys(s).sort(),['auto_eligible','end_ms','id','kind','source','start_ms']);if(!['intro','recap'].includes(s.kind))assert.equal(s.auto_eligible,false);}
 assert.deepEqual([...fixture.segments].sort((a,b)=>a.start_ms-b.start_ms),fixture.segments);
 // Old intro-only filter (pre-#1110 clients) still picks exactly the unchanged intro record.
 assert.deepEqual(fixture.segments.filter(s=>s.kind==='intro'),[{id:'intro:50000:110000',kind:'intro',start_ms:50000,end_ms:110000,source:'theintrodb',auto_eligible:true}]);
});
test('recap goes through the skip machine, unknown kinds are ignored',async()=>{
 const {IntroSkipMachine}=await import('./app/intro-skip-policy.js');const run=(p,n,more={})=>m.tick({position:p,duration:D,now:n,playing:true,canSeek:true,mode:'auto',segments:fixture.segments,...more});
 let m=new IntroSkipMachine();assert.equal(run(1000,0),null);assert.equal(m.offer.kind,'recap');assert.equal(m.countdown,null,'recap auto_eligible=false stays manual');
 assert.equal(m.request(1000,0),45000);
 m=new IntroSkipMachine();const recap={...fixture.segments[0],auto_eligible:true};assert.equal(run(1000,0,{segments:[recap]}),null);assert.equal(m.countdown,3);assert.equal(run(4000,3000,{segments:[recap]}),45000);
 m=new IntroSkipMachine();run(60000,0);assert.equal(m.offer.kind,'intro');
 for(const kind of ['credits','post_credits','preview','Intro']){m=new IntroSkipMachine();run(3600000,0,{segments:[{...credits,kind,id:kind}]});assert.equal(m.offer,null,kind);}
 m=new IntroSkipMachine();run(20000,0,{segments:[{...fixture.segments[1],kind:'sponsor',start_ms:10000,id:'x'}]});assert.equal(m.offer,null);
});
test('credits offer: next episode only when nothing follows, otherwise skip',async()=>{
 const {creditsOffer}=await import('./app/intro-skip-policy.js');const ep=[credits];
 assert.deepEqual(creditsOffer(3600000,3700000,ep,'manual',true,true,false),{segment:credits,action:'nextEpisode'});
 assert.deepEqual(creditsOffer(3600000,3700000,ep,'auto',true,true,false),{segment:credits,action:'nextEpisode'});
 // Movie / last episode: credits to (near) the end skip to duration-1000 so the player ends naturally.
 assert.deepEqual(creditsOffer(3600000,3700000,ep,'manual',true,false,false),{segment:credits,action:'skip',target:3690000});
 const toEnd={...credits,end_ms:3700000};assert.deepEqual(creditsOffer(3600000,3700000,[toEnd],'manual',true,false,false),{segment:toEnd,action:'skip',target:3699000});
 // post_credits after credits: never skip it with Další díl, jump to credits end.
 assert.deepEqual(creditsOffer(3600000,D,fixture.segments,'manual',true,true,false),{segment:fixture.segments[2],action:'skip',target:3690000});
 // Content after credits (end >15 s before the end) also means skip.
 assert.deepEqual(creditsOffer(3600000,3706000,ep,'manual',true,true,false),{segment:credits,action:'skip',target:3690000});
 assert.equal(creditsOffer(3600000,3705000,ep,'manual',true,true,false).action,'nextEpisode');
 // Short or misplaced post_credits does not count.
 assert.equal(creditsOffer(3600000,3700000,[credits,{...fixture.segments[3],end_ms:3691000}],'manual',true,true,false).action,'nextEpisode');
 assert.equal(creditsOffer(3600000,3700000,[credits,{...fixture.segments[3],start_ms:3500000,end_ms:3520000}],'manual',true,true,false).action,'nextEpisode');
 // post_credits itself is never offered.
 assert.equal(creditsOffer(3695000,D,fixture.segments,'manual',true,true,false),null);
});
test('credits offer hides for off mode, missing rights, visible up-next and outside the window',async()=>{
 const {creditsOffer}=await import('./app/intro-skip-policy.js');const ep=[credits];
 assert.equal(creditsOffer(3600000,3700000,ep,'off',true,true,false),null);
 assert.equal(creditsOffer(3600000,3700000,ep,'manual',false,true,false),null);
 assert.equal(creditsOffer(3600000,3700000,ep,'manual',true,true,true),null);
 assert.equal(creditsOffer(3589999,3700000,ep,'manual',true,true,false),null);
 assert.equal(creditsOffer(3688000,3700000,ep,'manual',true,true,false),null);
 assert.ok(creditsOffer(3687999,3700000,ep,'manual',true,true,false));
 for(const bad of [{...credits,start_ms:-1},{...credits,end_ms:3591000},{...credits,end_ms:3700001},{...credits,start_ms:3698500,end_ms:3700000}])
  assert.equal(creditsOffer(bad.start_ms+100,3700000,[bad],'manual',true,true,false),null,JSON.stringify(bad));
});
test('chapter intro replaces only API intro, recap and credits stay',async()=>{
 const {mergeChapterIntros,chapterIntros}=await import('./app/intro-skip-policy.js');
 const merged=mergeChapterIntros([{name:'Intro',start:48,end:108}],fixture.segments);
 assert.deepEqual(merged.map(s=>s.id),['recap:0:45000','chapter:48','credits:3590000:3690000','post_credits:3690000:3700000']);
 assert.equal(mergeChapterIntros([{name:'Kapitola 1',start:0,end:600}],fixture.segments),fixture.segments);
 assert.deepEqual(chapterIntros([{name:'Opening',start:1,end:61}])[0].kind,'intro');
});
test('cache uses v2 key and drops intro-only v1 entries',async()=>{
 const {readIntroCache,writeIntroCache,INTRO_CACHE_KEY}=await import('./app/intro-skip-policy.js');assert.equal(INTRO_CACHE_KEY,'movly.intro.segments.v2');
 const map=new Map([['movly.intro.segments.v1',JSON.stringify({k:{value:{segments:[segment],expires_at:9e9},saved:1000000}})]]);
 const storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 assert.equal(readIntroCache(storage,'k',1000000),null,'v1 answers are not read');
 writeIntroCache(storage,'k',fixture,1000000);assert.ok(!map.has('movly.intro.segments.v1'));
 assert.deepEqual(readIntroCache(storage,'k',1000000).segments.map(s=>s.kind),['recap','intro','credits','post_credits']);
});

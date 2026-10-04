const {test}=require('node:test');
const assert=require('node:assert/strict');
const clock=import('./app/party-clock.js');
const base={status:'playing',position_sec:0,rate:1,position_updated_at:'2026-10-05T00:00:04Z',preparation:{started_at:'2026-10-05T00:00:00Z',released_at:'2026-10-05T00:00:04Z'}};
test('party waits until calibrated server deadline and never extrapolates before it',async()=>{
 const c=await clock, now=Date.parse('2026-10-05T00:00:02Z');
 assert.equal(c.waitingForParty(base,now,1000),true);
 assert.equal(c.effectivePartyPosition(base,now,1000),0);
 assert.equal(c.waitingForParty(base,now,2000),false);
 assert.equal(c.effectivePartyPosition(base,now,2500),.5);
});
test('missing or malformed release keeps players waiting',async()=>{
 const c=await clock;
 for(const release of [null,'invalid']) assert.equal(c.waitingForParty({...base,preparation:{...base.preparation,released_at:release}},Date.now(),0),true);
});
test('shared pause fixes every player at the commanded position regardless of clock offset',async()=>{
 const c=await clock;
 assert.equal(c.effectivePartyPosition({...base,status:'paused',position_sec:42},Date.now(),8000),42);
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const modulePromise = import("./app/home-state.js");
const row = (slug = "db-row", key = "source", state = "ready") => ({ slug, content_key: key, kind: "rail", name: "Řada", state, items: [{ title: { id: 42, title: "Film" } }], display_order: 2 });
test("Home accepts database order and arbitrary slugs, rejects duplicate/version/invalid arrays", async () => {
 const { homeSections } = await modulePromise;
 assert.deepEqual(homeSections({version:1,sections:[row(),{...row("hero"),display_order:1}]}).map(r=>r.slug),["hero","db-row"]);
 for(const data of [{version:2,sections:[]},{version:1,sections:[row(),row()]},{version:1,sections:[{...row(),items:{}}]}]) assert.throws(()=>homeSections(data));
});
test("failure retention respects source identity and removed rows",async()=>{
 const {retainHome}=await modulePromise;const old=row();
 assert.equal(retainHome([{...row("db-row","source","error"),items:[]}],[old])[0].items[0].title.id,42);
 assert.deepEqual(retainHome([{...row("db-row","changed","error"),items:[]}],[old])[0].items,[]);
 assert.deepEqual(retainHome([], [old]), []);
});
test("Home paging always uses the same endpoint and rejects mixed selectors",async()=>{
 const {homeQuery}=await modulePromise;
 assert.match(homeQuery({section:"arbitrary-db",page:2}),/^home\?include_highlights=true&page=2&section=arbitrary-db$/);
 assert.match(homeQuery({collection:"saga"}),/collection=saga/);
 for(const args of [{section:"a",collection:"b"},{page:0},{section:"../x"}]) assert.throws(()=>homeQuery(args));
});
test("continue shows actual resume or next episode, upcoming uses verified metadata",async()=>{
 const {homeCaption}=await modulePromise;
 const item={title:{id:42},watch_progress:{watch_status:"watching",progress_seconds:90,duration_seconds:1200,season_number:2,episode_number:9,next_season_number:3,next_episode_number:1}};
 assert.equal(homeCaption({kind:"continue"},item),"S2 · E9 · 1:30 / 20:00");item.watch_progress.watch_status="watched";
 assert.equal(homeCaption({kind:"continue"},item),"Další díl · S3 · E1");
 assert.equal(homeCaption({kind:"upcoming",premieres:[{title_id:42,service_name:"Netflix",release_date:"2026-10-15"}]},item),"Netflix 15.10.2026");
});
test("tracking requires complete server metadata, never infers recommendation identity",async()=>{
 const {recommendationAction}=await modulePromise;
 assert.equal(recommendationAction({id:42},"view"),null);
 const item={id:42,tracking:{request_id:"rec-test",title_id:42,position:1,section:"for_you",list_slug:"recommendations"}};
 assert.equal(recommendationAction(item,"click").action,"click");item.tracking.title_id=99;assert.equal(recommendationAction(item,"view"),null);
});

test("visible impressions deduplicate across refresh/navigation and isolate owners",async()=>{
 const {HomeImpressions}=await modulePromise;const ledger=new HomeImpressions(2);
 const item={id:42,tracking:{request_id:"rec-test",title_id:42,position:1,section:"for_you",list_slug:"recommendations"}};
 const owner={accountId:1,profileId:1};assert.equal(ledger.claim(owner,item),true);assert.equal(ledger.claim(owner,item),false);
 assert.equal(ledger.claim({...owner,profileId:2},item),true);
 ledger.release(owner,item);assert.equal(ledger.claim(owner,item),true);
 ledger.clear();assert.equal(ledger.claim(owner,item),true);
 assert.equal(ledger.claim(owner,{id:42}),false);
});

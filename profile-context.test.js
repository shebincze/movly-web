"use strict";
const {test}=require("node:test");const assert=require("node:assert/strict");
test("late responses and revocation errors cannot publish into a new profile context",async()=>{
 const {api,invalidateApiContext}=await import("./app/api.js");
 const originalFetch=global.fetch, originalWindow=global.window;
 let finish,revocations=0;
 global.window={dispatchEvent(){revocations++;}};
 try{
  for(const status of [200,401]){
   global.fetch=()=>new Promise(resolve=>{finish=resolve;});
   invalidateApiContext({accountId:1,profile:{id:1}});
   const pending=api("main?type=movie");
   invalidateApiContext({accountId:1,profile:{id:2}});
   finish(new Response(JSON.stringify({lists:[{slug:"old-profile"}],code:"session_revoked"}),{status,headers:{"content-type":"application/json"}}));
   await assert.rejects(pending,{name:"AbortError"});
  }
  assert.equal(revocations,0);
  global.fetch=async(_url,options)=>{
   assert.equal(options.headers["X-Movly-Expected-Account"],"1");
   assert.equal(options.headers["X-Movly-Expected-Profile"],"2");
   return new Response(JSON.stringify({lists:[{slug:"new-profile"}]}));
  };
  assert.equal((await api("main?type=movie")).lists[0].slug,"new-profile");
 }finally{global.fetch=originalFetch;global.window=originalWindow;invalidateApiContext();}
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createAppHandler}=require('./app-server'),{createFixture}=require('./test-support/app-fixture.cjs');
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(holdTitle=false){
 const entered=deferred(),release=deferred(),closed=deferred(),done=deferred(),bodyClosed=deferred();let deleted=0,createdOwner=null;
 const titleEntered=deferred(),releaseTitle=deferred();let starts=0;const api=createFixture(),id='a'.repeat(48);
 const engine={async start(s){starts++;createdOwner={token:s.token,device:s.device,profile:s.profile.id};entered.resolve();await release.promise;return {id};},async handle(s,req,_res,target){assert.equal(target,id);assert.equal(req.method,'DELETE');assert.deepEqual({token:s.token,device:s.device,profile:s.profile.id},createdOwner);deleted++;return {stopped:true};}};
 const handler=createAppHandler({secret:'synthetic-abandoned-playback-only',production:false,HttpError,playbackEngine:engine,readBody:async req=>{let raw='';for await(const c of req)raw+=c;return raw?JSON.parse(raw):{};},json:(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));},api:async(path,...args)=>{if(holdTitle&&path.startsWith('v1/titles/1?')){titleEntered.resolve();await releaseTitle.promise;}return path.startsWith('v1/streaming/titles/1/streams')?{payload:{streams:[{id:11,provider_name:'Hellspy',source_stream_id:'42/hash',available:true}]}}:api(path,...args);}});
 const server=http.createServer(async(req,res)=>{const creating=req.url==='/api/app/playback'&&req.method==='POST';if(creating){req.once('close',()=>bodyClosed.resolve());res.once('close',()=>closed.resolve());}try{await handler(req,res,new URL(req.url,'http://localhost'));}catch(e){if(!res.destroyed){res.writeHead(e.status||500);res.end(JSON.stringify({message:e.message}));}}finally{if(creating)done.resolve();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 async function request(path,body,cookie,extra={}){return fetch(origin+'/api/app/'+path,{method:body?'POST':'GET',headers:{origin,host:new URL(origin).host,'X-Movly-App':'1','Content-Type':'application/json',...(cookie?{cookie}:{}),...(extra.headers||{})},...(body?{body:JSON.stringify(body)}:{}),...(extra.signal?{signal:extra.signal}:{})});}
 const login=await request('login',{username:'test',password:'movly-test'}),loginCookie=login.headers.get('set-cookie').split(';')[0];await login.text();const profile=await request('profile',{id:1},loginCookie),cookie=profile.headers.get('set-cookie').split(';')[0];await profile.text();
 return {origin,request,cookie,entered,release,closed,done,bodyClosed,titleEntered,releaseTitle,counts:()=>({starts,deleted,createdOwner}),close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})};
}
for(const mode of ['cancel','owner','normal'])test(`actual HTTP ${mode} playback creation cleans only abandoned response under captured owner`,async()=>{
 const h=await fixture();try{const controller=new AbortController();const result=h.request('playback',{title_id:1,source:'human',stream_id:11},h.cookie,{signal:controller.signal,headers:{'X-Movly-Playback-Attempt':'b'.repeat(32)}}).catch(e=>e);await h.entered.promise;
 if(mode==='owner'){const switched=await h.request('profile',{id:2,pin:'1234'},h.cookie);assert.equal(switched.status,200);assert.equal((await switched.json()).profile.id,2);}
 if(mode!=='normal'){controller.abort();await h.closed.promise;}else await h.bodyClosed.promise;
 h.release.resolve();const response=await result;await h.done.promise;
 if(mode==='normal'){assert.equal(response.status,200);assert.equal((await response.json()).id,'a'.repeat(48));assert.equal(h.counts().deleted,0);}else{assert.equal(response.name,'AbortError');assert.equal(h.counts().deleted,1);assert.equal(h.counts().createdOwner.profile,1);}
 }finally{h.release.resolve();await h.close();}
});

test('actual HTTP abandonment during title resolution never admits engine start',async()=>{const h=await fixture(true);try{const controller=new AbortController();const pending=h.request('playback',{title_id:1,source:'human',stream_id:11},h.cookie,{signal:controller.signal}).catch(e=>e);await h.titleEntered.promise;controller.abort();await h.closed.promise;h.release.resolve();h.releaseTitle.resolve();await pending;await h.done.promise;assert.equal(h.counts().starts,0);assert.equal(h.counts().deleted,0);}finally{h.releaseTitle.resolve();h.release.resolve();await h.close();}});

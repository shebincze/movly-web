'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{createAppHandler}=require('./app-server');
class HttpError extends Error{constructor(status,message,extra={}){super(message);this.status=status;this.payload=extra;}}
function fixture(){let revision=0,wrong=false,locked=false,sameReceipt=false,wrongPage=false;const calls=[],user={id:1,username:'fixture',is_active:true,is_verified:true};const doc=()=>({profile_id:wrong?9:2,revision:sameReceipt?Math.max(0,revision-1):revision,catalog_revision:'a'.repeat(64),sections:[{slug:'hero',kind:'hero',name:'Server Hero',visible:true,display_order:0,default_order:0}]});
 const handler=createAppHandler({secret:'synthetic-home-preferences',production:false,HttpError,readBody:async req=>req.body,json:(res,status,body)=>{res.status=status;res.body=body;res.writableEnded=true;res.emit('close');},api:async(path,method,body)=>{calls.push({path,method,body});if(path==='v1/auth/login')return{payload:{token:'fixture',user}};if(path.startsWith('v1/main/lists/'))return{payload:{items:[]}};if(path==='v1/auth/me')return{payload:user};if(path==='v1/profiles')return{payload:[{id:2,name:'Fixture',max_certification:18}]};if(path==='v1/profiles/2/select')return{payload:{profile_id:2,name:'Fixture'}};if(path.startsWith('v1/home/preferences?')||/^v1\/pages\/(home|movies|series)\/preferences\?/.test(path)){if(locked)throw new HttpError(403,'PIN required',{code:'profile_grant_required'});if(method==='PUT'){if(body.revision!==revision||body.catalog_revision!=='a'.repeat(64))throw new HttpError(409,'Conflict',{code:'home_preferences_conflict'});revision++;}return{payload:path.startsWith('v1/pages/')?{...doc(),page:wrongPage?'series':path.split('/')[2]}:doc()};}throw Error(path);}});
 async function request(method,path,body,cookie='',headers={}){const req=Object.assign(new EventEmitter(),{method,body,headers:{host:'localhost',origin:'http://localhost','x-movly-app':'1',cookie,...headers}}),res=Object.assign(new EventEmitter(),{headers:{},setHeader(k,v){this.headers[k]=v;}});await handler(req,res,new URL('http://localhost/api/app/'+path));return res;}
 return{calls,request,setWrongPage:()=>{wrongPage=true},setSameReceipt:()=>{sameReceipt=true},setWrong:()=>{wrong=true},setLocked:()=>{locked=true}};
}
async function login(f){const a=await f.request('POST','login',{username:'fixture',password:'synthetic'}),b=await f.request('POST','profile',{id:2},a.headers['Set-Cookie'].split(';')[0]);return b.headers['Set-Cookie'].split(';')[0];}
const body=()=>({revision:0,catalog_revision:'a'.repeat(64),order:['hero'],hidden:['hero']});
test('Home preferences BFF forwards full CAS documents, explicit language and reset, with private no-store receipts',async()=>{
 const f=fixture(),cookie=await login(f);let r=await f.request('GET','home/preferences?lang=sk',null,cookie,{'x-movly-language':'en'});assert.equal(r.status,200);assert.ok(f.calls.at(-1).path.endsWith('lang=sk'));assert.equal(r.headers['Cache-Control'],'private, no-store');
 r=await f.request('PUT','home/preferences',body(),cookie);assert.equal(r.status,200);assert.deepEqual(f.calls.at(-1).body,body());assert.equal(r.body.revision,1);
 r=await f.request('PUT','home/preferences',{revision:1,catalog_revision:'a'.repeat(64),order:[],hidden:[]},cookie);assert.equal(r.status,200);assert.equal(r.body.revision,2);
});
test('Home preferences malformed bodies, duplicate slugs, query injection and stale owners never reach mutation',async()=>{
 const f=fixture(),cookie=await login(f);
 for(const v of [{...body(),profile_id:9},{...body(),order:['hero','hero']},{...body(),hidden:['../bad']},{...body(),revision:-1},{...body(),catalog_revision:null},{revision:0,order:[],hidden:[]}])assert.equal((await f.request('PUT','home/preferences',v,cookie)).status,400);
 assert.equal((await f.request('GET','home/preferences?lang=xx',null,cookie)).status,400);assert.equal((await f.request('GET','home/preferences?profile_id=9',null,cookie)).status,400);
 assert.equal((await f.request('PUT','home/preferences',body(),cookie,{'x-movly-expected-account':'1','x-movly-expected-profile':'9'})).status,409);assert.equal(f.calls.filter(c=>c.path.startsWith('v1/home/preferences')).length,0);
});
test('Home preferences preserves conflict/PIN errors and rejects a foreign-profile success document',async()=>{
 const f=fixture(),cookie=await login(f);assert.equal((await f.request('PUT','home/preferences',{...body(),revision:99},cookie)).status,409);f.setLocked();assert.equal((await f.request('GET','home/preferences',null,cookie)).status,403);
 const other=fixture(),otherCookie=await login(other);other.setWrong();assert.equal((await other.request('GET','home/preferences',null,otherCookie)).status,502);
});

test('Home preferences BFF refuses a successful PUT receipt whose revision did not advance',async()=>{
 const f=fixture(),cookie=await login(f);f.setSameReceipt();const r=await f.request('PUT','home/preferences',body(),cookie);assert.equal(r.status,502);assert.equal(r.body.revision,undefined);
});

test('Page preferences BFF admits only closed page paths, exact body and matching page receipts',async()=>{
 for(const page of ['home','movies','series']){const f=fixture(),cookie=await login(f);let r=await f.request('GET',`pages/${page}/preferences?lang=en`,null,cookie);assert.equal(r.status,200);assert.equal(r.body.page,page);assert.equal(r.headers['Cache-Control'],'private, no-store');r=await f.request('PUT',`pages/${page}/preferences`,body(),cookie);assert.equal(r.status,200);assert.equal(r.body.page,page);assert.deepEqual(f.calls.at(-1).body,body());}
 const f=fixture(),cookie=await login(f);assert.equal((await f.request('GET','pages/unknown/preferences',null,cookie)).status,404);assert.equal((await f.request('PUT','pages/movies/preferences',{...body(),page:'movies'},cookie)).status,400);assert.equal((await f.request('DELETE','pages/movies/preferences',null,cookie)).status,404);f.setWrongPage();assert.equal((await f.request('GET','pages/movies/preferences',null,cookie)).status,502);
});

test('Typed catalogue list paging forwards the existing closed movie/tv type and rejects mixed injection',async()=>{
 const f=fixture(),cookie=await login(f);for(const type of ['movie','tv']){const r=await f.request('GET',`main/lists/continue-watching?page=2&limit=30&type=${type}`,null,cookie);assert.equal(r.status,200);assert.ok(f.calls.at(-1).path.includes(`type=${type}`));assert.ok(f.calls.at(-1).path.includes('page=2'));}
 const before=f.calls.filter(c=>c.path.startsWith('v1/main/lists/')).length;assert.equal((await f.request('GET','main/lists/popular?type=both',null,cookie)).status,400);assert.equal(f.calls.filter(c=>c.path.startsWith('v1/main/lists/')).length,before);
});

test('New page writes reject newline identities before upstream mutation',async()=>{
 const f=fixture(),cookie=await login(f);for(const input of [{...body(),catalog_revision:'a'.repeat(64)+'\n'},{...body(),order:['hero\n']},{...body(),hidden:['hero\n']}])assert.equal((await f.request('PUT','pages/home/preferences',input,cookie)).status,400);assert.equal(f.calls.filter(v=>v.path.startsWith('v1/pages/')).length,0);
});

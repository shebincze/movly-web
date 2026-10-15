const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createAppHandler } = require('./app-server');
async function modules() {
 const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
 const memoryURL = url(await fs.readFile('app/playback-memory.js', 'utf8'));
 const memory = await import(memoryURL);
 const source = (await fs.readFile('app/playback-telemetry.js', 'utf8')).replace('"./playback-memory.js"', JSON.stringify(memoryURL));
 return {memory, ...await import(url(source))};
}
test('playback diagnostics only emit bounded event fields, never raw source or error metadata', async () => {
 const {playbackFailureEvent: event} = await modules();
 const secret = {message:'https://private.invalid/?token=secret', title:'Private', account_id:99, url:'secret'};
 assert.deepEqual(event({...secret, stage:'source_resolve', provider:'webshare'}), {event:'stream_resolve', outcome:'failure', duration_ms:0, provider:'webshare'});
 assert.deepEqual(event({...secret, stage:'video_analysis', provider:'https://secret', error_code:'playback_prepare_timeout'}), {event:'media_opened', outcome:'timeout', duration_ms:0, provider:''});
 assert.equal(event({stage:'browser_playback', error_code:'hls_network_failed'}).event, 'playing');
});
test('one playback attempt submits once, ignores stale owners, and contains transport failures', async () => {
 const {memory, createPlaybackFailureReporter: reporter} = await modules();
 memory.setPlaybackOwner({id:1},{id:2}); const owner = memory.playbackOwner(), calls=[];
 const report=reporter(owner, async(...args)=>{calls.push(args);return {ok:true};});
 assert.equal(await report({stage:'source_resolve', provider:'webshare'}),true);
 assert.equal(await report({stage:'video_analysis'}),false);
 assert.equal(calls.length,1); assert.equal(calls[0][0],'/api/app/telemetry/client');
 assert.equal(calls[0][1].headers['X-Movly-Expected-Profile'],'2');
 const stale=reporter(owner, async()=>{throw new Error('must not call');});
 memory.setPlaybackOwner({id:1},{id:3});memory.setPlaybackOwner({id:1},{id:2});
 assert.equal(await stale({}),false);
 let failures=0;const failed=reporter(memory.playbackOwner(),async()=>{failures++;throw new Error('network');});
 assert.equal(await failed({}),false);assert.equal(await failed({}),false);assert.equal(failures,1);
 assert.equal(await reporter(memory.playbackOwner(),async()=>({ok:false}))({}),false);
 assert.equal(await reporter(null,async()=>{throw new Error('must not call');})({}),false);
});
test('telemetry BFF requires same origin, authenticated current owner and a closed payload', async () => {
 const calls=[], user={id:1, username:'fixture',is_active:true,is_verified:true,role:'user'};
 class HttpError extends Error {constructor(status,message,extra={}){super(message);this.status=status;Object.assign(this,extra);}}
 const handler=createAppHandler({secret:'synthetic-test-secret',production:false,HttpError,
  json:(res,status,body)=>Object.assign(res,{statusCode:status,body}),readBody:async req=>req.body,
  api:async(path,method,body,token,device,headers)=>{calls.push({path,method,body,headers});if(path==='v1/auth/login')return {payload:{token:'synthetic',user}};if(path==='v1/auth/me')return {payload:user};if(path==='v1/profiles/2/select')return {payload:{profile_id:2,name:'Fixture'}};if(path==='v1/profiles')return {payload:[{id:2,name:'Fixture'}]};if(path==='v1/telemetry/client')return {payload:null};throw Error(path);}});
 async function request(target,body,cookie='',extra={}) {const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(){this.ended=true;}};
  await handler({method:'POST',body,headers:{host:'localhost',origin:'http://localhost','x-movly-app':'1',cookie,...extra}},res,new URL(`http://localhost/api/app/${target}`));return res;}
 const payload={event:'playing',outcome:'failure',provider:'webshare',duration_ms:0};
 assert.equal((await request('telemetry/client',payload)).statusCode,401);
 const login=await request('login',{username:'fixture',password:'synthetic'});assert.equal(login.statusCode,200);
 let cookie=login.headers['set-cookie'].split(';')[0];
 const profile=await request('profile',{id:2},cookie);assert.equal(profile.statusCode,200);cookie=profile.headers['set-cookie'].split(';')[0];
 await assert.rejects(request('telemetry/client',payload,cookie,{origin:'https://evil.invalid'}),/Movly/);
 assert.equal((await request('telemetry/client',payload,cookie,{'x-movly-expected-account':'2'})).statusCode,409);
 for(const bad of [{...payload,message:'private'}, {...payload,provider:'https://private'}, {...payload,event:'secret'}, {...payload,duration_ms:1}])
  assert.equal((await request('telemetry/client',bad,cookie)).statusCode,400);
 assert.equal(calls.filter(c=>c.path==='v1/telemetry/client').length,0);
 const result=await request('telemetry/client',payload,cookie,{'x-movly-expected-account':'1','x-movly-expected-profile':'2'});
 assert.equal(result.statusCode,204);assert.equal(result.ended,true);
 const sent=calls.find(c=>c.path==='v1/telemetry/client');assert.deepEqual(sent.body,payload);
 assert.equal(sent.headers['X-Client-App'],'movly-web');assert.equal(sent.headers['X-Platform'],'web');
});

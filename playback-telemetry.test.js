const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createAppHandler } = require('./app-server');
async function modules() {
 const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
 const memoryURL = url(await fs.readFile('app/playback-memory.js', 'utf8'));
 const memory = await import(memoryURL);
 const source = (await fs.readFile('app/playback-telemetry.js', 'utf8')).replace('"./playback-attempt.js"',JSON.stringify(url((await fs.readFile('app/playback-attempt.js','utf8')).replace('"./build-info.js"',JSON.stringify(url(await fs.readFile('app/build-info.js','utf8'))))))).replace('"./playback-attempt-support.js"',JSON.stringify(url('export function playbackAttemptSupported(){return false}'))).replace('"./playback-memory.js"', JSON.stringify(memoryURL));
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
 for(const bad of [{...payload,message:'private'}, {...payload,provider:'https://private'}, {...payload,event:'secret'}, {...payload,duration_ms:3_600_001}])
  assert.equal((await request('telemetry/client',bad,cookie)).statusCode,400);
 assert.equal(calls.filter(c=>c.path==='v1/telemetry/client').length,0);
 const result=await request('telemetry/client',payload,cookie,{'x-movly-expected-account':'1','x-movly-expected-profile':'2'});
 assert.equal(result.statusCode,204);assert.equal(result.ended,true);
 const sent=calls.find(c=>c.path==='v1/telemetry/client');assert.deepEqual(sent.body,payload);
 assert.equal(sent.headers['X-Client-App'],'movly-web');assert.equal(sent.headers['X-Platform'],'web');
 for (const payload of [{event:'first_frame',outcome:'success',provider:'webshare',duration_ms:123}, {event:'playing',outcome:'success',provider:'',duration_ms:234}]) {
  assert.equal((await request('telemetry/client',payload,cookie)).statusCode,204);
  assert.deepEqual(calls.filter(c=>c.path==='v1/telemetry/client').at(-1).body,payload);
 }
 for (const bad of [{event:'first_frame',outcome:'failure',provider:'',duration_ms:1}, {event:'stream_resolve',outcome:'success',provider:'',duration_ms:1}, {...payload,duration_ms:1.5}, {...payload,duration_ms:-1}, {...payload,duration_ms:'123'}])
  assert.equal((await request('telemetry/client',bad,cookie)).statusCode,400);
});
test('optional telemetry 401 never clears cookies or revokes the usable session', async () => {
 for (const rejectedPath of ['v1/telemetry/client', 'v1/auth/me']) {
  let reject=false;
  class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
  const user={id:1,username:'fixture',is_active:true,is_verified:true,role:'user'};
  const handler=createAppHandler({secret:'synthetic-test-secret',production:false,HttpError,
   json:(res,status,body)=>Object.assign(res,{statusCode:status,body}),readBody:async req=>req.body,
   api:async path=>{if(reject && path===rejectedPath)throw new HttpError(401,'synthetic auth failure');
    if(path==='v1/auth/login')return {payload:{token:'fixture',user}};
    if(path==='v1/auth/me')return {payload:user};
    if(path==='v1/telemetry/client')return {payload:null};throw Error(path);}});
  async function request(method,target,body,cookie='') {const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(){}};
   await handler({method,body,headers:{host:'localhost',origin:'http://localhost','x-movly-app':'1',cookie}},res,new URL(`http://localhost/api/app/${target}`));return res;}
  const login=await request('POST','login',{username:'fixture',password:'synthetic'});
  const cookie=login.headers['set-cookie'].split(';')[0];reject=true;
  const failed=await request('POST','telemetry/client',{event:'playing',outcome:'failure',provider:'',duration_ms:0},cookie);
  assert.equal(failed.statusCode,401,rejectedPath);
  assert.equal(failed.headers['set-cookie'],undefined,rejectedPath);
  reject=false;
  const session=await request('GET','session',null,cookie);
  assert.equal(session.statusCode,200,rejectedPath);assert.equal(session.body.account.id,1);
 }
});

function fakeVideo(frameAPI = true) {
 const video = new EventTarget();
 let next = 0;
 video.frames = new Map(); video.cancelled = [];
 if(frameAPI) {
  video.requestVideoFrameCallback = callback => {const id=++next;video.frames.set(id,callback);return id;};
  video.cancelVideoFrameCallback = id => {video.cancelled.push(id);video.frames.delete(id);};
 }
 video.frame = (at, metadata={presentedFrames:1,width:320,height:180,presentationTime:at}) => {
  const [id,callback]=video.frames.entries().next().value;
  video.frames.delete(id);callback(at,metadata);return callback;
 };
 return video;
}

test('submitted first frame uses monotonic presentation time once; a later real failure remains independent', async () => {
 const {memory,createPlaybackTelemetryReporter:reporter}=await modules();
 memory.setPlaybackOwner({id:1},{id:2});let now=100;const calls=[];
 const report=reporter(memory.playbackOwner(),{startedAt:100,now:()=>now,diagnosticProvider:'Webshare',fetcher:async(_path,options)=>{calls.push(JSON.parse(options.body));return {ok:true};}});
 const video=fakeVideo();report.observe(video);
 video.dispatchEvent(new Event('playing'));video.dispatchEvent(new Event('loadeddata'));
 assert.equal(calls.length,0,'media readiness is not a decoded/submitted frame');
 now=260;const callback=video.frame(250,{presentedFrames:1,width:320,height:180,presentationTime:255,url:'https://private.invalid/?token=SYNTHETIC',title:'SYNTHETIC'});
 callback(300,{presentedFrames:2,width:320,height:180,presentationTime:290});
 assert.deepEqual(calls,[{event:'first_frame',outcome:'success',duration_ms:155,provider:'webshare'}]);
 now=400;assert.equal(await report.failure({stage:'playback',provider:'webshare',message:'SYNTHETIC'}),true);
 assert.equal(await report.failure({stage:'playback'}),false);
 assert.deepEqual(calls[1],{event:'playing',outcome:'failure',duration_ms:300,provider:'webshare'});
 report.dispose();
});

test('failure before a subsequently observed frame is deduplicated separately from frame observation', async () => {
 const {memory,createPlaybackTelemetryReporter:reporter}=await modules();memory.setPlaybackOwner({id:1},{id:2});const calls=[];
 const report=reporter(memory.playbackOwner(),{startedAt:10,now:()=>100,diagnosticProvider:'https://private.invalid',fetcher:async(_p,o)=>{calls.push(JSON.parse(o.body));return {ok:true};}});
 const video=fakeVideo();report.observe(video);
 await report.failure({stage:'playback',error_code:'playback_prepare_timeout'});
 video.frame(80);
 assert.deepEqual(calls,[{event:'media_opened',outcome:'timeout',duration_ms:90,provider:''},{event:'first_frame',outcome:'success',duration_ms:70,provider:''}]);
 report.dispose();
});

test('without frame callbacks only playing/success is emitted, and duration stays bounded', async () => {
 const {memory,createPlaybackTelemetryReporter:reporter}=await modules();memory.setPlaybackOwner({id:1},{id:2});const calls=[];
 const report=reporter(memory.playbackOwner(),{startedAt:0,now:()=>4_000_000,fetcher:async(_p,o)=>{calls.push(JSON.parse(o.body));return {ok:true};}});
 const video=fakeVideo(false);report.observe(video);video.dispatchEvent(new Event('loadeddata'));assert.equal(calls.length,0);
 video.dispatchEvent(new Event('playing'));video.dispatchEvent(new Event('playing'));
 assert.deepEqual(calls,[{event:'playing',outcome:'success',duration_ms:3_600_000,provider:''}]);report.dispose();
 const failed=fakeVideo();failed.requestVideoFrameCallback=()=>{throw Error('unsupported')};
 const fallback=reporter(memory.playbackOwner(),{startedAt:20,now:()=>10,fetcher:async(_p,o)=>{calls.push(JSON.parse(o.body));return {ok:true};}});
 fallback.observe(failed);failed.dispatchEvent(new Event('playing'));assert.equal(calls.at(-1).event,'playing');assert.equal(calls.at(-1).duration_ms,0);fallback.dispose();
});

test('disposed, replaced and stale-owner callbacks cannot publish; disposal aborts in-flight optional requests', async () => {
 const {memory,createPlaybackTelemetryReporter:reporter}=await modules();memory.setPlaybackOwner({id:1},{id:2});const calls=[];
 const fetcher=async(_p,o)=>{calls.push(o);return {ok:true}};
 const disposed=reporter(memory.playbackOwner(),{fetcher});const video=fakeVideo();disposed.observe(video);const callback=[...video.frames.values()][0];disposed.dispose();assert.equal(video.cancelled.length,1);
 callback(100,{presentedFrames:1,width:1,height:1});assert.equal(await disposed.failure({}),false);assert.equal(calls.length,0);
 const stale=reporter(memory.playbackOwner(),{fetcher});const staleVideo=fakeVideo();stale.observe(staleVideo);memory.setPlaybackOwner({id:1},{id:3});memory.setPlaybackOwner({id:1},{id:2});staleVideo.frame(100);assert.equal(calls.length,0);
 let active=true;const replaced=reporter(memory.playbackOwner(),{fetcher,isActive:()=>active});const replacedVideo=fakeVideo();replaced.observe(replacedVideo);active=false;replacedVideo.frame(100);assert.equal(calls.length,0);
 let signal;const pending=reporter(memory.playbackOwner(),{fetcher:(_p,o)=>new Promise((_resolve,reject)=>{signal=o.signal;signal.addEventListener('abort',()=>reject(Error('aborted')));})});
 const result=pending.failure({});pending.dispose();assert.equal(signal.aborted,true);assert.equal(await result,false);
});

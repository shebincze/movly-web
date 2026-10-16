'use strict';
// Explicit loopback QA: real app BFF/auth/capability/owner routing, controlled
// API and engine boundaries. Never imports into the production server.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {createAppHandler}=require('../app-server'),{createFixture}=require('./app-fixture.cjs');
const root=path.resolve(__dirname,'..'),api=createFixture();let held=[],mode='negotiated',starts=0,deletes=[],events=[],active=new Map(),headers=[],sequence=0,draining=false;const pendingHandlers=new Set();
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const key=s=>[s.token,s.device,s.profile.id].join(':');
const engine={async start(s){starts++;const id=(++sequence).toString(16).padStart(48,'a'),owner=key(s);events.push({type:'start',profile:s.profile.id,id});if(mode!=='normal'&&!draining)await new Promise(r=>held.push(r));active.set(id,owner);events.push({type:'created',profile:s.profile.id,id});return {id,offset:0,duration:8,audio:[{index:0,language:'cs',codec:'aac'}],subtitles:[],selected_audio:0,selected_subtitle:-1,playlist:'/media/index.m3u8',quality:{video:'h264',audio:'aac'}};},async handle(s,req,_res,id,file){if(active.get(id)!==key(s))throw new HttpError(404,'Fixture owner mismatch');if(req.method==='DELETE'){deletes.push({id,profile:s.profile.id});events.push({type:'deleted',profile:s.profile.id,id});active.delete(id);return {stopped:true};}if(file==='status')return {ready:true};throw new HttpError(404,'Fixture media unavailable');}};
const handler=createAppHandler({secret:'synthetic-abandoned-fixture-only',production:false,HttpError,playbackEngine:engine,providerClient:{searchFiles:async()=>[]},nativeResolver:async()=>({streams:[]}),readBody:async req=>{let raw='';for await(const c of req)raw+=c;return raw?JSON.parse(raw):{};},json,api:async(p,...args)=>{
 if(p==='v1/capabilities/negotiate'){if(mode==='legacy')throw new HttpError(404,'Legacy fixture');return {payload:{schema_version:1,revision:'cap1.'+'a'.repeat(64),cache_ttl_seconds:60,server_capabilities:[{id:'playback_attempt',versions:[1],enabled:true}],negotiated:[{id:'playback_attempt',version:1}]}};}
 if(p.startsWith('v1/streaming/titles/1/streams'))return {payload:{streams:[{id:11,provider_name:'Hellspy',source_stream_id:'42/hash',file_name:'Controlled engine fixture',available:true}]}};
 if(p.startsWith('v1/providers/'))return {payload:{connected:true,addons:[{}]}};
 if(p.startsWith('v1/watch-history/position/'))return {payload:{watch_status:'watching',progress_seconds:0}};
 if(p==='v1/watch-history')return {payload:{ok:true}};
 if(p==='v1/telemetry/playback-attempts'||p==='v1/telemetry/client')return {payload:null};
 return api(p,...args);
}});
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://'+req.headers.host);try{
 if(url.pathname==='/fixture/reset'){draining=true;held.splice(0).forEach(r=>r());await Promise.all([...pendingHandlers]);mode=url.searchParams.get('mode')||'negotiated';starts=0;deletes=[];events=[];headers=[];active.clear();draining=false;return json(res,200,{mode});}
 if(url.pathname==='/fixture/release'){held.splice(0).forEach(r=>r());return json(res,200,{ok:true});}
 if(url.pathname==='/fixture/stats')return json(res,200,{mode,starts,deletes,active:[...active.keys()],held:held.length,events,headers});
 if(url.pathname==='/fixture.html'){res.writeHead(200,{'Content-Type':'text/html'});return res.end('<!doctype html><title>Movly abandoned session fixture</title><link rel="stylesheet" href="/app/styles.css"><button id="start" disabled>Start source picker</button><button id="release">Release engine</button><button id="stats">Refresh counters</button><pre id="counters"></pre><dialog id="dialog"><button class="dialog-close">Close</button><button id="owner">Change synthetic owner</button><div id="dialog-content"></div></dialog><div id="toast" hidden></div><script type="module" src="/test-support/playback-abandoned-fixture.js"></script>');}
 if(url.pathname.startsWith('/api/app/')){if(url.pathname==='/api/app/playback'&&req.method==='POST')headers.push({attempt:req.headers['x-movly-playback-attempt']||null,profile:req.headers['x-movly-expected-profile']});if(url.pathname==='/api/app/playback'&&req.method==='POST'){let done;const pending=new Promise(r=>done=r);pendingHandlers.add(pending);try{await handler(req,res,url);}finally{done();pendingHandlers.delete(pending);}}else await handler(req,res,url);return;}
 const file=url.pathname.startsWith('/media/')?path.join('/private/tmp/movly-web-abandoned-media',path.basename(url.pathname)):path.resolve(root,'.'+url.pathname);
 if(!file.startsWith(root+path.sep)&&!file.startsWith('/private/tmp/movly-web-abandoned-media/'))throw new HttpError(403,'Forbidden');
 const bytes=fs.readFileSync(file);res.writeHead(200,{'Content-Type':file.endsWith('.m3u8')?'application/vnd.apple.mpegurl':file.endsWith('.ts')?'video/mp2t':file.endsWith('.css')?'text/css':'text/javascript','Cache-Control':'no-store'});res.end(bytes);
 }catch(e){if(!res.destroyed)json(res,e.status||500,{message:e.message});}});
server.listen(18876,'127.0.0.1',()=>console.log('SYNTHETIC BFF/ENGINE http://localhost:18876/fixture.html?mode=negotiated'));

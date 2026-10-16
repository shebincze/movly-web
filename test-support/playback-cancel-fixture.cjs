'use strict';
// Explicit loopback-only player integration fixture. API responses are synthetic;
// production player/modules and real generated HLS media are served unchanged.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');let mode='resume',held=[],posts=0,deletes=0,history=[],requests=[];
const send=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const session={id:'a'.repeat(48),offset:0,duration:8,audio:[{index:0,language:'cs',codec:'aac'}],subtitles:[],selected_audio:0,selected_subtitle:-1,playlist:'/media/index.m3u8',quality:{video:'h264',audio:'aac'}};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');let raw='';for await(const c of req)raw+=c;
 if(url.pathname==='/fixture/reset'){mode=url.searchParams.get('mode')||'resume';held.forEach(fn=>fn());held=[];posts=deletes=0;history=[];requests=[];return send(res,{mode});}
 if(url.pathname==='/fixture/release'){held.splice(0).forEach(fn=>fn());return send(res,{ok:true});}
 if(url.pathname==='/fixture/stats')return send(res,{mode,posts,deletes,history,held:held.length,requests});
 if(url.pathname==='/fixture.html'){res.writeHead(200,{'Content-Type':'text/html'});return res.end('<!doctype html><title>Movly cancellation fixture</title><link rel="stylesheet" href="/app/styles.css"><button id="start">Start source picker</button><button id="cancel">Cancel playback</button><button id="release">Release pending response</button><button id="stats">Refresh counters</button><pre id="counters"></pre><dialog id="dialog"><button class="dialog-close">Close</button><div id="dialog-content"></div></dialog><div id="toast" hidden></div><script type="module" src="/test-support/playback-cancel-fixture.js"></script>');}
 if(url.pathname.startsWith('/api/app/')){
  const p=url.pathname.slice('/api/app/'.length);requests.push({method:req.method,path:p});
  if(p.startsWith('providers/'))return send(res,{connected:true,addons:[{}]});
  if(p.startsWith('streaming/titles/'))return send(res,{streams:[{id:11,provider_name:'Webshare',file_name:'Generated fixture',video_height:90,available:true}]});
  if(p.startsWith('streaming2/')||p.startsWith('sources/'))return send(res,{streams:[]});
  if(p.startsWith('watch-history/position/')){if(mode==='resume')await new Promise(r=>held.push(r));return send(res,{watch_status:'watching',progress_seconds:0});}
  if(p==='playback'&&req.method==='POST'){posts++;if(mode==='post')await new Promise(r=>held.push(r));return send(res,session);}
  if(p==='watch-history'){history.push(JSON.parse(raw));return send(res,{ok:true});}
  if(p.endsWith('/status'))return send(res,{ready:true});
  if(/^playback\/[a]+$/.test(p)&&req.method==='DELETE'){deletes++;return send(res,{ok:true});}
  if(p==='telemetry/client')return send(res,{});
  return send(res,{message:'Synthetic endpoint unavailable'},404);
 }
 let target;
 if(url.pathname.startsWith('/media/'))target=path.join('/private/tmp/movly-web-cancel-media',path.basename(url.pathname));
 else target=path.resolve(root,'.'+url.pathname);
 if(!target.startsWith(root+path.sep)&&!target.startsWith('/private/tmp/movly-web-cancel-media/'))return send(res,{},403);
 try{const body=fs.readFileSync(target);res.writeHead(200,{'Content-Type':target.endsWith('.m3u8')?'application/vnd.apple.mpegurl':target.endsWith('.ts')?'video/mp2t':target.endsWith('.css')?'text/css':'text/javascript','Cache-Control':'no-store'});res.end(body);}catch{send(res,{},404);}
});
if(require.main===module)server.listen(Number(process.env.MOVLY_CANCEL_PORT||18856),'127.0.0.1',()=>console.log('SYNTHETIC PLAYER ONLY http://localhost:18856/fixture.html?mode=resume'));
module.exports={server};

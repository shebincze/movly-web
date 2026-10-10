"use strict";
// Loopback-only synthetic browser QA. Never imported by the production server.
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
let attempts = [], mode = "source_resolve";
const html = `<!doctype html><html lang="cs"><meta charset="utf-8"><title>Movly playback diagnostics QA</title><link rel="stylesheet" href="/app/styles.css"><body><main class="page"><h1>Movly</h1><button id="test" class="button">Přehrát testovací film</button></main><div id="toast" hidden></div><dialog id="dialog"><button class="dialog-close" aria-label="Zavřít">×</button><div id="dialog-content"></div></dialog><script type="module">import {sources} from '/app/player.js';document.querySelector('#test').onclick=()=>sources({id:1,title:'Testovací film',type:'movie'});document.querySelector('.dialog-close').onclick=()=>document.querySelector('#dialog').close();</script></body></html>`;
http.createServer(async (req,res) => {
  const url=new URL(req.url,"http://localhost");
  const json=(status,body)=>{res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(body));};
  if(url.pathname==="/"){res.writeHead(200,{"Content-Type":"text/html"});res.end(html);return;}
  if(url.pathname==="/proof"){json(200,{attempts});return;}
  if(url.pathname==="/mode"){mode=url.searchParams.get('stage')||'source_resolve';json(200,{mode});return;}
  if(url.pathname.startsWith('/api/app/')){
    const p=url.pathname.slice('/api/app/'.length);
    if(p.startsWith('providers/'))return json(200,{connected:true,addons:[]});
    if(p.startsWith('streaming/titles/'))return json(200,{streams:[{id:1,provider_name:'Webshare',available:true,video_height:1080,file_name:'Testovací zdroj'}]});
    if(p.startsWith('streaming2/')||p.startsWith('sources/'))return json(200,{streams:[]});
    if(p.startsWith('watch-history/'))return json(404,{message:'Bez historie'});
    if(p==='playback')return json(503,{message:'Testovací selhání přípravy videa',diagnostic_stage:mode});
    if(p==='feedback/items'&&req.method==='POST'){
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);attempts.push(body);
      if(attempts.length===1)return json(503,{message:'Testovací výpadek: zkus odeslat znovu.'});
      return json(201,{item:{id:300}});
    }
    return json(200,{});
  }
  if(url.pathname.startsWith('/app/')){
    const file=path.join(root,url.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();
    res.writeHead(200,{"Content-Type":(/\.m?js$/.test(file))?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream'});fs.createReadStream(file).pipe(res);return;
  }
  if(url.pathname==='/favicon.ico')return res.writeHead(204).end();
  res.writeHead(404).end();
}).listen(8898,'127.0.0.1',()=>console.log('Synthetic QA: http://127.0.0.1:8898'));

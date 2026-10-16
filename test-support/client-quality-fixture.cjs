"use strict";
// Loopback-only QA auth bootstrap + real registered Go telemetry read bridge.
// Never imported by production. Requires separately opt-in Go fixture + own PG.
const http=require('node:http');
process.env.MOVLY_API_KEY='nxe_qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
process.env.DOWNLOAD_TOKEN_SECRET='synthetic-client-quality757-only';
process.env.NODE_ENV='development';
process.env.MOVLY_FIXTURE_FEEDBACK_ADMIN='1';
process.env.MOVLY_API_BASE='http://127.0.0.1:18758';
const fixture=require('./app-fixture.cjs').createFixture();
const upstream=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 try{
  if(req.url.startsWith('/v1/admin/telemetry/client?')){
   const response=await fetch('http://127.0.0.1:18757'+req.url,{headers:{'API-Key':process.env.MOVLY_API_KEY,'X-QA-Role':'admin'}});
   res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'private, no-store'});res.end(await response.text());return;
  }
  const result=await fixture(req.url.slice(1),req.method,raw?JSON.parse(raw):null,req.headers.authorization?.slice(7),req.headers['x-session-id'],{'X-Profile-ID':req.headers['x-profile-id'],'X-Profile-Grant':req.headers['x-profile-grant']});
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result.payload));
 }catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({message:error.message,code:error.code}));}
});
upstream.listen(18758,'127.0.0.1',()=>require('../server').createServer().listen(18756,'127.0.0.1',()=>console.log('SYNTHETIC QA http://localhost:18756/app/#admin?view=client-quality — test / movly-test')));

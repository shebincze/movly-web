"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");
const {once}=require("node:events");
const {Readable}=require("node:stream");
const {createPlayback}=require("./playback-server");

for (const status of [206,201,203,207]) test(`HLS status ${status} cannot escape the proxy`, async()=>{
 let privateRequests=0;
 const privateServer=http.createServer((req,res)=>{privateRequests++;res.end(Buffer.alloc(16));});
 privateServer.listen(0,"127.0.0.1");await once(privateServer,"listening");
 const body=`#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-KEY:METHOD=AES-128,URI="http://127.0.0.1:${privateServer.address().port}/key"\n#EXTINF:1,\nhttp://127.0.0.1:${privateServer.address().port}/private.ts\n#EXT-X-ENDLIST\n`;
 const engine=createPlayback({requestMedia:async()=>{const stream=Readable.from([body]);stream.statusCode=status;stream.headers={"content-type":"application/vnd.apple.mpegurl"};return stream;}});
 try {
  await assert.rejects(engine.analyze({token:"fixture",device:"fixture",profile:{id:1}},"https://provider.test/fixture.m3u8",{trustedProvider:true}));
  assert.equal(privateRequests,0,"FFprobe must not read private playlist references");
 }finally{await engine.close();await new Promise(resolve=>privateServer.close(resolve));}
});

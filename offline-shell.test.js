"use strict";
const {test}=require("node:test");const assert=require("node:assert/strict");const fs=require("node:fs");const path=require("node:path");const vm=require("node:vm");
test("offline manifest contains every transitive browser module including the worker import",()=>{
 let source=fs.readFileSync(path.join(__dirname,"app/offline-sw.js"),"utf8");
 source=source.replace(/^import .*;\n/,"");
 const manifest=vm.runInNewContext(source.slice(0,source.indexOf('self.addEventListener'))+"\nFILES",{URL,OFFLINE_CACHE_NAME:"movly-offline-shell-v23-offline-policy-marker",self:{location:{origin:"https://fixture.invalid"}}});
 const seen=new Set();
 function walk(file){
  if(seen.has(file))return;seen.add(file);
  const text=fs.readFileSync(file,"utf8");
  for(const match of text.matchAll(/(?:\bimport\s+(?:[^;]*?\s+from\s*)?|\bexport\s+[^;]*?\s+from\s*)["'](\.[^"']+)["']/g)){
   const child=path.resolve(path.dirname(file),match[1]);
   const url="/"+path.relative(__dirname,child).split(path.sep).join("/");
   assert.ok(manifest.includes(url),`Missing offline module ${url}`);walk(child);
  }
 }
 walk(path.join(__dirname,"app/main.js"));walk(path.join(__dirname,"app/offline-sw.js"));
 assert.ok(seen.size>30,"Validate the actual transitive graph");
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness() {
  const source = fs.readFileSync('app/main.js', 'utf8');
  const premium = source.slice(source.indexOf('window.addEventListener("movly-premium-changed"'), source.indexOf('window.addEventListener("offline"'));
  const focus = source.slice(source.indexOf('window.addEventListener("focus"'), source.indexOf('window.addEventListener("movly-feedback-revoked"'));
  const handlers = {}, pending = [], writes = [];
  const context = { window:{addEventListener:(name, fn)=>{handlers[name]=fn;}}, session:{account:{id:1,role:'premium'}}, feedbackRefreshRevision:0, renderRevision:1, location:{hash:'#feedback'}, dialog:{open:false}, content:{replaceChildren:value=>writes.push(value)}, api:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})), setFeedbackAccount:value=>writes.push(value), chrome:()=>writes.push('chrome'), render:async()=>writes.push('render'), loading:()=> 'loading', errorBox:()=> 'error', login:()=>writes.push('login'), Error };
  vm.runInNewContext(premium + '\n' + focus, context);
  return {context, handlers, pending, writes};
}
test('late feedback focus failure cannot replace a route opened while refreshing', async()=>{
 const h=harness(), task=h.handlers.focus(); h.context.location.hash='#home'; h.context.renderRevision++;
 const count=h.writes.length; h.pending[0].reject(new Error('offline')); await task;
 assert.equal(h.writes.length,count);
});
test('older paid focus result cannot override a newer free account result', async()=>{
 const h=harness(), older=h.handlers.focus(), newer=h.handlers.focus();
 h.pending[1].resolve({account:{id:1,role:'user'}}); await newer;
 h.pending[0].resolve({account:{id:1,role:'premium'}}); await older;
 assert.equal(h.context.session.account.role,'user'); assert.equal(h.writes.filter(x=>x==='chrome').length,1);
});
test('premium-change and focus share generation and ignore replaced owners', async()=>{
 const h=harness(), older=h.handlers['movly-premium-changed'](), newer=h.handlers.focus();
 h.pending[1].resolve({account:{id:1,role:'user'}}); await newer;
 h.pending[0].resolve({account:{id:1,role:'premium'}}); await older;
 assert.equal(h.context.session.account.role,'user');
 const task=h.handlers.focus(); h.context.session={account:{id:2,role:'vip'}}; const count=h.writes.length;
 h.pending[2].reject(new Error('old owner')); await task; assert.equal(h.writes.length,count);
});

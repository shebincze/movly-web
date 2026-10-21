const {chromium}=require('playwright');
function expect(locator){return {async toHaveAttribute(name,value){for(let i=0;i<50;i++){if(await locator.getAttribute(name)===value)return;await new Promise(r=>setTimeout(r,100));}throw Error('Unexpected '+name+': '+await locator.getAttribute(name));}};}
const assert=require('node:assert/strict');const fs=require('node:fs');
// Explicit synthetic fixture only. Browser plugin/skill is unavailable in this environment;
// regular Playwright is used with the bundled runtime (see QA document).
const base=process.env.MOVLY_INVENTORY_QA_BASE || 'http://127.0.0.1:18086';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const evidence=process.env.MOVLY_INVENTORY_QA_EVIDENCE;
assert(evidence,'Set MOVLY_INVENTORY_QA_EVIDENCE to a directory outside the checkout');
fs.mkdirSync(evidence,{recursive:true});
(async()=>{const b=await chromium.launch({headless:true});try{const context=await b.newContext({viewport:{width:1440,height:1000}});const p=await context.newPage();const errors=[];const inventoryRequests=[];p.on('request',r=>{if(/streaming\/titles\/\d+\/inventory/.test(r.url()))inventoryRequests.push(r.url())});p.on('pageerror',e=>errors.push(e.message));
await p.goto(base+'/app/');await p.locator('input[name="username"]').fill('test');await p.locator('input[name="password"]').fill('movly-test');await p.getByRole('button',{name:'Přihlásit se',exact:true}).click();await p.getByRole('button',{name:'Testovací profil',exact:false}).first().click();await p.getByRole('button',{name:'Informace',exact:true}).click();const badge=p.locator('.database-inventory-badge').first();await badge.waitFor();await expect(badge).toHaveAttribute('aria-label','2 streamy, Nejvyšší kvalita FHD, Zvuk CZ');await p.screenshot({path:evidence+'/web-desktop-movie.png'});
assert.equal(inventoryRequests.length,1);console.log('desktop movie PASS',await badge.innerText());
await p.setViewportSize({width:390,height:844});await badge.scrollIntoViewIfNeeded();let bounds=await badge.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=390);await p.screenshot({path:evidence+'/web-mobile-movie.png'});console.log('mobile bounds PASS',bounds);
await p.route('**/api/app/streaming/titles/1/inventory',r=>r.fulfill({status:503,contentType:'application/json',body:'{"message":"synthetic unavailable"}'}));await p.evaluate(()=>document.dispatchEvent(new CustomEvent('movly:providers-changed')));await expect(badge).toHaveAttribute('aria-label','Dostupnost neověřena');assert(!await badge.innerText().then(t=>t.includes('0x')));console.log('network failure unknown PASS');await p.unroute('**/api/app/streaming/titles/1/inventory');await p.evaluate(()=>document.dispatchEvent(new CustomEvent('movly:providers-changed')));await expect(badge).toHaveAttribute('aria-label','2 streamy, Nejvyšší kvalita FHD, Zvuk CZ');
await p.keyboard.press('Escape');await p.setViewportSize({width:1440,height:1000});await p.getByRole('button',{name:/The Last of Us/}).first().click();
const first=p.locator('[data-inventory-episode="2001"]').first(), second=p.locator('[data-inventory-episode="2002"]').first();
await expect(first).toHaveAttribute('aria-label','8 streamů, Nejvyšší kvalita FHD, Zvuk CZ / EN');await expect(second).toHaveAttribute('aria-label','Zatím bez streamu');
await first.scrollIntoViewIfNeeded();await p.screenshot({path:evidence+'/web-desktop-episodes.png'});console.log('desktop episodes PASS');
await p.setViewportSize({width:390,height:844});await first.scrollIntoViewIfNeeded();bounds=await first.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=390);await p.screenshot({path:evidence+'/web-mobile-episodes.png'});console.log('mobile episodes PASS');
await p.keyboard.press('Escape');
const tv=await context.newPage({viewport:{width:1920,height:1080}});tv.on('pageerror',e=>errors.push('TV:'+e.message));await tv.goto(base+'/app/tv/');await tv.getByRole('button',{name:'Duna: Část druhá',exact:true}).first().waitFor();await tv.getByRole('button',{name:'Duna: Část druhá',exact:true}).first().click();
const tvMovie=tv.locator('[data-inventory-episode="title"]').first();await expect(tvMovie).toHaveAttribute('aria-label','2 streamy, Nejvyšší kvalita FHD, Zvuk CZ');await tv.screenshot({path:evidence+'/web-tv-movie.png'});console.log('TV movie PASS');
await tv.keyboard.press('Escape');await tv.getByRole('button',{name:'The Last of Us',exact:true}).first().click();
const tvEpisode=tv.locator('[data-inventory-episode="2001"]').first();await expect(tvEpisode).toHaveAttribute('aria-label','8 streamů, Nejvyšší kvalita FHD, Zvuk CZ / EN');await expect(tv.locator('[data-inventory-episode="2002"]').first()).toHaveAttribute('aria-label','Zatím bez streamu');await tvEpisode.scrollIntoViewIfNeeded();await tv.screenshot({path:evidence+'/web-tv-episodes.png'});
await tv.getByRole('button',{name:/S01E01/}).focus();await tv.keyboard.press('ArrowDown');await tv.keyboard.press('ArrowUp');assert(await tv.evaluate(()=>document.activeElement.tagName==='BUTTON'));console.log('TV episodes and keyboard focus PASS');
await tv.route('**/api/app/sources/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"results":[],"streams":[]}'}));
await tv.route('**/api/app/streaming*/titles/*/streams**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"streams":[]}'}));
await tv.route('**/api/app/streaming/titles/20/inventory',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({title_id:20,providers:[],episodes:{2001:[{provider_id:2,streams_count:1,video_height:720,audio_languages:['slk']}]},access:true})}));
await tv.locator('.tv-episode').first().click();await tv.locator('.tv-sources').waitFor();await tv.getByRole('button',{name:/Zpět/}).first().click();
await expect(tv.locator('[data-inventory-episode="2001"]').first()).toHaveAttribute('aria-label','1 stream, Nejvyšší kvalita HD, Zvuk SK');console.log('TV return refresh PASS');

await p.evaluate(()=>{
 const node=document.createElement('span'), before=document.documentElement.lang;
 document.documentElement.lang='en';window.MovlyDatabaseAvailability.paint(node,{count:2,quality:'FHD',audio:'CZ'},true);
 if(node.getAttribute('aria-label')!=='2 streams, Highest quality FHD, Audio CZ')throw Error('English inventory accessibility');
 document.documentElement.lang='sk';window.MovlyDatabaseAvailability.paint(node,{count:0,quality:null,audio:''},true);
 if(node.getAttribute('aria-label')!=='Zatiaľ bez streamu')throw Error('Slovak zero');document.documentElement.lang=before;
});
fs.writeFileSync(evidence+'/web-browser-result.json',JSON.stringify({errors,inventoryRequests,checks:['desktop movie','mobile movie bounds','HTTP failure remains unknown','recovery','desktop episodes','mobile episodes','TV movie','TV episodes','TV keyboard focus','TV return refresh','English and Slovak labels']},null,2));assert.deepEqual(errors,[]);
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});

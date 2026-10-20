async page => {
 if (!/^http:\/\/127\.0\.0\.1:/.test(page.url())) throw Error("Local synthetic fixture required");
 await page.getByRole('button',{name:'Oppenheimer',exact:true}).first().click();
 await page.getByRole('button',{name:'Přehrát',exact:true}).focus();
 await page.keyboard.down('Enter');
 await page.waitForTimeout(850);
 await page.locator('.tv-source').first().waitFor();
 await page.locator('.tv-source').first().focus();
 await page.evaluate(() => {
   window.__sourceClicks=0;
   document.addEventListener('click',e=>{if(e.target.closest('.tv-source')){window.__sourceClicks++;e.preventDefault();e.stopImmediatePropagation();}},true);
 });
 await page.keyboard.down('Enter');
 await page.keyboard.down('Enter');
 await page.keyboard.up('Enter');
 const repeated=await page.evaluate(()=>window.__sourceClicks);
 if(repeated!==0)throw Error('held key activated new source '+repeated+' times');
 await page.keyboard.press('Enter');
 const afterRelease=await page.evaluate(()=>window.__sourceClicks);
 if(afterRelease!==1)throw Error('new deliberate key did not activate source');
 return {repeated,newPress:afterRelease,pass:true};
}

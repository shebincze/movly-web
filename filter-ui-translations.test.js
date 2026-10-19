'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const moduleURL=(source)=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
test('new filter controls, states and direction chips have actual SK/EN translations',async()=>{
 const dictionaryURL=moduleURL(await fs.readFile('app/translations.js','utf8'));
 const {translations}=await import(dictionaryURL);
 const source=(await fs.readFile('app/i18n.js','utf8')).replace('./translations.js',dictionaryURL);
 const i18n=await import(moduleURL(source));
 const keys=['Popularita','Hodnocení','Délka','Počet hodnocení','Země původu','Směr řazení','Vzestupně','Sestupně','vzestupně','sestupně','Načítání filtrů…','Nabídka filtrů pro tento profil zatím není dostupná.','Vyber více hodnot pomocí Ctrl / Cmd nebo Shift.','Zkusit znovu','od','do','od min','do min','od %','do %','Jen s dostupným zdrojem'];
 for(const [language,index]of [['sk',0],['en',1]]){
  i18n.setUILanguage(language);
  for(const key of keys){
   assert.equal(Object.hasOwn(translations,key),true,key);
   assert.equal(typeof translations[key][index],'string',key);
   assert.ok(translations[key][index].trim(),key);
   assert.equal(i18n.translateUI(key),translations[key][index],key);
   if(language==='en')assert.notEqual(i18n.translateUI(key),key,key);
  }
 }
});

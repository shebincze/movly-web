async page => {
  const result = [];
  if (!/^http:\/\/127\.0\.0\.1:/.test(page.url())) throw Error('Local synthetic fixture required');
  if (await page.getByRole('dialog').count()) await page.getByRole('dialog').getByRole('button', {name:'Zavřít',exact:true}).click();
  await page.evaluate(async () => {
    const m = await import('/app/playback-memory.js');
    m.rememberPlayback(2, null, {title_id:2,source:'human',stream_id:123}, {index:0,key:'cs'}, {index:-1,key:'off'});
    if (!m.recalledPlayback(2,null)) throw Error('missing seeded source');
  });
  let positions = 0;
  const listener = req => { if(req.url().includes('watch-history/position/2')) positions++; };
  page.on('request',listener);
  async function open() {
    await page.getByRole('button',{name:'Oppenheimer 2023',exact:true}).first().click();
    return page.getByRole('dialog').getByRole('button',{name:'Přehrát',exact:true});
  }
  async function picker(name, expectedPositions) {
    await page.getByRole('dialog').getByRole('heading',{name:'Vyber zdroj',exact:true}).waitFor();
    if(positions !== expectedPositions) throw Error(name+': saved source queries='+positions);
    result.push({name,positions,picker:true});
    await page.getByRole('dialog').getByRole('button',{name:'Zavřít',exact:true}).click();
  }
  await (await open()).click({delay:850}); await picker('hold',0);
  await (await open()).press('Shift+Enter'); await picker('Shift Enter',0);
  await (await open()).click({button:'right'});
  await page.getByRole('menuitem',{name:'Vybrat jiný zdroj'}).click(); await picker('context menu',0);
  await (await open()).click(); await picker('ordinary click still looks up saved source',1);
  await page.evaluate(async () => {
    const m=await import('/app/playback-memory.js');
    if(!m.recalledPlayback(2,null)) throw Error('manual choice erased source memory');
  });
  page.off('request',listener);
  return result;
}

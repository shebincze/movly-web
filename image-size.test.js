'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const original = 'https://image.tmdb.org/t/p/w500/a.jpg';
const small = 'https://image.tmdb.org/t/p/w342/a.jpg';
async function policies() {
  const { imageURL } = await import('./app/api.js');
  const source = fs.readFileSync('app/tv/tv.js', 'utf8');
  const fn = source.slice(source.indexOf('  function imageURL('), source.indexOf('  var DIACRITICS'));
  return [imageURL, vm.runInNewContext(fn + ';imageURL')];
}
test('web and legacy TV reduce explicit thumbnail requests but retain detail and smaller sources', async () => {
  for (const imageURL of await policies()) {
    assert.equal(imageURL(original, 'w342'), small);
    assert.equal(imageURL('/a.jpg', 'w342'), small);
    assert.equal(imageURL(original, 'w500'), original);
    assert.equal(imageURL('https://image.tmdb.org/t/p/w185/a.jpg', 'w342'), 'https://image.tmdb.org/t/p/w185/a.jpg');
    assert.equal(imageURL('https://image.tmdb.org/t/p/original/a.jpg', 'w342'), small);
    for (const url of ['https://res.cloudinary.com/dsnzqq6kh/image/upload/a.jpg',
      'https://image.tmdb.org/t/p/original/a.svg', original + '?signature=keep', original + '#keep']) {
      assert.equal(imageURL(url, 'w342'), url);
    }
    assert.equal(imageURL('https://evil.test/t/p/w500/a.jpg', 'w342'), null);
  }
});

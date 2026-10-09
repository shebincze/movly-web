const { test } = require("node:test");
const assert = require("node:assert/strict");
test("all translated UI placeholders retain arguments in Slovak and English", async () => {
  const { translations } = await import("./app/translations.js");
  const placeholders = (text) =>
    [...text.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort();
  assert.ok(Object.keys(translations).length > 500);
  for (const [source, targets] of Object.entries(translations)) {
    assert.equal(targets.length, 2, source);
    for (const target of targets) {
      assert.equal(typeof target, "string", source);
      assert.ok(target.trim(), source);
      assert.deepEqual(placeholders(target), placeholders(source), source);
    }
  }
  const { setUILanguage, translateUI } = await import("./app/i18n.js");
  setUILanguage("en");
  assert.equal(translateUI("Načítám…"), "Loading…");
  assert.equal(translateUI(" Zdroje: {0}.", "test"), " Sources: test.");
  setUILanguage("sk");
  assert.equal(translateUI("Načítám…"), "Načítavam…");
  setUILanguage("cs");
  assert.equal(translateUI("Title supplied by user"), "Title supplied by user");
});
test("search history isolates accounts and profiles, limits and removes durable terms", async () => {
  const values = new Map();
  global.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const {
    setSearchOwner,
    rememberSearch,
    searchHistory,
    removeSearch,
    clearSearchHistory,
  } = await import("./app/search-history.js");
  setSearchOwner({ username: "first" }, { id: 1 });
  rememberSearch("  Duna ");
  rememberSearch("DUNA");
  assert.deepEqual(searchHistory(), ["DUNA"]);
  setSearchOwner({ username: "first" }, { id: 2 });
  assert.deepEqual(searchHistory(), []);
  rememberSearch("profile two");
  setSearchOwner({ username: "second" }, { id: 1 });
  assert.deepEqual(searchHistory(), []);
  setSearchOwner({ username: "first" }, { id: 1 });
  assert.deepEqual(searchHistory(), ["DUNA"]);
  for (let index = 0; index < 25; index++) rememberSearch("term" + index);
  assert.equal(searchHistory().length, 20);
  assert.equal(searchHistory()[0], "term24");
  removeSearch("term24");
  assert.equal(searchHistory()[0], "term23");
  clearSearchHistory();
  assert.deepEqual(searchHistory(), []);
  setSearchOwner(null, null);
  rememberSearch("signed out");
  assert.deepEqual(searchHistory(), []);
  global.localStorage = {
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
    removeItem: () => {
      throw Error("blocked");
    },
  };
  setSearchOwner({ username: "first" }, { id: 1 });
  assert.doesNotThrow(() => {
    rememberSearch("optional");
    removeSearch("optional");
    clearSearchHistory();
  });
  delete global.localStorage;
});

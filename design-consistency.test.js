"use strict";
// Audit designové konzistence 2026-10-22 (movly-web #223).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const checker = require("./scripts/check-translations.js");

const moduleURL = (file) =>
  `data:text/javascript;base64,${Buffer.from(fs.readFileSync(path.join(__dirname, file), "utf8")).toString("base64")}`;

test("hodnocení má jeden formát „92 %“ s nezlomitelnou mezerou", async () => {
  const { formatRating, ratingPercent } = await import(moduleURL("app/format.js"));
  assert.equal(formatRating(92), "92 %");
  assert.equal(formatRating(91.6), "92 %");
  assert.equal(formatRating("87"), "87 %");
  assert.equal(formatRating(0), "0 %");
  assert.equal(formatRating(140), "100 %");
  for (const missing of [null, undefined, "", "n/a", NaN]) assert.equal(formatRating(missing), null);
  assert.equal(ratingPercent(-3), 0);
  assert.notEqual(formatRating(92), "92%", "dříve plakát a detail ukazovaly 92% bez mezery");
});

test("kvalita je štítek 4K / HD / HDR, nikdy surové rozlišení", async () => {
  const { qualityLabel, qualityFromResolution, hdrLabel } = await import(moduleURL("app/format.js"));
  assert.equal(qualityLabel(2160), "4K");
  assert.equal(qualityLabel(1600, 3840), "4K", "širokoúhlé 4K má nižší výšku");
  assert.equal(qualityLabel(1080), "HD");
  assert.equal(qualityLabel(720), "HD");
  assert.equal(qualityLabel(480), null);
  assert.equal(qualityLabel(undefined), null);
  assert.equal(qualityFromResolution("2160p"), "4K");
  assert.equal(qualityFromResolution("1080p"), "HD");
  assert.equal(qualityFromResolution("4K"), "4K");
  assert.equal(qualityFromResolution("576p"), null);
  assert.equal(hdrLabel("Dolby Vision"), "HDR");
  assert.equal(hdrLabel("HDR10"), "HDR");
  assert.equal(hdrLabel("SDR"), null);
  assert.equal(hdrLabel(""), null);
});

test("název žánru odpovídá jazyku rozhraní", async () => {
  const { genreName } = await import(moduleURL("app/format.js"));
  const genre = { id: 878, name: "Science Fiction", name_cs: "Sci-fi" };
  assert.equal(genreName(genre, "cs"), "Sci-fi");
  assert.equal(genreName(genre, "en"), "Science Fiction");
  assert.equal(genreName(genre, "sk"), "Sci-fi", "bez slovenského názvu se použije český");
  assert.equal(genreName({ ...genre, name_sk: "Vedecká fantastika" }, "sk"), "Vedecká fantastika");
  assert.equal(genreName({ id: 1, name_cs: "Drama" }, "en"), "Drama");
});

test("podtrasy Mých seznamů a kolekce zvýrazní rodičovskou položku navigace", async () => {
  const { navigationParent } = await import(moduleURL("app/navigation.js"));
  for (const route of ["history", "hidden", "offline"]) assert.equal(navigationParent(route), "lists", route);
  assert.equal(navigationParent("collection"), "home");
  for (const route of ["home", "movies", "series", "lists", "friends", "search"]) assert.equal(navigationParent(route), route);
  const html = fs.readFileSync(path.join(__dirname, "app/index.html"), "utf8");
  assert.match(html, /data-page="lists">Moje seznamy</);
  assert.doesNotMatch(html, /Moje knihovna|Pomoz vylepšit Movly/);
  for (const parent of new Set(["history", "hidden", "offline", "collection"].map(navigationParent)))
    assert.match(html, new RegExp(`data-page="${parent}"`), `rodič ${parent} musí mít položku v navigaci`);
});

test("kontrola překladů selže na doslovném textu bez klíče, i přes alias", () => {
  const source = [
    'import { translateUI as t } from "./i18n.js";',
    'import { translateUI } from "./i18n.js";',
    'translateUI("Známý text");',
    't(`Nový text bez klíče`);',
    'translateUI("Text {0}", 3);',
    'translateUI(dynamic);',
    'translateUI(`Šablona ${x}`);',
  ].join("\n");
  const hits = checker.translateLiterals(source, "fixture.js").map((hit) => hit.text);
  assert.deepEqual(hits, ["Známý text", "Nový text bez klíče", "Text {0}"]);
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "movly-i18n-"));
  try {
    const file = path.join(dir, "fixture.js");
    fs.writeFileSync(file, source);
    const missing = checker.missingKeys([file], { "Známý text": ["Známy text", "Known text"], "Text {0}": ["Text {0}", ""] });
    assert.deepEqual(missing.map((hit) => hit.text), ["Nový text bez klíče", "Text {0}"], "prázdný překlad se počítá jako chybějící");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("aplikace nemá text v translateUI() ani ve shellu bez SK/EN klíče a slovník nemá duplicity", () => {
  const translations = checker.loadTranslations();
  assert.deepEqual(checker.missingKeys(checker.appModules(), translations), []);
  const html = fs.readFileSync(path.join(__dirname, "app/index.html"), "utf8");
  assert.ok(checker.shellTexts(html).includes("Moje seznamy"));
  assert.deepEqual(checker.missingShellKeys(html, translations), []);
  assert.deepEqual(checker.duplicateKeys(fs.readFileSync(path.join(__dirname, "app/translations.js"), "utf8")), []);
  assert.deepEqual(checker.duplicateKeys('export const translations = { "A": ["a", "a"], A: ["b", "b"] };'), ["A"]);
});

test("tokeny webu odpovídají DESIGN §2 a §10 a starší natvrdo zadané barvy zmizely", () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, file), "utf8");
  const styles = read("app/styles.css");
  const root = styles.slice(0, styles.indexOf("}"));
  const token = (name) => new RegExp(`--${name}:\\s*([^;]+);`).exec(root)?.[1].trim().toLowerCase();
  assert.equal(token("bg-base"), "#0a0a12");
  assert.equal(token("bg-surface"), "#14141f");
  assert.equal(token("bg-raised"), "#1c1c2a");
  assert.equal(token("text-tertiary"), "#9494a8");
  assert.equal(token("gradient-brand"), "linear-gradient(135deg, #a78bfa 0%, #8b5cf6 33%, #c026d3 66%, #ec4899 100%)");
  assert.equal(token("gradient-control"), "linear-gradient(135deg, #7c3aed 0%, #a21caf 50%, #be185d 100%)");
  const providers = { webshare: "#3b82f6", fastshare: "#f59e0b", hellspy: "#14b8a6", ulozto: "#ef4444", prehrajto: "#d7141a" };
  for (const [name, hex] of Object.entries(providers)) assert.equal(token(`provider-${name}`), hex, name);
  const css = ["app/styles.css", "app/css/catalog.css", "app/css/library.css", "app/css/account.css", "app/css/player.css"].map(read).join("\n");
  for (const legacy of ["#302343", "#a8a7b4", "#292934", "#bd9ffa", "#15191e", "#ffa499", "#6c6c80", "#22c55e", "#555"])
    assert.ok(!css.toLowerCase().includes(legacy), `natvrdo zadaná barva ${legacy}`);
  for (const removed of [".pk-spinner", ".pk-segmented", ".fb-empty", ".pk-empty", ".stat-card", ".share-row"])
    assert.ok(!css.includes(`${removed} {`) && !css.includes(`${removed},`), `odstraněná varianta ${removed}`);
  assert.equal((css.match(/^\.source-row\s*\{/gm) || []).length, 0, ".source-row nemá konkurenční definice");
  assert.equal((css.match(/^\.catalog-grid\s*\{/gm) || []).length, 1, "jediná definice mřížky");
  const breakpoints = new Set([...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1])));
  assert.deepEqual([...breakpoints].sort((a, b) => a - b), [600, 900, 1240]);
  assert.doesNotMatch(read("app/play-activation.js"), /cssText/);
  // Vylepšit Movly zapisuje u neaktivních záložek aria-current="false"; holý [aria-current] by zvýraznil všechny.
  const selected = styles.slice(styles.indexOf(".chip[aria-pressed=\"true\"],"), styles.indexOf("background: var(--gradient-control)", styles.indexOf(".chip[aria-pressed=\"true\"],")));
  assert.doesNotMatch(selected, /\[aria-current\](?!:not\(\[aria-current="false"\]\))/, "vybraný stav nesmí reagovat na aria-current=\"false\"");
  // Hover v později načtených stylech nesmí pod kurzorem přebít vybraný stav.
  for (const component of ["fb-pill", "admin-pill", "pk-chip", "choice-chip", "season-pill"])
    assert.doesNotMatch(css, new RegExp(`^\\.${component}:hover`, "m"), `${component}:hover musí vynechat vybraný stav`);
});

test("TV lite má ES5 slovník textů cs/sk/en a žádný český literál mimo něj", () => {
  const vm = require("node:vm");
  const source = fs.readFileSync(path.join(__dirname, "app/tv/tv.js"), "utf8");
  const start = source.indexOf("  var TEXT = {"), end = source.indexOf("  function t(cs)");
  const tail = source.slice(end, source.indexOf("\n  }\n", end) + 4);
  const language = source.match(/  function homeLanguage\(\) \{[\s\S]*?\n  \}\n/)[0];
  for (const [stored, expected] of [[null, "Zkusit znovu"], ["sk", "Skúsiť znova"], ["en", "Try again"]]) {
    const context = { localStorage: { getItem: () => stored } };
    vm.runInNewContext(source.slice(start, end) + tail + language, context);
    assert.equal(vm.runInNewContext('t("Zkusit znovu")', context), expected);
    assert.equal(vm.runInNewContext('t("Neznámý text")', context), "Neznámý text");
    for (const [key, value] of Object.entries(vm.runInNewContext("TEXT", context))) {
      assert.equal(value.length, 2, key);
      assert.ok(value.every((text) => typeof text === "string" && text.trim()), key);
    }
  }
  const outside = source.slice(0, start) + source.slice(end);
  const literals = [...outside.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)]
    .filter((m) => /[á-žÁ-Ž]/.test(m[1]) && m[1].length > 1 && outside.slice(m.index - 2, m.index) !== "t(");
  assert.deepEqual(literals.map((m) => m[1]), [], "český text v tv.js musí jít přes t()");
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "app/tv/tv.css"), "utf8"), /#ff4f6d|#e3355a|#673baa/i, "TV lite bez červeno-růžové palety");
});

test("kořenové stránky používají sdílené tokeny se stejnými hodnotami jako aplikace", () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, file), "utf8");
  const tokens = (css) => Object.fromEntries([...css.slice(0, css.indexOf("}")).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toLowerCase()]));
  const app = tokens(read("app/styles.css")), shared = tokens(read("assets/tokens.css"));
  for (const name of ["bg-base", "bg-surface", "bg-raised", "text-secondary", "text-tertiary", "gradient-brand", "gradient-control"])
    assert.equal(shared[name], app[name], name);
  assert.match(read("activate.css"), /@import url\("\/assets\/tokens\.css"\)/);
  for (const page of ["privacy.html", "delete-account.html", "en/privacy.html", "en/delete-account.html"]) {
    const html = read(page);
    assert.match(html, /assets\/tokens\.css/, page);
    assert.doesNotMatch(html, /#6C6C7E/i, `${page}: sekundární text s kontrastem pod 4,5:1`);
  }
});

"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { checkFiles, checkSource, tvScripts } = require("./scripts/check-es5.js");

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("TV lite a legacy.js zůstávají ES5 pro prohlížeče TV (Chrome 34)", () => {
  const files = tvScripts().map((file) => path.relative(root, file));
  assert.ok(files.includes("app/legacy.js"));
  assert.ok(files.includes("app/tv/tv.js"));
  assert.deepEqual(checkFiles(), []);
  // Stráž skutečně zachytí moderní syntaxi i API, ale ne text v řetězcích a komentářích.
  for (const sample of ["let a = 1;", "const b = 2;", "var f = () => 1;", "var t = `x`;", "class A {}", "var a = [...b];",
    "var a = b?.c;", "for (var x of y) {}", "fetch('/x');", "Object.assign({}, {});", "[1].includes(1);", "function f(a = 1) {}"])
    assert.notDeepEqual(checkSource(sample), [], sample);
  assert.deepEqual(checkSource("var r = /=>`let /; var s = \"const x => `\"; // let y\n/* const z */"), []);
  // Volitelně i skutečný ES5 parser, pokud je acorn v prostředí dostupný.
  let acorn = null;
  try { acorn = require("acorn"); } catch { /* projekt nemá npm závislosti */ }
  if (acorn) for (const file of tvScripts()) acorn.parse(fs.readFileSync(file, "utf8"), { ecmaVersion: 5 });
});

test("TV lite styly nepoužívají CSS proměnné, grid ani sticky", () => {
  const css = read("app/tv/tv.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /var\(--|--[a-z-]+\s*:/);
  assert.doesNotMatch(css, /display\s*:\s*(?:inline-)?grid/);
  assert.doesNotMatch(css, /position\s*:\s*sticky/);
  assert.match(css, /\.tv-f:focus/);
});

test("TV vstupní stránka nemá inline skripty ani styly (CSP)", () => {
  const html = read("app/tv/index.html");
  assert.match(html, /data-movly-tv="1"/);
  for (const tag of html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) || []) {
    assert.match(tag, /\bsrc="\/app\/[^"]+\.js"/);
    assert.match(tag, /><\/script>$/);
  }
  assert.doesNotMatch(html, /<style|\sstyle=|\son[a-z]+=/i);
  assert.match(html, /<script src="\/app\/legacy.js" defer><\/script>/);
});

test("vendorovaný hls.js 0.14.17 (ES5 UMD) má licenci a bez eval", () => {
  const hls = read("app/vendor/hls-0.14.17.light.min.js");
  assert.match(read("app/vendor/hls-0.14.17-LICENSE.txt"), /Apache License/);
  assert.match(hls, /e\.Hls=t\(\)/);
  assert.doesNotMatch(hls, /\beval\(|new Function\(/);
  assert.doesNotThrow(() => new vm.Script(hls));
});

// Minimální DOM pro spuštění legacy.js v izolovaném kontextu.
function runLegacy({ modern = false, search = "", hash = "", tvPage = false, booting = true } = {}) {
  const timers = [];
  let replaced = null;
  function element(tag) {
    return {
      tagName: tag.toUpperCase(), children: [], className: "", parentNode: null,
      appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; return child; },
      get firstChild() { return this.children[0] || null; },
    };
  }
  const head = element("head"), content = element("main");
  const html = { className: "", getAttribute: (name) => (name === "data-movly-tv" && tvPage ? "1" : null) };
  const document = {
    readyState: "complete",
    documentElement: html,
    getElementsByTagName: (name) => (name === "head" ? [head] : []),
    getElementById: (id) => (id === "content" ? content : null),
    // Úvodní zástupný obsah #content, dokud ho aplikace nenahradí.
    querySelector: (selector) => (selector === "#content > [data-boot]" && booting ? {} : null),
    createElement: (tag) => { const node = element(tag); if (tag === "script" && modern) node.noModule = false; return node; },
    createTextNode: (text) => ({ text }),
    addEventListener() {},
  };
  const context = {
    document,
    navigator: { language: "cs-CZ", userAgent: "Mozilla/5.0 (Linux; NetCast; U) AppleWebKit/537.31 Chrome/34.0.1847.137 SmartTV/6.0" },
    location: { search, hash, replace: (url) => { replaced = url; } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    CSS: modern ? { supports: () => true } : undefined,
  };
  context.window = context;
  vm.runInNewContext(read("app/legacy.js"), context);
  const text = (node) => (node.text || "") + (node.children || []).map(text).join("");
  return { context, head, content, html, timers, replaced: () => replaced, text: () => text(content) };
}

test("legacy.js načte TV lite v nepodporovaném prohlížeči a hlášku nechá jako zálohu", () => {
  const run = runLegacy();
  const [css, script] = run.head.children;
  assert.equal(css.href, "/app/tv/tv.css");
  assert.equal(css.rel, "stylesheet");
  assert.equal(script.src, "/app/tv/tv.js");
  // Lite verze se spustila: žádná hláška.
  run.context.__movlyTvStarted = true;
  script.onload();
  assert.equal(run.content.children.length, 0);

  // Lite verzi se nepodařilo načíst: zobrazí se původní hláška.
  const failed = runLegacy();
  failed.head.children[1].onerror();
  assert.match(failed.text(), /Tento prohlížeč Movly nepodporuje/);
  assert.match(failed.html.className, /legacy-browser/);

  // Skript se načetl, ale nespustil (např. chyba syntaxe).
  const broken = runLegacy();
  broken.head.children[1].onload();
  assert.match(broken.text(), /Tento prohlížeč Movly nepodporuje/);
});

test("legacy.js v moderním prohlížeči nic nenačítá, dokud se aplikace spustí", () => {
  const run = runLegacy({ modern: true });
  assert.equal(run.head.children.length, 0);
  assert.equal(run.timers.length, 1);
  assert.equal(run.timers[0].ms, 20000);
  run.context.__movlyStarted = true;
  run.timers[0].fn();
  assert.equal(run.head.children.length, 0);
  assert.equal(run.content.children.length, 0);

  const stuck = runLegacy({ modern: true });
  stuck.timers[0].fn();
  assert.equal(stuck.head.children[1].src, "/app/tv/tv.js");

  // Starší main.js z cache příznak nenastaví, ale aplikaci vykreslí: TV lite se nespustí.
  const stale = runLegacy({ modern: true, booting: false });
  stale.timers[0].fn();
  assert.equal(stale.head.children.length, 0);
  assert.equal(stale.content.children.length, 0);
});

test("přímý vstup do TV lite: /app/?tv=1, /app/#tv a stránka /app/tv/", () => {
  assert.equal(runLegacy({ modern: true, search: "?tv=1" }).replaced(), "/app/tv/");
  assert.equal(runLegacy({ modern: true, hash: "#tv" }).replaced(), "/app/tv/");
  assert.equal(runLegacy({ modern: true, search: "?tvx=1" }).replaced(), null);
  const page = runLegacy({ modern: true, tvPage: true });
  assert.equal(page.replaced(), null);
  assert.equal(page.head.children[1].src, "/app/tv/tv.js");
});

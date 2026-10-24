"use strict";
// Nativní chování webu podle auditu docs/audits/web-native-2026-10-24 (movly-web #225).
// Prohlížečový průchod (Zpět, deep link, fokus, pozadí dialogu) ověřuje
// test-support/web-native-e2e.cjs; tady jsou čisté funkce a statické kontrakty.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, file), "utf8");
const moduleURL = (file) => `data:text/javascript;base64,${Buffer.from(read(file)).toString("base64")}`;

test("WEB-N01: detail titulu má adresu v hashi a stránka pod ním má stabilní klíč", async () => {
  const route = await import(moduleURL("app/detail-route.js"));
  assert.equal(route.detailTitleId("#movies?genre=1&title=42"), 42);
  assert.equal(route.detailTitleId("#movies?title=0"), null);
  assert.equal(route.detailTitleId("#movies?title=-3"), null);
  assert.equal(route.detailTitleId("#movies?title=4x"), null);
  assert.equal(route.detailTitleId("#movies?title=99999999999999999"), null, "mimo bezpečný rozsah");
  assert.equal(route.detailTitleId(""), null);
  assert.equal(route.withDetail("#movies?genre=1", 42), "#movies?genre=1&title=42");
  assert.equal(route.withDetail("#movies?title=1", 7), "#movies?title=7", "vnořený detail nahradí parametr");
  assert.equal(route.withDetail("", 5), "#home?title=5", "prázdný hash je Domů");
  assert.equal(route.withoutDetail("#search?q=duna&title=42"), "#search?q=duna");
  assert.equal(route.withoutDetail("#home?title=3"), "#home");
  assert.equal(route.pageKey("#search?q=duna&title=42"), route.pageKey("#search?q=duna"));
  assert.notEqual(route.pageKey("#search?q=duna"), route.pageKey("#search?q=jiny"));
  assert.equal(route.pageKey(""), route.pageKey("#home"));
  assert.equal(route.detailHref(9, "#series?page=2"), "#series?page=2&title=9");
  assert.equal(route.detailDepth(null), 0);
  assert.equal(route.detailDepth({ movlyDetailDepth: 2 }), 2);
  assert.equal(route.detailDepth({ movlyDetailDepth: "x" }), 0);
  assert.deepEqual(route.nextDetailState({ other: 1, movlyDetailDepth: 1 }), { other: 1, movlyDetailDepth: 2 });
  assert.deepEqual(route.nextDetailState(null), { movlyDetailDepth: 1 });
});

test("WEB-N01: karta titulu je odkaz, detail zapisuje adresu a Zpět ji čte", () => {
  const ui = read("app/ui.js"), library = read("app/library.js"), main = read("app/main.js");
  assert.match(ui, /linkable \? "a" : "button"/, "plakát je <a href> na detail");
  assert.match(ui, /href: detailHref\(t\.id\)/);
  assert.match(ui, /event\.metaKey \|\| event\.ctrlKey/, "Cmd/Ctrl+klik nechá prohlížeč otevřít novou kartu");
  assert.match(library, /history\.pushState\(nextDetailState\(history\.state\), "", withDetail\(location\.hash, t\.id\)\)/);
  assert.match(main, /window\.addEventListener\("hashchange"[\s\S]*?syncDetail\(\)/, "změna jen parametru detailu stránku nepřekreslí");
  assert.doesNotMatch(main, /(?<![.\w])history\.(?:go|back|replaceState|pushState)\(/, "main.js importuje `history` z personal.js; musí používat window.history");
});

test("WEB-N11: Media Session nastaví metadata, akce volají přehrávač a úklid je odebere", async () => {
  const { bindMediaSession } = await import(moduleURL("app/player-controls.js"));
  const handlers = new Map(), calls = [];
  const session = { metadata: undefined, playbackState: "playing", setActionHandler(action, fn) {
    if (action === "stop" && fn === undefined) throw new Error("unsupported");
    handlers.set(action, fn);
  } };
  class Metadata { constructor(value) { Object.assign(this, value); } }
  const release = bindMediaSession({ session, Metadata, media: { title: "Duna", subtitle: "S1 E2", artwork: "https://image.tmdb.org/t/p/w342/x.jpg" },
    handlers: { play: () => calls.push("play"), pause: () => calls.push("pause"), seekforward: (d) => calls.push(`fwd:${d.seekOffset}`) } });
  assert.equal(session.metadata.title, "Duna");
  assert.equal(session.metadata.artist, "S1 E2");
  assert.equal(session.metadata.album, "Movly");
  assert.equal(session.metadata.artwork[0].src, "https://image.tmdb.org/t/p/w342/x.jpg");
  handlers.get("play")(); handlers.get("pause")(); handlers.get("seekforward")({ seekOffset: 5 });
  assert.deepEqual(calls, ["play", "pause", "fwd:5"]);
  assert.equal(handlers.get("seekbackward"), null, "nepodporovaná akce zůstane bez obsluhy");
  release();
  assert.equal(session.metadata, null);
  assert.equal(session.playbackState, "none");
  assert.ok([...handlers.values()].every((fn) => fn === null), "po zavření přehrávače žádná obsluha nezůstane");
  assert.doesNotThrow(() => bindMediaSession({ session: undefined, media: { title: "x" }, handlers: {} })(), "prohlížeč bez API");
  assert.match(read("app/player.js"), /media: \{\s*title: t\.title/, "přehrávač předá titul a plakát");
});

test("WEB-N14: pozdní výsledky výběru zdroje nespustí přehrávání nad vráceným detailem", () => {
  const player = read("app/player.js");
  const sources = player.slice(player.indexOf("export async function sources("), player.indexOf("async function play("));
  assert.match(sources, /const pickerOpen = \(\) => dialog\.open && content\.isConnected;/);
  assert.doesNotMatch(sources.slice(sources.indexOf("const pickerOpen")), /[^.\w]dialog\.open\b(?! && content)/,
    "po zavření výběru je dialog znovu otevřený s detailem; samotné dialog.open by pustilo savedLookup/autoPlay");
  assert.match(sources, /if \(savedLookup && revision === sourceRevision && pickerOpen\(\)\)/);
});

function mediaBlock(css, query) {
  const start = css.indexOf(`@media (${query})`);
  assert.ok(start >= 0, query);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }
  throw new Error(`unterminated ${query}`);
}

test("WEB-N02/N04/N10/N17: hlavička, dialogy a ovládací prvky v CSS", () => {
  const css = read("app/styles.css");
  const compact = mediaBlock(css, "max-width: 1240px");
  assert.doesNotMatch(compact, /\.header-search span[^{]*\{[^}]*display:\s*none/, "text Hledat zůstává přístupným názvem odkazu");
  assert.match(compact, /\.header-search span \{[^}]*clip: rect\(0 0 0 0\)/);
  assert.match(css, /html:has\(body > dialog\[open\]\) \{\s*overflow: hidden;/, "otevřený dialog nehýbe stránkou");
  assert.match(css, /dialog \{\s*overscroll-behavior: contain;/);
  assert.match(css, /\.button\.hero-dot::before \{[^}]*inset: -20px -6px;/, "cíl tečky karuselu 24 × 44 px");
  assert.match(css, /\.hero-dots \{[^}]*gap: 12px;/);
  assert.doesNotMatch(mediaBlock(css, "max-width: 600px"), /\.hero-dots/, "mobil tečky nezužuje");
  assert.doesNotMatch(css, /button:disabled \{[^}]*cursor: wait/, "zakázané tlačítko není „čekání“");
});

test("WEB-N06/N20: rozbalovací panely hlavičky nejsou ARIA menu a stránka hlásí tmavé schéma", () => {
  const html = read("app/index.html");
  assert.doesNotMatch(html, /id="(?:account|inbox)-button"[^>]*aria-haspopup/, "panel s odkazy není role=menu");
  assert.match(html, /<meta name="color-scheme" content="dark" \/>/);
  assert.match(read("app/main.js"), /document\.addEventListener\("focusin"[\s\S]*?closePanels\(\)/, "panel se zavře po odchodu fokusu");
});

test("WEB-N03/N12/N13/N21: kořenové stránky jsou statické HTML bez React/Babel z CDN", () => {
  for (const file of ["index.html", "privacy.html", "delete-account.html"]) {
    const html = read(file);
    assert.doesNotMatch(html, /support\.js|unpkg\.com|<x-dc|<helmet|DCLogic|style-hover=|style-focus=/, file);
    assert.match(html, /<meta name="color-scheme" content="dark" \/>/, file);
    assert.doesNotMatch(html, /::-webkit-scrollbar/, `${file}: systémové posuvníky`);
    assert.match(html, /<main id="obsah"/, `${file}: hlavní obsah je <main>`);
  }
  assert.equal(fs.existsSync(path.join(__dirname, "support.js")), false);
  assert.doesNotMatch(read("server.js"), /"\/support\.js"/);
  const landing = read("index.html");
  assert.equal((landing.match(/<details name="faq"/g) || []).length, 6, "FAQ je nativní <details>");
  assert.equal((landing.match(/<summary /g) || []).length, 6);
  assert.doesNotMatch(landing, /data-faq-body style="max-height:0/);
  assert.match(landing, /<label for="mvUser"/);
  assert.match(landing, /<label for="mvPass"/);
  assert.match(landing, /<button[^>]* id="mvLoginBtn" type="submit"/);
  assert.match(read("landing.js"), /getElementById\('mvLoginForm'\)\?\.addEventListener\('submit'/, "logika úvodu je v /landing.js (CSP, WEB-N30)");
  assert.match(landing, /<a class="mv-skip" href="#obsah">/);
  assert.doesNotMatch(landing, /background:linear-gradient\(135deg,#8B5CF6,#EC4899\);[^"]*color:#fff/, "bílý text jen na control gradientu");
  assert.doesNotMatch(landing, /color:#6C6C7E/, "text s kontrastem 3,8:1");
  assert.match(landing, /aria-pressed="true" data-shot-tab="home"/);
  assert.match(read("assets/tokens.css"), /:root \{[^}]*color-scheme: dark;/);
  const en = read("en/index.html");
  assert.match(en, /\.btn-grad\{background:var\(--grad-control\)/);
  assert.match(en, /prefers-reduced-motion:reduce/);
  assert.match(en, /color-scheme:dark/);
  for (const file of ["en/index.html", "en/privacy.html", "en/delete-account.html"])
    assert.doesNotMatch(read(file), /--text-tertiary:#6C6C7E/, `${file}: text 3,8:1`);
  assert.match(en, /<a class="skip-link" href="#content">/);
});

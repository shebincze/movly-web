"use strict";
// Zbytek P3 z nativního auditu (docs/audits/web-native-2026-10-24, WEB-N24–N30) a z auditu
// designové konzistence #223 (WEB-16, 17, 25, 30, 32, 35); movly-web #226.
// Chování v prohlížeči (písmo 20 px, stránkování řady, karusel, mobilní nabídka úvodu,
// zastavení animací, CSP bez porušení) ověřuje test-support/web-native-e2e.cjs.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("./scripts/vendor/acorn.cjs");

const read = (file) => fs.readFileSync(path.join(__dirname, file), "utf8");
const APP_CSS = ["app/styles.css", "app/css/catalog.css", "app/css/library.css", "app/css/account.css", "app/css/player.css"];
const css = APP_CSS.map(read).join("\n");
const rootBlock = (source) => source.slice(source.indexOf(":root {"), source.indexOf("}", source.indexOf(":root {")));
const token = (source, name) => new RegExp(`--${name}:\\s*([^;]+);`).exec(rootBlock(source))?.[1].trim();
// Deklarace font-size v prvním bloku daného selektoru.
function fontOf(source, selector) {
  const at = source.indexOf(`${selector} {`);
  assert.ok(at >= 0, `selektor ${selector}`);
  return /font-size:\s*([^;]+);/.exec(source.slice(at, source.indexOf("}", at)))?.[1].trim();
}
// Zdroj funkce nebo konstanty z modulu, aby test spouštěl skutečný kód bez importů celé aplikace.
function extract(source, start) {
  const at = source.indexOf(start);
  assert.ok(at >= 0, start);
  let depth = 0;
  // U funkce začíná tělo za seznamem parametrů (výchozí hodnota `= {}` tělo není).
  const open = start.includes("function") ? at + /\)\s*\{/.exec(source.slice(at)).index + /\)\s*\{/.exec(source.slice(at))[0].length - 1 : source.indexOf("{", at);
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(at, i + 1).replace(/^export /, "");
  }
  throw new Error(`unterminated ${start}`);
}

// Minimální DOM: stačí pro el(), icon(), button() a čtení atributů.
class FakeNode {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.listeners = {};
    this.hidden = false;
    this.className = "";
    this.style = {};
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); if (key === "class") this.className = String(value); }
  getAttribute(key) { return this.attributes.has(key) ? this.attributes.get(key) : null; }
  hasAttribute(key) { return this.attributes.has(key); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  dispatch(type, event = {}) { for (const listener of this.listeners[type] || []) listener(event); }
  click() { this.dispatch("click", { preventDefault() {} }); }
  append(...nodes) { for (const node of nodes) this.children.push(typeof node === "string" ? { text: node } : node); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  get firstElementChild() { return this.children.find((node) => node instanceof FakeNode) || null; }
  get classList() {
    const node = this;
    return {
      add: (name) => { node.className = `${node.className} ${name}`.trim(); },
      contains: (name) => node.className.split(/\s+/).includes(name),
    };
  }
  get textContent() { return this.children.map((node) => (node instanceof FakeNode ? node.textContent : node.text)).join(""); }
  matches(selector) {
    return selector.startsWith(".") ? this.classList.contains(selector.slice(1)) : this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const found = [];
    (function walk(node) {
      for (const child of node.children) if (child instanceof FakeNode) { if (child.matches(selector)) found.push(child); walk(child); }
    })(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const fakeDocument = { createElement: (tag) => new FakeNode(tag), createElementNS: (ns, tag) => Object.assign(new FakeNode(tag), { namespaceURI: ns }) };
const translateStub = `function translateUI(source, ...values) { return source.replace(/\\{(\\d+)\\}/g, (m, i) => i < values.length ? String(values[i]) : m); }`;
function uiContext(extra = {}) {
  const ui = read("app/ui.js");
  const source = [translateStub, extract(ui, "export function el("), extract(ui, "const paths = {") + ";",
    extract(ui, "export function icon("), extract(ui, "export function button(")].join("\n");
  const context = vm.createContext({ document: fakeDocument, ...extra });
  vm.runInContext(source, context);
  return { context, ui };
}

test("WEB-N24: písmo aplikace respektuje velikost písma prohlížeče", () => {
  const styles = read("app/styles.css");
  assert.match(rootBlock(styles), /\n  font-size: 100%;/, ":root nesmí pevně nastavit 16px");
  const fixed = [...css.matchAll(/font-size:\s*([^;}]*\dpx[^;}]*)/g)].map((m) => m[1]);
  assert.deepEqual(fixed, [], "velikosti písma v rem, aby se škálovaly s nastavením prohlížeče");
});

test("WEB-17: nadpisy stránek a dialogů jsou z typografické škály DESIGN §3", () => {
  const styles = read("app/styles.css");
  assert.equal(token(styles, "font-display"), "clamp(2.125rem, 4vw, 2.75rem)", "display 34 → 44");
  assert.equal(token(styles, "font-title1"), "clamp(1.75rem, 2.5vw, 2rem)", "title1 28 → 32");
  assert.equal(token(styles, "font-title2"), "clamp(1.25rem, 1.8vw, 1.375rem)", "title2 20 → 22");
  assert.equal(token(styles, "font-headline"), "1.0625rem");
  assert.equal(token(styles, "font-caption"), "0.8125rem");
  assert.equal(token(styles, "font-micro"), "0.6875rem");
  const files = Object.fromEntries(APP_CSS.map((file) => [file, read(file)]));
  const pageTitles = [
    ["app/styles.css", "\nh1"], ["app/css/catalog.css", ".catalog-page .catalog-heading h1"],
    ["app/css/catalog.css", ".catalog-grid-page .catalog-heading h1,\n.collection-page > h1"], ["app/css/library.css", ".library-page h1"],
    ["app/css/account.css", ".premium-page h1.premium-title"], ["app/css/account.css", ".fb-heading h1"],
    ["app/css/account.css", ".admin-page .page-heading h1"], ["app/styles.css", ".legacy-notice h1"],
  ];
  for (const [file, selector] of pageTitles) assert.equal(fontOf(files[file], selector), "var(--font-display)", selector.trim());
  const dialogTitles = [
    ["app/styles.css", ".dialog-body h2"], ["app/css/account.css", ".premium-dialog h2"], ["app/css/account.css", ".settings-dialog h2"],
    ["app/css/account.css", ".notification-editor h2"], ["app/css/account.css", ".connections-dialog h2"], ["app/css/player.css", ".pk-picker-head h2"],
    ["app/css/player.css", ".pk-player-state h2, .pk-player-error > h2"], ["app/css/player.css", ".pk-party-heading h2"],
  ];
  for (const [file, selector] of dialogTitles) assert.equal(fontOf(files[file], selector), "var(--font-title2)", selector);
  // Mobil nesmí H1 stránek přebíjet vlastní velikostí; škálu řeší clamp().
  assert.doesNotMatch(css, /\.(?:library-page|fb-heading|admin-page \.page-heading) h1 \{ ?\n?\s*font-size: (?!var)/);
});

test("WEB-16: radiusy podle rolí s/m/l/xl a žádné literály mimo tokeny", () => {
  const styles = read("app/styles.css");
  assert.deepEqual(["s", "m", "l", "xl"].map((role) => token(styles, `radius-${role}`)), ["10px", "14px", "20px", "28px"]);
  for (const legacy of ["radius-sm", "radius-md", "radius-lg"]) assert.equal(token(styles, legacy), undefined, legacy);
  assert.doesNotMatch(rootBlock(styles), /--radius:/, "nejednoznačný --radius 12px zmizel");
  assert.doesNotMatch(css, /var\(--radius(?:-sm|-md|-lg)?\)/);
  const literal = [...css.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim())
    .filter((value) => !/^(?:0|50%|[1-4]px|var\(--radius-(?:xs|s|m|l|xl|pill)\)(?: var\(--radius-(?:l)\) 0 0)?)$/.test(value));
  assert.deepEqual(literal, [], "jen tokeny; povolené jsou drobné 1–4px proužky, 0 a kruh");
  const poster = styles.slice(styles.indexOf(".poster-frame {"), styles.indexOf("}", styles.indexOf(".poster-frame {")));
  assert.match(poster, /border-radius: var\(--radius-m\)/, "PosterCard má radius m (14)");
});

test("WEB-N25: řada plakátů má pro myš tlačítka stránkování mimo pořadí Tab", () => {
  const scrolls = [];
  let reduce = false;
  const { context, ui } = uiContext({ matchMedia: () => ({ matches: reduce }), requestAnimationFrame: (fn) => fn() });
  vm.runInContext(extract(ui, "export function railPaging("), context);
  const track = Object.assign(new FakeNode("div"), {
    scrollLeft: 0, clientWidth: 1000, scrollWidth: 3000,
    scrollBy(options) { scrolls.push(options); },
  });
  const viewport = context.railPaging(track);
  const [prev, middle, next] = viewport.children;
  assert.equal(viewport.className, "rail-viewport");
  assert.equal(middle, track);
  for (const node of [prev, next]) {
    assert.equal(node.tagName, "BUTTON");
    assert.equal(node.getAttribute("tabindex"), "-1", "klávesnice prochází karty, ne stránkování");
    assert.ok(node.getAttribute("aria-label"));
  }
  assert.equal(prev.hidden, true, "na začátku řady není kam zpět");
  assert.equal(next.hidden, false);
  next.click();
  assert.deepEqual({ ...scrolls.at(-1) }, { left: 900, behavior: "smooth" }, "posun o 90 % šířky");
  reduce = true;
  prev.click();
  assert.deepEqual({ ...scrolls.at(-1) }, { left: -900, behavior: "auto" }, "omezený pohyb bez animace");
  track.scrollLeft = 2000;
  track.dispatch("scroll");
  assert.equal(prev.hidden, false);
  assert.equal(next.hidden, true, "na konci řady není kam dál");
  track.scrollWidth = 1000; track.scrollLeft = 0;
  track.dispatch("scroll");
  assert.equal(prev.hidden && next.hidden, true, "krátká řada bez stránkování");
  assert.match(extract(ui, "export function rail("), /railPaging\(track\)/, "rail() používá stránkování");
  const styles = read("app/styles.css");
  const pointer = styles.slice(styles.indexOf("@media (hover: hover) and (pointer: fine) {"));
  assert.match(styles, /\.rail-page \{\s*display: none;/, "dotyk a pero tlačítka nevidí");
  assert.match(pointer, /\.rail-viewport:hover > \.rail-page/);
});

test("WEB-N26: karusel na Domů je region podle vzoru APG s pořadím snímku a ohlášením", () => {
  const { context } = uiContext();
  const catalog = read("app/catalog.js");
  vm.runInContext(`${extract(catalog, "function carousel(")}
    function hero(t) { return el("section", { class: "hero" }, el("div", { class: "hero-content" }, el("h1", {}, t.title))); }
    function listButton() { return null; }
    function toast() {}`, context);
  const items = [{ title: "A" }, { title: "B" }, { title: "C" }];
  const section = context.carousel(items, { detail() {} });
  assert.equal(section.getAttribute("aria-roledescription"), "karusel");
  assert.equal(section.getAttribute("aria-label"), "Doporučené tituly");
  const slides = section.querySelector(".home-carousel-slide");
  assert.equal(slides.getAttribute("aria-live"), "polite", "změnu snímku tlačítkem ohlásí čtečka");
  const current = () => slides.firstElementChild;
  assert.equal(current().getAttribute("role"), "group");
  assert.equal(current().getAttribute("aria-roledescription"), "snímek");
  assert.equal(current().getAttribute("aria-label"), "1 z 3");
  const buttons = section.querySelectorAll("button");
  buttons.at(-1).click();
  assert.equal(current().getAttribute("aria-label"), "2 z 3");
  assert.equal(current().textContent, "B");
  buttons.at(-2).click();
  buttons.at(-2).click();
  assert.equal(current().getAttribute("aria-label"), "3 z 3", "Předchozí z prvního snímku přejde na poslední");
});

test("WEB-25: souhrn použitých kritérií jsou štítky, ne vybrané chipy", () => {
  const { context } = uiContext();
  const catalog = read("app/catalog.js");
  vm.runInContext(extract(catalog, "function criteriaTags("), context);
  const group = context.criteriaTags(["Filmy", "Drama"], null);
  assert.equal(group.getAttribute("role"), "group");
  assert.equal(group.getAttribute("aria-label"), "Použitá kritéria");
  for (const tag of group.children) {
    assert.equal(tag.tagName, "SPAN");
    assert.equal(tag.className, "criteria-tag");
    assert.ok(!tag.classList.contains("chip") && !tag.classList.contains("active"), "nevypadá jako stisknutelný vybraný chip");
  }
  assert.doesNotMatch(catalog, /class: "chip active" \}/, "žádný neinteraktivní span se stylem vybraného chipu");
  const styles = read("app/styles.css");
  const rule = styles.slice(styles.indexOf(".criteria-tag {"), styles.indexOf("}", styles.indexOf(".criteria-tag {")));
  assert.doesNotMatch(rule, /min-height|gradient-control|cursor/, "štítek nemá cíl dotyku ani vybraný stav");
});

test("WEB-30: záložní pozadí hero je jen z brand tokenů", () => {
  const styles = read("app/styles.css");
  const hero = styles.slice(styles.indexOf("\n.hero {"), styles.indexOf("}", styles.indexOf("\n.hero {")));
  const background = /background:([\s\S]*?);/.exec(hero)[1];
  assert.doesNotMatch(background, /#[0-9a-f]{3,8}\b|rgba?\(/i, "žádná barva mimo tokeny");
  assert.match(background, /var\(--pink\)/);
  assert.match(background, /var\(--accent\)/);
});

test("WEB-32: activate.css nemá vlastní tokeny ani literály barev, jen sdílený tokens.css", () => {
  const activate = read("activate.css");
  const tokens = read("assets/tokens.css");
  assert.match(activate, /@import url\("\/assets\/tokens\.css"\);/);
  assert.doesNotMatch(activate, /^\s*--[\w-]+:/m, "žádná vlastní definice tokenu");
  assert.doesNotMatch(activate, /#[0-9a-f]{3,8}\b/i, "žádný hex literál");
  assert.doesNotMatch(activate.replace(/box-shadow:[^;]*;/g, ""), /rgba?\(/, "barvy jen z tokenů (stín může být černý)");
  const defined = new Set([...tokens.matchAll(/--([\w-]+):/g)].map((m) => m[1]));
  const used = new Set([...activate.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]));
  assert.deepEqual([...used].filter((name) => !defined.has(name)), [], "každý použitý token je v tokens.css");
  assert.doesNotMatch(activate, /border-radius:\s*(?:[5-9]|\d{2,})px/, "radiusy z rolí s/m/l");
  const styles = read("app/styles.css");
  for (const name of ["accent-light", "accent-tint", "success-soft", "success-tint", "danger-soft", "danger-tint", "radius-s", "radius-m", "radius-l", "radius-xl", "radius-pill"])
    assert.equal(token(tokens, name), token(styles, name), `tokens.css --${name} = app`);
});

test("WEB-35: texty správce a diagnostiky jdou přes translateUI se SK/EN klíčem", async () => {
  const { translations } = await import(`data:text/javascript;base64,${Buffer.from(read("app/translations.js")).toString("base64")}`);
  const czech = /[ěščřžýáíéůúňťďó]/i;
  for (const file of ["app/client-telemetry.js", "app/playback-quality.js", "app/admin.js"]) {
    const ast = acorn.parse(read(file), { ecmaVersion: "latest", sourceType: "module" });
    const untranslated = [];
    (function walk(node, parent) {
      if (!node || typeof node.type !== "string") return;
      const literal = node.type === "Literal" && typeof node.value === "string" ? node.value
        : node.type === "TemplateElement" ? node.value.cooked : null;
      const isKey = parent?.type === "Property" && parent.key === node;
      if (literal && czech.test(literal) && !isKey && !translations[literal]?.every(Boolean)) untranslated.push(literal);
      for (const [key, value] of Object.entries(node)) {
        if (key === "parent") continue;
        if (Array.isArray(value)) value.forEach((child) => walk(child, node));
        else if (value && typeof value.type === "string") walk(value, node);
      }
    })(ast, null);
    assert.deepEqual(untranslated, [], `${file}: český text bez SK/EN klíče`);
  }
  assert.doesNotMatch(read("app/admin.js"), /\}, "auto"\)/, "štítek automatického schválení je přeložený");
  assert.doesNotMatch(read("app/client-telemetry.js"), /el\("h1", \{\}, "/);
  assert.doesNotMatch(read("app/playback-quality.js"), /el\("h1", \{\}, "/);
});

test("WEB-N27/N28: úvodní stránka má mobilní nabídku a viditelné zastavení animací", () => {
  const landing = read("index.html");
  const desktop = /<nav class="mv-desktop-nav"[\s\S]*?<\/nav>/.exec(landing)[0];
  const mobile = /<details class="mv-mobile-nav"[\s\S]*?<\/details>/.exec(landing)[0];
  const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  for (const href of hrefs(desktop)) assert.ok(hrefs(mobile).includes(href), `mobilní nabídka obsahuje ${href}`);
  assert.match(mobile, /<summary>Nabídka<\/summary>/);
  const narrow = landing.slice(landing.indexOf("@media(max-width:900px){"), landing.indexOf("}", landing.indexOf("@media(max-width:900px){") + 30) + 200);
  assert.match(narrow, /\.mv-desktop-nav\{display:none!important;\}/);
  assert.match(narrow, /\.mv-mobile-nav\{display:block;\}/);
  assert.match(landing, /\.mv-mobile-nav\{display:none;position:relative;\}/, "na desktopu nabídka není");
  const en = read("en/index.html");
  const enDesktop = [...en.matchAll(/<a class="desk" href="([^"]+)"/g)].map((m) => m[1]);
  const enMobile = /<details class="mobile-nav"[\s\S]*?<\/details>/.exec(en)[0];
  for (const href of enDesktop) assert.ok(hrefs(enMobile).includes(href), `en: mobile menu has ${href}`);
  assert.match(en, /@media\(max-width:880px\)\{\.mobile-nav\{display:block\}\}/);
  assert.match(landing, /<button type="button" class="mv-motion-toggle" id="mvMotionToggle">Pozastavit animace<\/button>/);
  assert.match(landing, /#mvLandingRoot\.mv-motion-paused \*[^{]*\{animation-play-state:paused!important;\}/);
  const script = read("landing.js");
  assert.match(script, /root\.classList\.toggle\('mv-motion-paused', paused\)/);
  assert.match(script, /paused \? 'Spustit animace' : 'Pozastavit animace'/);
});

test("WEB-N30: kořenové stránky nemají inline skripty ani obsluhy událostí a nasazení je obsahuje", () => {
  const pages = ["index.html", "privacy.html", "delete-account.html", "activate.html", "devices.html", "party.html", "en/index.html", "en/privacy.html", "en/delete-account.html"];
  for (const page of pages) {
    const html = read(page);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${page}: inline skript by CSP script-src 'self' zablokovala`);
    assert.doesNotMatch(html, /<[a-z][^>]*\son[a-z]+="/i, `${page}: inline obsluha události`);
    assert.doesNotMatch(html, /javascript:/i, page);
  }
  for (const script of ["landing.js", "en/landing.js", "party.js"]) assert.ok(fs.existsSync(path.join(__dirname, script)), script);
  // Balíček nasazení musí obsahovat každý soubor, který server servíruje z kořene (a žádný neexistující).
  const deploy = read("scripts/deploy-web-release.sh");
  const list = deploy.slice(deploy.indexOf("--exclude='design'"), deploy.indexOf("# Preflight"));
  const packed = list.replace(/--exclude='[^']*'/g, "").split(/[\s\\]+/).filter((entry) => /^[\w.-][\w./-]*$/.test(entry) && entry !== "tar");
  // provider-resolver vzniká až skriptem build-provider-resolver.sh těsně před balením.
  for (const entry of packed.filter((name) => name !== "provider-resolver"))
    assert.ok(fs.existsSync(path.join(__dirname, entry)), `nasazení balí neexistující ${entry}`);
  const server = read("server.js");
  const rootFiles = JSON.parse(/const rootFiles = new Set\((\[[^\]]+\])\)/.exec(server)[1]);
  for (const file of rootFiles) assert.ok(packed.includes(file.slice(1)), `nasazení obsahuje ${file}`);
  assert.ok(packed.includes("en"), "en/landing.js se balí s adresářem en");
});

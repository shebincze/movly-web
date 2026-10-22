#!/usr/bin/env node
"use strict";
// Kontrola, že každý doslovný text v translateUI() má klíč v app/translations.js.
// Bez klíče by slovenské a anglické rozhraní ukázalo češtinu (audit WEB-05).
// Dynamické argumenty (proměnné, šablony s ${…}) kontrola přeskakuje.
const fs = require("node:fs");
const path = require("node:path");
const acorn = require("./vendor/acorn.cjs");

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "app");

// Najde všechna volání translateUI s doslovným prvním argumentem.
function translateLiterals(source, file = "<source>") {
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
  // Lokální názvy funkce, např. `import { translateUI as t }`.
  const names = new Set(["translateUI"]);
  for (const node of ast.body)
    if (node.type === "ImportDeclaration")
      for (const spec of node.specifiers)
        if (spec.type === "ImportSpecifier" && spec.imported.name === "translateUI") names.add(spec.local.name);
  const found = [];
  (function walk(node) {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "CallExpression" && node.callee.type === "Identifier" && names.has(node.callee.name)) {
      const arg = node.arguments[0];
      let text = null;
      if (arg?.type === "Literal" && typeof arg.value === "string") text = arg.value;
      else if (arg?.type === "TemplateLiteral" && arg.expressions.length === 0) text = arg.quasis[0].value.cooked;
      if (text !== null) found.push({ text, file, line: node.loc.start.line });
    }
    for (const key of Object.keys(node)) {
      if (key === "loc") continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value.type === "string") walk(value);
    }
  })(ast);
  return found;
}

function loadTranslations() {
  const source = fs.readFileSync(path.join(APP, "translations.js"), "utf8").replace(/^export const translations\s*=/m, "return");
  return new Function(source)();
}

function missingKeys(files, translations) {
  const missing = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const hit of translateLiterals(source, path.relative(ROOT, file)))
      if (!Object.hasOwn(translations, hit.text) || !translations[hit.text].every((v) => typeof v === "string" && v.trim()))
        missing.push(hit);
  }
  return missing;
}

// Texty statického shellu app/index.html překládá translateShell() jen podle klíče.
const SHELL_IGNORED = new Set(["Movly", "M", "/"]);
function shellTexts(html) {
  const body = html.slice(html.indexOf("<body"));
  const decode = (text) => text.replace(/&amp;/g, "&").replace(/&nbsp;/g, "\u00a0").trim();
  const texts = [];
  for (const match of body.matchAll(/>([^<>]+)</g)) texts.push(decode(match[1]));
  for (const match of body.matchAll(/\s(?:aria-label|placeholder|title)="([^"]+)"/g)) texts.push(decode(match[1]));
  return [...new Set(texts)].filter((text) => text && !SHELL_IGNORED.has(text) && !text.startsWith("©"));
}
function missingShellKeys(html, translations) {
  return shellTexts(html)
    .filter((text) => !Object.hasOwn(translations, text))
    .map((text) => ({ text, file: "app/index.html", line: 0 }));
}
// Duplicitní klíč v objektu překladů tiše přepíše dřívější překlad.
function duplicateKeys(source) {
  const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const object = ast.body[0].declaration.declarations[0].init;
  const seen = new Set(), duplicates = [];
  for (const property of object.properties) {
    const key = property.key.type === "Identifier" ? property.key.name : property.key.value;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  return duplicates;
}
function appModules() {
  return fs
    .readdirSync(APP)
    .filter((name) => name.endsWith(".js") && name !== "translations.js")
    .map((name) => path.join(APP, name));
}

module.exports = { translateLiterals, loadTranslations, missingKeys, missingShellKeys, shellTexts, duplicateKeys, appModules };

if (require.main === module) {
  const translations = loadTranslations();
  const missing = [
    ...missingKeys(appModules(), translations),
    ...missingShellKeys(fs.readFileSync(path.join(APP, "index.html"), "utf8"), translations),
  ];
  const duplicates = duplicateKeys(fs.readFileSync(path.join(APP, "translations.js"), "utf8"));
  for (const hit of missing) console.error(`${hit.file}:${hit.line} chybí překlad: ${JSON.stringify(hit.text)}`);
  for (const key of duplicates) console.error(`app/translations.js duplicitní klíč: ${JSON.stringify(key)}`);
  if (missing.length || duplicates.length) {
    console.error(`check-translations: ${missing.length} textů bez klíče, ${duplicates.length} duplicitních klíčů`);
    process.exit(1);
  }
  console.log("check-translations: všechny doslovné texty translateUI() mají SK/EN klíč");
}

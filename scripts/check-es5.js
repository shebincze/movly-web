#!/usr/bin/env node
"use strict";
// Kontrola, že skripty pro staré prohlížeče TV (Chrome 34) zůstávají ES5.
// Vendored Acorn 8.15.0 (MIT) parses ecmaVersion 5 without npm installation.
// Additional lexical guards reject unsupported runtime APIs.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("./vendor/acorn.cjs");

const ROOT = path.resolve(__dirname, "..");
const KEYWORDS_BEFORE_REGEX = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else"]);

// Vrátí kód, ve kterém jsou komentáře, řetězce a regulární výrazy nahrazené mezerami.
function codeOnly(source) {
  let out = "", i = 0, lastSignificant = "", lastWord = "";
  const n = source.length;
  const blank = (text) => text.replace(/[^\n]/g, " ");
  while (i < n) {
    const c = source[i], next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && source[j] !== c) {
        if (source[j] === "\\") j++;
        j++;
      }
      out += c + blank(source.slice(i + 1, j)) + c;
      i = j + 1;
      lastSignificant = c;
      lastWord = "";
      continue;
    }
    if (c === "`") {
      // Šablonové řetězce nejsou ES5: ponecháme je viditelné pro stráž.
      out += c;
      i++;
      lastSignificant = c;
      continue;
    }
    if (c === "/") {
      const regexAllowed = lastSignificant === "" || "(,=:[!&|?{};+-*%<>~^".includes(lastSignificant) || KEYWORDS_BEFORE_REGEX.has(lastWord);
      if (regexAllowed) {
        let j = i + 1, inClass = false;
        while (j < n && source[j] !== "\n") {
          if (source[j] === "\\") { j += 2; continue; }
          if (source[j] === "[") inClass = true;
          else if (source[j] === "]") inClass = false;
          else if (source[j] === "/" && !inClass) break;
          j++;
        }
        j++;
        while (j < n && /[a-z]/i.test(source[j])) j++;
        out += "/" + blank(source.slice(i + 1, j - 1)) + "/";
        i = j;
        lastSignificant = "/";
        lastWord = "";
        continue;
      }
    }
    out += c;
    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(source[j])) j++;
      const word = source.slice(i, j);
      out += word.slice(1);
      i = j;
      lastSignificant = "a";
      lastWord = word;
      continue;
    }
    lastSignificant = c;
    lastWord = "";
    i++;
  }
  return out;
}

const FORBIDDEN = [
  [/\blet\s+[A-Za-z_$[{]/, "let"],
  [/\bconst\s+[A-Za-z_$[{]/, "const"],
  [/=>/, "arrow function"],
  [/`/, "template literal"],
  [/\bclass\s+[A-Za-z_$]/, "class"],
  [/\bimport\s*[\s{*("']/, "import"],
  [/\bexport\s+/, "export"],
  [/\basync\s+function\b|\basync\s*\(/, "async"],
  [/\bawait\s+/, "await"],
  [/\.\.\.[A-Za-z_$[({]/, "spread/rest"],
  [/\?\.[A-Za-z_$[(]/, "optional chaining"],
  [/\?\?/, "nullish coalescing"],
  [/\bfor\s*\([^;)]*\bof\b/, "for…of"],
  [/function\s*[A-Za-z_$]*\s*\([^)]*=/, "default parameter"],
  [/\bfetch\s*\(/, "fetch"],
  [/\bObject\.(?:assign|entries|values|fromEntries)\b/, "Object.assign/entries/values"],
  [/\.(?:includes|find|findIndex|padStart|padEnd|startsWith|endsWith|repeat)\s*\(/, "ES2015+ String/Array method"],
  [/\bArray\.(?:from|of)\b/, "Array.from/of"],
  [/\bnew\s+(?:Map|Set|WeakMap|WeakSet|Proxy)\s*\(/, "Map/Set/WeakMap/Proxy"],
  [/\bSymbol\b/, "Symbol"],
  [/\bReflect\./, "Reflect"],
];

function checkSource(source) {
  const problems = [];
  try {
    acorn.parse(source, { ecmaVersion: 5 });
    new vm.Script(source, { filename: "es5-check.js" });
  } catch (error) {
    problems.push(`syntaxe: ${error.message}`);
    return problems;
  }
  const code = codeOnly(source);
  const lines = code.split("\n");
  lines.forEach((line, index) => {
    for (const [pattern, name] of FORBIDDEN)
      if (pattern.test(line)) problems.push(`řádek ${index + 1}: ${name}`);
  });
  return problems;
}

function tvScripts() {
  const dir = path.join(ROOT, "app", "tv");
  return [
    path.join(ROOT, "app", "legacy.js"),
    path.join(ROOT, "app", "play-activation.js"),
    path.join(ROOT, "app", "vendor", "hls-0.14.17.light.min.js"),
    ...fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort().map((f) => path.join(dir, f)),
  ];
}

function checkFiles(files = tvScripts()) {
  const failures = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    // Vendor feature-detects Symbol behind typeof; parse its ES5 syntax without
    // treating those guarded compatibility branches as application API usage.
    const problems = file.includes("/vendor/") ? (() => {
      try { acorn.parse(source, { ecmaVersion: 5 }); return []; }
      catch (error) { return [error.message]; }
    })() : checkSource(source);
    for (const problem of problems) failures.push(`${path.relative(ROOT, file)}: ${problem}`);
  }
  return failures;
}

module.exports = { checkSource, checkFiles, tvScripts, codeOnly };

if (require.main === module) {
  const failures = checkFiles();
  if (failures.length) {
    console.error(`ES5 kontrola selhala:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`ES5 kontrola prošla (${tvScripts().length} souborů).`);
}

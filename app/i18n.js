import { translations } from "./translations.js";
let language = "cs";
try {
  const saved = localStorage.getItem("movly.uiLanguage");
  if (["cs", "sk", "en"].includes(saved)) language = saved;
} catch {}
export function uiLanguage() {
  return language;
}
export function setUILanguage(value) {
  if (!["cs", "sk", "en"].includes(value))
    throw new Error("Invalid interface language");
  language = value;
  try {
    localStorage.setItem("movly.uiLanguage", value);
  } catch {}
  if (typeof document !== "undefined") document.documentElement.lang = value;
}
export function translateUI(source, ...values) {
  const translated =
    language === "cs"
      ? source
      : (translations[source]?.[language === "sk" ? 0 : 1] ?? source);
  return translated.replace(/\{(\d+)\}/g, (match, index) =>
    index < values.length ? String(values[index]) : match,
  );
}
export function translateShell(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode,
      source = text.textContent.trim();
    if (translations[source])
      text.textContent = text.textContent.replace(source, translateUI(source));
  }
  for (const node of root.querySelectorAll(
    "[aria-label], [placeholder], [title]",
  ))
    for (const name of ["aria-label", "placeholder", "title"])
      if (node.hasAttribute(name))
        node.setAttribute(name, translateUI(node.getAttribute(name)));
  document.documentElement.lang = language;
}

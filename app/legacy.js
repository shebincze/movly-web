/* Kontrola zastaralého prohlížeče (např. vestavěný prohlížeč starších TV).
   Záměrně ES5 bez modulů: musí běžet i tam, kde se aplikace nespustí. */
(function () {
  var lang = (navigator.language || "cs").slice(0, 2);
  var text = {
    cs: ["Tento prohlížeč Movly nepodporuje", "Vestavěný prohlížeč tohoto zařízení je zastaralý a webovou aplikaci Movly nedokáže spustit.", "Použij aktuální Chrome, Edge, Firefox nebo Safari, nebo aplikaci Movly pro iOS, Android, Android TV, Apple TV či Windows.", "Stáhnout aplikace", "Identifikace prohlížeče:"],
    sk: ["Tento prehliadač Movly nepodporuje", "Vstavaný prehliadač tohto zariadenia je zastaraný a webovú aplikáciu Movly nedokáže spustiť.", "Použi aktuálny Chrome, Edge, Firefox alebo Safari, alebo aplikáciu Movly pre iOS, Android, Android TV, Apple TV či Windows.", "Stiahnuť aplikácie", "Identifikácia prehliadača:"],
    en: ["This browser can't run Movly", "This device's built-in browser is too old to run the Movly web app.", "Use a current Chrome, Edge, Firefox or Safari, or the Movly app for iOS, Android, Android TV, Apple TV or Windows.", "Download the apps", "Browser identification:"]
  };
  var t = text[lang] || (lang === "sk" ? text.sk : lang === "cs" ? text.cs : text.en);
  function node(tag, className, value) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (value) n.appendChild(document.createTextNode(value));
    return n;
  }
  function show() {
    if (window.__movlyStarted) return;
    var main = document.getElementById("content");
    if (!main) return;
    document.documentElement.className += " legacy-browser";
    while (main.firstChild) main.removeChild(main.firstChild);
    var box = node("section", "legacy-notice");
    box.appendChild(node("h1", "", t[0]));
    box.appendChild(node("p", "", t[1]));
    box.appendChild(node("p", "", t[2]));
    var link = node("a", "legacy-link", t[3]);
    link.href = "/";
    box.appendChild(link);
    var ua = node("p", "legacy-ua", t[4] + " ");
    ua.appendChild(node("code", "", navigator.userAgent || "?"));
    box.appendChild(ua);
    main.appendChild(box);
  }
  var script = document.createElement("script");
  var modern = "noModule" in script && !!(window.CSS && CSS.supports && CSS.supports("--movly-check", "0"));
  if (!modern) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show);
    else show();
  } else {
    // Moduly existují, ale aplikace se nemusí spustit (např. nepodporovaná syntaxe).
    setTimeout(show, 20000);
  }
})();

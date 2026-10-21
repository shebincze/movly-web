/* Kontrola zastaralého prohlížeče (např. vestavěný prohlížeč starších TV).
   Záměrně ES5 bez modulů: musí běžet i tam, kde se aplikace nespustí.
   Nepodporovaný prohlížeč dostane omezenou verzi „Movly TV lite“ (/app/tv/tv.js);
   hláška o nepodporovaném prohlížeči zůstává jako záloha, když se nespustí ani ta. */
(function () {
  var lang = (navigator.language || "cs").slice(0, 2);
  var text = {
    cs: ["Tento prohlížeč Movly nepodporuje", "Vestavěný prohlížeč tohoto zařízení je zastaralý a webovou aplikaci Movly nedokáže spustit.", "Použij aktuální Chrome, Edge, Firefox nebo Safari, nebo aplikaci Movly pro iOS, Android, Android TV, Apple TV či Windows.", "Stáhnout aplikace", "Identifikace prohlížeče:"],
    sk: ["Tento prehliadač Movly nepodporuje", "Vstavaný prehliadač tohto zariadenia je zastaraný a webovú aplikáciu Movly nedokáže spustiť.", "Použi aktuálny Chrome, Edge, Firefox alebo Safari, alebo aplikáciu Movly pre iOS, Android, Android TV, Apple TV či Windows.", "Stiahnuť aplikácie", "Identifikácia prehliadača:"],
    en: ["This browser can't run Movly", "This device's built-in browser is too old to run the Movly web app.", "Use a current Chrome, Edge, Firefox or Safari, or the Movly app for iOS, Android, Android TV, Apple TV or Windows.", "Download the apps", "Browser identification:"]
  };
  // Capability detection keeps modern browsers on the full application.
  var TV_ENABLED = true;
  var t = text[lang] || (lang === "sk" ? text.sk : lang === "cs" ? text.cs : text.en);
  var root = document.documentElement;
  // Samostatná stránka /app/tv/ (data-movly-tv) spouští lite verzi vždy.
  var tvPage = root.getAttribute("data-movly-tv") === "1";
  function node(tag, className, value) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (value) n.appendChild(document.createTextNode(value));
    return n;
  }
  function show() {
    if (window.__movlyStarted || window.__movlyTvStarted || window.__movlyNoticeShown) return;
    var main = document.getElementById("content");
    if (!main) return;
    window.__movlyNoticeShown = true;
    var tvRoot = document.getElementById("tv-root");
    if (tvRoot && tvRoot.parentNode) tvRoot.parentNode.removeChild(tvRoot);
    root.className = root.className.replace(/(^|\s)tv-lite(?=\s|$)/g, " ") + " legacy-browser";
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
  // Načte omezenou TV verzi. tv.js po spuštění nastaví window.__movlyTvStarted.
  function startTv() {
    if (!TV_ENABLED) { show(); return; }
    if (window.__movlyStarted || window.__movlyTvLoading) return;
    window.__movlyTvLoading = true;
    var head = document.getElementsByTagName("head")[0] || root;
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/app/tv/tv.css";
    head.appendChild(css);
    var script = document.createElement("script");
    script.src = "/app/tv/tv.js";
    script.onerror = show;
    script.onload = function () {
      if (!window.__movlyTvStarted) show();
    };
    var policy = document.createElement("script");
    policy.src = "/app/tv/diagnostics.js";
    policy.onerror = show;
    var scoring = document.createElement("script");
    scoring.src = "/app/tv/stream-scoring.js";
    scoring.onerror = show;
    var preferences = document.createElement("script");
    preferences.src = "/app/tv/home-preferences-state.js";
    preferences.onerror = show;
    var playChoice = document.createElement("script");
    playChoice.src = "/app/play-activation.js";
    playChoice.onerror = show;
    var inventory = document.createElement("script");
    inventory.src = "/app/tv/database-availability.js";
    inventory.onerror = show;
    inventory.onload = function () { head.appendChild(script); };
    playChoice.onload = function () { head.appendChild(inventory); };
    preferences.onload = function () { head.appendChild(playChoice); };
    scoring.onload = function () { head.appendChild(preferences); };
    policy.onload = function () { head.appendChild(scoring); };
    head.appendChild(policy);
    setTimeout(function () {
      if (!window.__movlyTvStarted) show();
    }, 20000);
  }
  function whenReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  if (tvPage) {
    whenReady(startTv);
    return;
  }
  // Přímý vstup z plné aplikace: /app/?tv=1 nebo /app/#tv vede na /app/tv/.
  if (TV_ENABLED && (/(?:^|[?&])tv=1(?:&|$)/.test(location.search) || location.hash === "#tv")) {
    location.replace("/app/tv/");
    return;
  }
  var probe = document.createElement("script");
  var modern = "noModule" in probe && !!(window.CSS && CSS.supports && CSS.supports("--movly-check", "0"));
  if (!modern) {
    whenReady(startTv);
  } else {
    // Moduly existují, ale aplikace se nemusí spustit (např. nepodporovaná syntaxe).
    // Aplikace se spustila, pokud nahradila úvodní zástupný obsah. Příznak z main.js
    // nestačí: prohlížeč může mít z cache (Cloudflare) starší main.js bez příznaku.
    setTimeout(function () {
      if (window.__movlyStarted || !document.querySelector("#content > [data-boot]")) return;
      // A slow module can still start later. Do not launch a second application
      // in a module-capable browser; reserve TV loading for capability failures.
      show();
    }, 20000);
  }
})();

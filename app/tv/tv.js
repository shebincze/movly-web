/* Movly TV lite — omezená verze webové aplikace pro staré prohlížeče chytrých TV
   (např. LG NetCast, jádro Chrome 34). Záměrně ES5 bez modulů, bez fetch,
   bez inline stylů/skriptů (CSP). Ovládá se dálkovým ovladačem: šipky přesouvají
   fokus podle polohy prvků, OK (Enter) potvrzuje, Zpět (461/Backspace/Esc) vrací.
   Používá výhradně existující cesty BFF /api/app/. */
(function () {
  "use strict";
  if (window.__movlyStarted || window.__movlyTvStarted) return;

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 461, BACKSPACE: 8, ESC: 27,
    PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, STOP: 413, REWIND: 412, FORWARD: 417 };
  var NETWORK_ERROR = "Nepodařilo se spojit se serverem Movly. Zkontroluj připojení a zkus to znovu.";
  var SESSION_CODES = ["app_session_required", "session_revoked", "account_inactive", "invalid_or_expired_session"];
  var PROFILE_CODES = ["app_profile_required", "profile_grant_required", "profile_access_denied", "profile_grant_expired", "invalid_profile_grant"];
  var HLS_SCRIPT = "/app/vendor/hls-0.14.17.light.min.js";

  // ---------- pomocné funkce ----------
  function arrayList(value) { return Object.prototype.toString.call(value) === "[object Array]" ? value : []; }
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function filter(list, fn) { var out = []; each(list, function (x, i) { if (fn(x, i)) out.push(x); }); return out; }
  function map(list, fn) { var out = []; each(list, function (x, i) { out.push(fn(x, i)); }); return out; }
  function contains(list, value) { for (var i = 0; i < list.length; i++) if (list[i] === value) return true; return false; }
  function isId(value) { return typeof value === "number" && value > 0 && Math.floor(value) === value; }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return (h ? h + ":" : "") + pad(m) + ":" + pad(s);
  }
  function query(params) {
    var parts = [];
    for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k) && params[k] !== undefined && params[k] !== null)
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])));
    return parts.length ? "?" + parts.join("&") : "";
  }
  function h(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k) || attrs[k] === undefined || attrs[k] === null || attrs[k] === false) continue;
      if (k === "className") n.className = attrs[k];
      else if (k === "text") n.appendChild(document.createTextNode(String(attrs[k])));
      else if (k === "onclick") n.onclick = attrs[k];
      else n.setAttribute(k, attrs[k] === true ? "" : String(attrs[k]));
    }
    if (children) each(children, function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function button(label, onclick, className) {
    return h("button", { type: "button", className: "tv-f tv-button" + (className ? " " + className : ""), onclick: onclick, text: label });
  }
  // Vodorovná řada s tlačítky ◀ ▶: prohlížeč LG NetCast mění šipky ovladače na kurzor,
  // takže řady musí jít posouvat i kliknutím.
  function scroller(track) {
    function by(dir) {
      return function () {
        var step = Math.max(200, Math.floor(track.clientWidth * 0.8));
        track.scrollLeft = Math.max(0, track.scrollLeft + dir * step);
        sync();
      };
    }
    var prev = h("button", { type: "button", className: "tv-scroll-nav tv-scroll-prev", "aria-label": "Posunout doleva", onclick: by(-1), text: "\u25C0" });
    var next = h("button", { type: "button", className: "tv-scroll-nav tv-scroll-next", "aria-label": "Posunout doprava", onclick: by(1), text: "\u25B6" });
    function sync() {
      prev.hidden = track.scrollLeft <= 0;
      next.hidden = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
    }
    setTimeout(sync, 0);
    setTimeout(sync, 1500);
    return h("div", { className: "tv-scroller" }, [prev, track, next]);
  }
  // Obrázky jen z důvěryhodných zdrojů (stejně jako api.js imageURL).
  function imageURL(value, size) {
    if (typeof value !== "string" || !value) return null;
    if (/^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(value)) return "https://image.tmdb.org/t/p/" + (size || "w342") + value;
    if (/^https:\/\/image\.tmdb\.org\/[^\s"'<>]+$/.test(value)) return value;
    if (/^https:\/\/res\.cloudinary\.com\/dsnzqq6kh\/[^\s"'<>]+$/.test(value)) return value;
    return null;
  }
  var DIACRITICS = { "á": "a", "č": "c", "ď": "d", "é": "e", "ě": "e", "í": "i", "ň": "n", "ó": "o", "ř": "r", "š": "s", "ť": "t", "ú": "u", "ů": "u", "ý": "y", "ž": "z", "ä": "a", "ö": "o", "ü": "u", "ľ": "l", "ĺ": "l", "ŕ": "r", "ô": "o" };
  function plain(value) {
    var s = String(value || "").toLowerCase();
    if (typeof s.normalize === "function") {
      try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) { /* bez ICU */ }
    }
    return s.replace(/[^\u0000-\u007f]/g, function (c) { return DIACRITICS[c] || c; });
  }

  // ---------- API (XHR přes BFF) ----------
  function apiError(status, body) {
    var message = body && typeof body.message === "string" && body.message ? body.message
      : status === 0 ? NETWORK_ERROR : "Požadavek selhal (" + status + ").";
    var e = new Error(message);
    e.status = status;
    e.code = body && body.code;
    return e;
  }
  var pendingRequests = [], requestEpoch = 0;
  // ---------- diagnostika pro ladění na skutečných TV ----------
  // Both queue and server enforce the same closed numeric/enum schema.
  var diagnosticPolicy = window.MovlyTvDiagnostics;
  var diagQueue = [], diagTimer = null, diagCount = 0, diagKeys = 0, bootAt = new Date().getTime();
  function diag(type, data) {
    if (diagCount >= 300 || !diagnosticPolicy) return;
    var event = diagnosticPolicy.sanitize(type, data, (new Date().getTime() - bootAt) / 1000);
    if (!event) return;
    diagCount++;
    diagQueue.push(event);
    if (!diagTimer) diagTimer = setTimeout(flushDiag, 1500);
  }
  function flushDiag() {
    diagTimer = null;
    if (!diagQueue.length) return;
    var batch = diagQueue.splice(0, 20);
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/app/tv-diagnostics", true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("X-Movly-App", "1");
      xhr.send(JSON.stringify({ events: batch }));
    } catch (e) { /* ignorovat */ }
    if (diagQueue.length) diagTimer = setTimeout(flushDiag, 1500);
  }
  function mediaSupport() {
    var v = document.createElement("video"), out = {};
    function cpt(type) { try { return v.canPlayType ? v.canPlayType(type) : "none"; } catch (e) { return "err"; } }
    out.hls = cpt("application/vnd.apple.mpegurl");
    out.xhls = cpt("application/x-mpegURL");
    out.mp4 = cpt('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
    out.ts = cpt("video/mp2t");
    var MS = window.MediaSource || window.WebKitMediaSource;
    out.mse = MS ? (window.MediaSource ? "std" : "webkit") : "none";
    try { out.mseAvc = MS && MS.isTypeSupported ? MS.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"') : null; } catch (e) { out.mseAvc = "err"; }
    return out;
  }
  window.onerror = function (message, source, line, col) {
    diag("error", { stage: "runtime", l: line, c: col });
  };
  function logKey(phase, event) {
    if (diagKeys >= 60 || !diagnosticPolicy) return;
    var eventData = diagnosticPolicy.keyEvent(phase, event, document.activeElement);
    if (!eventData) return;
    diagKeys++;
    diag(phase, eventData.d);
  }
  window.addEventListener("keydown", function (event) { logKey("keydown", event); }, true);
  window.addEventListener("keypress", function (event) { logKey("keypress", event); }, true);
  window.addEventListener("keyup", function (event) { logKey("keyup", event); }, true);
  function diagnosticStage(path) {
    if (/^(?:login|logout|session)(?:\?|$)/.test(path)) return "auth";
    if (/^profiles?(?:[/?]|$)/.test(path)) return "profiles";
    if (/^home(?:\?|$)/.test(path)) return "home";
    if (/^search(?:\?|$)/.test(path)) return "search";
    if (/^titles\//.test(path)) return "detail";
    if (/^(?:sources|streaming2?|providers)\//.test(path)) return "sources";
    if (/^playback(?:[/?]|$)/.test(path)) return "playback";
    if (/^watch-history(?:[/?]|$)/.test(path)) return "history";
    return "other";
  }
  function api(path, options, done) {
    options = options || {};
    var xhr = new XMLHttpRequest(), finished = false, epoch = requestEpoch;
    xhr.open(options.method || "GET", "/api/app/" + path, true);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-Movly-App", "1");
    xhr.setRequestHeader("X-Movly-Language", "cs");
    // Pin requests to the account/profile that opened the screen, including
    // history writes and session teardown after another tab switches profiles.
    if (account && isId(account.id) && profile && isId(profile.id) && path !== "session" && path !== "profiles" && path !== "profile" && path !== "login" && path !== "logout") {
      xhr.setRequestHeader("X-Movly-Expected-Account", String(account.id));
      xhr.setRequestHeader("X-Movly-Expected-Profile", String(profile.id));
    }
    if (options.body !== undefined) xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = options.timeout || 60000;
    function finish(err, data) {
      if (finished) return;
      finished = true;
      var i = pendingRequests.indexOf(xhr);
      if (i >= 0) pendingRequests.splice(i, 1);
      if (epoch !== requestEpoch) return;
      if (err && path !== "session") diag("api", { stage: diagnosticStage(path), st: err.status });
      if (err && !options.quiet && handleAuthError(err)) return;
      if (done) done(err, data);
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || finished) return;
      if (xhr.status === 0) { finish(apiError(0)); return; }
      var data = null;
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; }
      catch (e) { finish(apiError(502, { message: "Server vrátil nečitelnou odpověď." })); return; }
      if (xhr.status >= 200 && xhr.status < 300) finish(null, data);
      else finish(apiError(xhr.status, data));
    };
    xhr.ontimeout = function () { finish(apiError(0)); };
    xhr.onerror = function () { finish(apiError(0)); };
    pendingRequests.push(xhr);
    xhr.send(options.body !== undefined ? JSON.stringify(options.body) : null);
    return xhr;
  }
  // Vypršené přihlášení vrací na přihlášení, chybějící profil na výběr profilu.
  function handleAuthError(err) {
    if (err.code === "offline_owner_changed") {
      stopPlayback();
      account = null; profile = null;
      boot();
      return true;
    }
    if (err.status === 401 || contains(SESSION_CODES, err.code)) {
      stopPlayback();
      account = null; profile = null;
      resetTo(loginScreen("Přihlášení vypršelo. Přihlas se znovu."));
      return true;
    }
    if (contains(PROFILE_CODES, err.code)) {
      stopPlayback();
      profile = null;
      resetTo(profilesScreen("Vyber profil znovu."));
      return true;
    }
    return false;
  }

  // ---------- obrazovky a historie ----------
  var root, stack = [], account = null, profile = null, historyDepth = 0, searchEnvironment = "";
  function current() { return stack[stack.length - 1]; }
  function mount(screen) {
    clear(root);
    root.appendChild(screen.el);
    root.className = "tv-root tv-screen-" + screen.name;
    // Viditelné „Zpět“ pro ovládání kurzorem (klávesa Zpět nemusí stránce dorazit).
    var head = screen.el.querySelector(".tv-header");
    if (head && stack.length > 1 && !head.querySelector(".tv-back")) head.insertBefore(button("\u25C0 Zpět", back, "tv-back"), head.firstChild);
    if (screen.onShow) screen.onShow();
    var target = screen.lastFocus && screen.el.contains(screen.lastFocus) && isFocusable(screen.lastFocus) ? screen.lastFocus : null;
    focusEl(target || firstFocusable(screen.el), true);
  }
  function remember() {
    var s = current();
    if (s && document.activeElement && s.el.contains(document.activeElement)) s.lastFocus = document.activeElement;
  }
  function destroy(screen) { if (screen && screen.onDestroy) screen.onDestroy(); }
  function push(screen) {
    remember();
    stack.push(screen);
    try { history.pushState({ movlyTv: stack.length }, ""); historyDepth++; } catch (e) { /* bez history API */ }
    mount(screen);
  }
  function popScreen() {
    if (stack.length < 2) return;
    destroy(stack.pop());
    mount(current());
  }
  function back() {
    if (stack.length < 2) return;
    if (historyDepth > 0) { history.back(); return; }
    popScreen();
  }
  function resetTo(screen) {
    // Revoke callbacks before aborting: old XHR errors must never reset a newer
    // login/profile screen. Aborts can synchronously trigger readyState changes.
    requestEpoch++;
    var obsolete = pendingRequests.slice(0);
    pendingRequests.length = 0;
    each(obsolete, function (xhr) { try { xhr.abort(); } catch (e) { /* already closed */ } });
    while (stack.length) destroy(stack.pop());
    if (screen.name === "profiles") profile = null;
    // Záznamy historie z předchozích obrazovek už nic nevracejí.
    historyDepth = 0;
    stack.push(screen);
    mount(screen);
  }
  window.addEventListener("popstate", function () {
    if (historyDepth > 0) historyDepth--;
    popScreen();
  });

  // ---------- prostorová navigace ----------
  function isFocusable(n) {
    return n && n.className && (" " + n.className + " ").indexOf(" tv-f ") >= 0 && !n.disabled && n.offsetWidth > 0 && n.offsetHeight > 0;
  }
  function focusables(scope) {
    return filter(scope.querySelectorAll(".tv-f"), isFocusable);
  }
  function firstFocusable(scope) {
    var preferred = scope.querySelector(".tv-autofocus");
    if (preferred && isFocusable(preferred)) return preferred;
    return focusables(scope)[0] || null;
  }
  function hasClass(n, name) { return n && n.className && (" " + n.className + " ").indexOf(" " + name + " ") >= 0; }
  // Posune nejbližší posuvné kontejnery, aby byl prvek celý vidět (bez scrollIntoView s volbami).
  function ensureVisible(n) {
    var p = n.parentNode, margin;
    while (p && p !== document.body) {
      if (hasClass(p, "tv-scroll-x")) {
        margin = 48;
        var left = rel(n, p).left, right = left + n.offsetWidth;
        if (left - margin < p.scrollLeft) p.scrollLeft = Math.max(0, left - margin);
        else if (right + margin > p.scrollLeft + p.clientWidth) p.scrollLeft = right + margin - p.clientWidth;
      }
      if (hasClass(p, "tv-scroll-y")) {
        margin = 80;
        var top = rel(n, p).top, bottom = top + n.offsetHeight;
        if (top - margin < p.scrollTop) p.scrollTop = Math.max(0, top - margin);
        else if (bottom + margin > p.scrollTop + p.clientHeight) p.scrollTop = bottom + margin - p.clientHeight;
      }
      p = p.parentNode;
    }
  }
  // Poloha prvku vůči obsahu kontejneru (nezávisle na aktuálním posunu).
  function rel(n, container) {
    var a = n.getBoundingClientRect(), b = container.getBoundingClientRect();
    return { left: a.left - b.left + container.scrollLeft, top: a.top - b.top + container.scrollTop };
  }
  function focusEl(n, silent) {
    if (!n) return;
    try { n.focus(); } catch (e) { /* ignorovat */ }
    ensureVisible(n);
    if (!silent) remember();
  }
  function move(direction) {
    var screen = current();
    if (!screen) return;
    var list = focusables(screen.el);
    if (!list.length) return;
    var from = document.activeElement;
    if (!from || !screen.el.contains(from) || !isFocusable(from)) { focusEl(list[0]); return; }
    var a = from.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var horizontal = direction === KEY.LEFT || direction === KEY.RIGHT;
    var best = null, bestScore = Infinity;
    each(list, function (c) {
      if (c === from) return;
      var b = c.getBoundingClientRect();
      var bx = b.left + b.width / 2, by = b.top + b.height / 2, main, cross, overlap;
      if (direction === KEY.RIGHT) { if (bx <= ax + 1 || b.left < a.left + 4) return; main = Math.max(0, b.left - a.right); }
      else if (direction === KEY.LEFT) { if (bx >= ax - 1 || b.right > a.right - 4) return; main = Math.max(0, a.left - b.right); }
      else if (direction === KEY.DOWN) { if (by <= ay + 1 || b.top < a.top + 4) return; main = Math.max(0, b.top - a.bottom); }
      else { if (by >= ay - 1 || b.bottom > a.bottom - 4) return; main = Math.max(0, a.top - b.bottom); }
      if (horizontal) {
        // Vodorovně jen v rámci stejné řady (na konci řady fokus zůstane).
        overlap = b.bottom > a.top + 2 && b.top < a.bottom - 2;
        if (!overlap) return;
        cross = Math.abs(by - ay);
      } else {
        cross = Math.abs(bx - ax);
      }
      // Svisle nejbližší řádek, pak nejmenší boční posun.
      var score = horizontal ? main + cross * 3 : main * 4 + cross;
      if (score < bestScore) { bestScore = score; best = c; }
    });
    if (best) focusEl(best);
  }
  // Po načtení dat přesune fokus na obsah, pokud s ním uživatel mezitím nehýbal.
  function autoFocus(s, scope) {
    if (current() !== s) return;
    var a = document.activeElement;
    if (s.touched && a && s.el.contains(a) && isFocusable(a)) return;
    focusEl((scope && firstFocusable(scope)) || firstFocusable(s.el), true);
  }
  function isTextInput(n) {
    return n && n.tagName === "INPUT" && n.type !== "button" && n.type !== "submit";
  }
  // Kurzor ovladače: najetí na prvek ho zvýrazní stejně jako fokus z šipek.
  document.addEventListener("mouseover", function (event) {
    var n = event.target;
    while (n && n !== document.body && !isFocusable(n)) n = n.parentNode;
    if (n && n !== document.body && n !== document.activeElement && !isTextInput(n)) { try { n.focus(); } catch (e) { /* ignorovat */ } remember(); }
  }, false);
  document.addEventListener("keydown", function (event) {
    var screen = current();
    if (!screen) return;
    var key = event.keyCode, target = event.target;
    if (key === KEY.UP || key === KEY.DOWN || key === KEY.LEFT || key === KEY.RIGHT) screen.touched = true;
    if (screen.onKey && screen.onKey(event) === true) { event.preventDefault(); return; }
    if (key === KEY.BACK || key === KEY.ESC || (key === KEY.BACKSPACE && !isTextInput(target))) {
      event.preventDefault();
      back();
      return;
    }
    if (key === KEY.UP || key === KEY.DOWN || key === KEY.LEFT || key === KEY.RIGHT) {
      if (isTextInput(target) && (key === KEY.LEFT || key === KEY.RIGHT)) {
        // Šipky uvnitř textu posouvají kurzor; navigace až na kraji pole.
        var atStart = target.selectionStart === 0 && target.selectionEnd === 0;
        var atEnd = target.selectionStart === target.value.length;
        if ((key === KEY.LEFT && !atStart) || (key === KEY.RIGHT && !atEnd)) return;
      }
      event.preventDefault();
      move(key);
      return;
    }
    if (key === KEY.ENTER && !isTextInput(target) && isFocusable(target) && screen.el.contains(target)) {
      event.preventDefault();
      target.click();
    }
  }, false);

  // ---------- společné prvky ----------
  function header(title, extra) {
    return h("header", { className: "tv-header" }, [
      h("span", { className: "tv-brand", text: "Movly" }),
      title ? h("h1", { className: "tv-title", text: title }) : null,
      extra ? h("div", { className: "tv-header-actions" }, extra) : null
    ]);
  }
  function statusBox(text, kind) {
    return h("p", { className: "tv-status" + (kind ? " tv-status-" + kind : ""), role: kind === "error" ? "alert" : "status", text: text });
  }
  function setStatus(box, text, kind) {
    clear(box);
    box.className = "tv-status" + (kind ? " tv-status-" + kind : "");
    box.hidden = !text;
    if (text) box.appendChild(document.createTextNode(text));
  }
  function makeScreen(name, children, extra) {
    var el = h("section", { className: "tv-screen tv-scroll-y" }, children);
    var s = { name: name, el: el };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) s[k] = extra[k];
    return s;
  }
  function titleOf(item) {
    var t = item && item.title && typeof item.title === "object" ? item.title : item;
    if (!t || !isId(t.id) || typeof t.title !== "string") return null;
    return t;
  }
  function posterCard(t, onclick, caption) {
    var src = imageURL(t.poster_path, "w342");
    return h("button", { type: "button", className: "tv-f tv-card", onclick: onclick, "aria-label": t.title }, [
      h("span", { className: "tv-poster" }, [
        src ? h("img", { src: src, alt: "" }) : h("span", { className: "tv-poster-fallback", text: t.title })
      ]),
      h("span", { className: "tv-card-title", text: t.title }),
      caption ? h("span", { className: "tv-card-meta", text: caption }) : null
    ]);
  }
  function rail(name, items) {
    var track = h("div", { className: "tv-rail-track tv-scroll-x" }, map(items, function (t) {
      return posterCard(t, function () { openDetail(t); });
    }));
    return h("section", { className: "tv-rail" }, [h("h2", { text: name }), scroller(track)]);
  }
  function grid(items) {
    return h("div", { className: "tv-grid" }, map(items, function (t) {
      return posterCard(t, function () { openDetail(t); }, t.year ? String(t.year) : null);
    }));
  }

  // ---------- přihlášení ----------
  function loginScreen(notice) {
    var user = h("input", { type: "text", className: "tv-f tv-input tv-autofocus", autocomplete: "username", autocapitalize: "off", spellcheck: "false", "aria-label": "Uživatelské jméno", placeholder: "Uživatelské jméno" });
    var pass = h("input", { type: "password", className: "tv-f tv-input", autocomplete: "current-password", "aria-label": "Heslo", placeholder: "Heslo" });
    var submit = h("button", { type: "submit", className: "tv-f tv-button tv-primary", text: "Přihlásit se" });
    var status = statusBox(notice || "", notice ? "info" : null);
    status.hidden = !notice;
    var busy = false;
    var form = h("form", { className: "tv-form", novalidate: true }, [
      h("label", { className: "tv-label", text: "Uživatelské jméno" }), user,
      h("label", { className: "tv-label", text: "Heslo" }), pass,
      submit, status
    ]);
    form.onsubmit = function (event) {
      event.preventDefault();
      if (busy) return;
      if (document.activeElement === user && !pass.value) { focusEl(pass); return; }
      if (document.activeElement === pass && !user.value) { focusEl(user); return; }
      if (!user.value.replace(/\s+/g, "") || !pass.value) { setStatus(status, "Vyplň uživatelské jméno a heslo.", "error"); return; }
      busy = true;
      submit.disabled = true;
      setStatus(status, "Přihlašuji…", "info");
      api("login", { method: "POST", body: { username: user.value, password: pass.value }, quiet: true }, function (err, data) {
        busy = false;
        submit.disabled = false;
        if (err) {
          pass.value = "";
          setStatus(status, err.status === 0 ? NETWORK_ERROR
            : err.status === 401 || err.status === 403 ? "Přihlášení se nepodařilo: nesprávné uživatelské jméno nebo heslo."
            : "Přihlášení se nepodařilo: " + err.message, "error");
          focusEl(pass);
          return;
        }
        searchEnvironment = data && /^[a-f0-9]{32}$/.test(data.environment || "") ? data.environment : "";
        account = data && data.account;
        profile = null;
        resetTo(profilesScreen());
      });
    };
    return makeScreen("login", [
      h("div", { className: "tv-center" }, [
        h("h1", { className: "tv-logo", text: "Movly" }),
        h("p", { className: "tv-lead", text: "Přihlas se svým účtem Movly. Text zadáš klávesnicí televizoru po stisku OK." }),
        form,
        h("p", { className: "tv-hint", text: "TV lite: omezená verze pro starší televizory." })
      ])
    ]);
  }

  // ---------- profily a PIN ----------
  function profilesScreen(notice) {
    var list = h("div", { className: "tv-profiles" });
    var status = statusBox(notice || "Načítám profily…", notice ? "info" : null);
    var logout = button("Odhlásit se", doLogout);
    function load() {
      setStatus(status, "Načítám profily…");
      api("profiles", {}, function (err, data) {
        clear(list);
        if (err) { setStatus(status, err.message, "error"); list.appendChild(button("Zkusit znovu", load, "tv-autofocus")); focusEl(firstFocusable(s.el)); return; }
        if (!data || !data.length) { setStatus(status, "Účet nemá žádný profil. Vytvoř ho v plné aplikaci Movly.", "error"); return; }
        setStatus(status, notice || "", notice ? "info" : null);
        each(data, function (p) {
          if (!isId(p.id) || typeof p.name !== "string") return;
          var src = imageURL(p.avatar_url);
          list.appendChild(h("button", { type: "button", className: "tv-f tv-profile" + (list.firstChild ? "" : " tv-autofocus"), onclick: function () { chooseProfile(p); } }, [
            h("span", { className: "tv-avatar" }, [src ? h("img", { src: src, alt: "" }) : h("span", { text: p.name.charAt(0).toUpperCase() })]),
            h("span", { className: "tv-profile-name", text: p.name }),
            p.has_pin ? h("span", { className: "tv-profile-lock", text: "Chráněno PINem" }) : null
          ]));
        });
        autoFocus(s, list);
      });
    }
    function chooseProfile(p) {
      if (p.has_pin) { push(pinScreen(p)); return; }
      setStatus(status, "Otevírám profil " + p.name + "…", "info");
      selectProfile(p, null, function (err) { if (err) setStatus(status, err.message, "error"); });
    }
    var s = makeScreen("profiles", [
      header("Kdo se dívá?", [logout]),
      status,
      list
    ], { onShow: function () { if (!list.firstChild) load(); } });
    return s;
  }
  function selectProfile(p, pin, done) {
    var body = { id: p.id };
    if (pin !== null) body.pin = pin;
    api("profile", { method: "POST", body: body, quiet: true }, function (err, data) {
      if (err) {
        if (contains(SESSION_CODES, err.code)) { handleAuthError(err); return; }
        done(err);
        return;
      }
      searchEnvironment = data && /^[a-f0-9]{32}$/.test(data.environment || "") ? data.environment : searchEnvironment;
      profile = data && data.profile;
      done(null);
      resetTo(homeScreen());
    });
  }
  function pinScreen(p) {
    var input = h("input", { type: "password", className: "tv-f tv-input tv-pin-input", inputmode: "numeric", maxlength: "8", autocomplete: "off", "aria-label": "PIN profilu", placeholder: "PIN" });
    var status = statusBox("", null);
    status.hidden = true;
    var busy = false;
    function submit() {
      if (busy) return;
      if (!/^\d{4,8}$/.test(input.value)) { setStatus(status, "PIN musí mít 4 až 8 číslic.", "error"); return; }
      busy = true;
      setStatus(status, "Ověřuji PIN…", "info");
      selectProfile(p, input.value, function (err) {
        busy = false;
        if (!err) return;
        input.value = "";
        setStatus(status, err.code === "invalid_profile_pin" || err.status === 401 ? "Nesprávný PIN. Zkus to znovu." : err.message, "error");
      });
    }
    function type(d) { if (input.value.length < 8) input.value += d; }
    var keys = h("div", { className: "tv-keypad" });
    each(["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"], function (d) {
      keys.appendChild(button(d, function () {
        if (d === "OK") submit();
        else if (d === "⌫") input.value = input.value.slice(0, -1);
        else type(d);
      }, (d === "OK" ? "tv-primary" : "") + (d === "1" ? " tv-autofocus" : "")));
    });
    var form = h("form", { className: "tv-form tv-pin-form", novalidate: true }, [input]);
    form.onsubmit = function (event) { event.preventDefault(); submit(); };
    return makeScreen("pin", [
      header("Profil " + p.name),
      h("div", { className: "tv-center" }, [
        h("p", { className: "tv-lead", text: "Zadej PIN profilu. Můžeš použít číselná tlačítka ovladače." }),
        form, keys, status,
        button("Zpět", back)
      ])
    ], {
      onKey: function (event) {
        var k = event.keyCode;
        if (k >= 48 && k <= 57 && event.target !== input) { type(String(k - 48)); return true; }
        if (k >= 96 && k <= 105 && event.target !== input) { type(String(k - 96)); return true; }
        return false;
      }
    });
  }
  function doLogout() {
    api("logout", { method: "POST", body: {}, quiet: true }, function () {
      account = null;
      profile = null;
      resetTo(loginScreen("Byl(a) jsi odhlášen(a)."));
    });
  }

  // ---------- Domů ----------
  function homeScreen() {
    var body = h("div", { className: "tv-home" });
    var status = statusBox("Načítám Domů…");
    var s;
    function load() {
      setStatus(status, "Načítám Domů…");
      api("home" + query({ include_highlights: "true", page: 1 }), {}, function (err, data) {
        clear(body);
        if (err) {
          setStatus(status, err.message, "error");
          body.appendChild(button("Zkusit znovu", load, "tv-autofocus"));
          autoFocus(s, body);
          return;
        }
        var sections = data && data.sections && data.sections.length !== undefined ? data.sections.slice(0) : [];
        sections.sort(function (a, b) { return (a.display_order || 0) - (b.display_order || 0); });
        var shown = 0;
        each(sections, function (row) {
          if (!row || typeof row.name !== "string") return;
          if (row.kind === "collections") {
            var banners = filter(row.collections || [], function (c) { return c && typeof c.slug === "string" && /^[a-z0-9_-]{1,100}$/.test(c.slug) && typeof c.name === "string"; });
            if (!banners.length) return;
            body.appendChild(h("section", { className: "tv-rail" }, [
              h("h2", { text: row.name }),
              scroller(h("div", { className: "tv-rail-track tv-scroll-x" }, map(banners, function (c) {
                return h("button", { type: "button", className: "tv-f tv-collection", onclick: function () { push(collectionScreen(c)); } }, [
                  h("strong", { text: c.name }),
                  c.total_items ? h("span", { text: c.total_items + " titulů" }) : null
                ]);
              })))
            ]));
            shown++;
            return;
          }
          var items = filter(map(row.items || [], titleOf), Boolean);
          if (!items.length) return;
          body.appendChild(rail(row.name, row.kind === "top10" ? items.slice(0, 10) : items));
          shown++;
        });
        setStatus(status, shown ? "" : "Domů zatím nemá žádné řady.", shown ? null : "info");
        autoFocus(s, body);
      });
    }
    s = makeScreen("home", [
      header(profile ? profile.name : "", [
        button("Hledat", function () { push(searchScreen()); }),
        button("Změnit profil", function () { resetTo(profilesScreen()); }),
        button("Odhlásit se", doLogout)
      ]),
      status,
      body
    ], { onShow: function () { if (!body.firstChild) load(); } });
    return s;
  }
  function collectionScreen(c) {
    var body = h("div");
    var status = statusBox("Načítám…");
    var s = makeScreen("collection", [header(c.name), status, body], {
      onShow: function () {
        if (body.firstChild) return;
        api("home" + query({ collection: c.slug, page: 1 }), {}, function (err, data) {
          if (err) { setStatus(status, err.message, "error"); return; }
          var items = [];
          each((data && data.sections) || [], function (row) { items = items.concat(filter(map(row.items || [], titleOf), Boolean)); });
          setStatus(status, items.length ? "" : "Kolekce je prázdná.", items.length ? null : "info");
          body.appendChild(grid(items));
          autoFocus(s, body);
        });
      }
    });
    return s;
  }

  // ---------- hledání ----------
  // History contains bounded terms only, partitioned by trusted environment,
  // account and selected profile. Unknown environment disables persistence.
  function exactTitleKey(value) {
    if (typeof value !== "string") return "";
    return plain(value).replace(/[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\u2000-\u206f\u3000-\u303f]+/g, " ").replace(/^ +| +$/g, "");
  }
  function exactSearchGroups(rawItems, term, offset) {
    var key = exactTitleKey(term), exact = [], related = [], seen = {};
    each(arrayList(rawItems), function (raw, i) {
      var title = titleOf(raw);
      if (!title || seen["$" + title.id]) return;
      seen["$" + title.id] = true;
      var entry = { title: title, position: offset + i + 1 };
      if (key && (exactTitleKey(title.title) === key || exactTitleKey(title.original_title) === key)) exact.push(entry);
      else related.push(entry);
    });
    return { exact: exact, related: related };
  }
  function searchScope() { return account && profile ? account.id + ":" + profile.id + ":" + searchEnvironment : ""; }
  function searchOwner() {
    return account && isId(account.id) && profile && isId(profile.id) && searchEnvironment
      ? searchEnvironment + ":" + account.id + ":" + profile.id : "";
  }
  function historyTerms(owner) {
    if (!owner) return [];
    try {
      var values = JSON.parse(localStorage.getItem("movly.searchHistory.v2." + owner) || "[]");
      if (Object.prototype.toString.call(values) !== "[object Array]") return [];
      return filter(values, function (v) { return typeof v === "string" && v.length <= 200 && /\S/.test(v); }).slice(0, 20);
    } catch (e) { return []; }
  }
  function storeTerms(owner, terms) {
    if (!owner || owner !== searchOwner()) return;
    try { localStorage.setItem("movly.searchHistory.v2." + owner, JSON.stringify(terms.slice(0, 20))); } catch (e) { /* storage unavailable */ }
  }
  function rememberTerm(owner, value) {
    var term = value.replace(/^\s+|\s+$/g, "").slice(0, 200);
    if (term) storeTerms(owner, [term].concat(filter(historyTerms(owner), function (v) { return v.toLowerCase() !== term.toLowerCase(); })));
  }
  function filterQuery(definition) {
    var out = {}, listKeys = { audio_languages: "audio_language", subtitle_languages: "subtitle_language", original_languages: "original_language" };
    for (var k in definition) if (Object.prototype.hasOwnProperty.call(definition, k)) {
      var v = definition[k];
      if (v === "" || v === null || v === undefined || v === false) continue;
      if (Object.prototype.toString.call(v) === "[object Array]") { if (v.length) out[listKeys[k] || k] = v.join(","); }
      else out[k] = v;
    }
    return out;
  }
  function verifySearchScope(screen, scope, done) {
    screen.el.hidden = true;
    api("session", { quiet: true }, function (err, data) {
      if (current() !== screen) return;
      var environment = data && /^[a-f0-9]{32}$/.test(data.environment || "") ? data.environment : "";
      var next = data && data.account && data.profile ? data.account.id + ":" + data.profile.id + ":" + environment : "";
      if (err || next !== scope) { boot(); return; }
      screen.el.hidden = false;
      if (done) done();
    });
  }
  function searchScreen() {
    var owner = searchOwner(), scope = searchScope(), alive = true, revision = 0, suggestRevision = 0, policyRevision = "", policyGeneration = 0, discoveryAllowed = false, discoveryError = false;
    var input = h("input", { type: "search", maxlength: 200, className: "tv-f tv-input tv-autofocus", autocomplete: "off", "aria-label": "Hledat název nebo výraz", placeholder: "Název filmu, seriálu nebo popis", role: "combobox", "aria-expanded": "false", "aria-controls": "tv-search-suggestions" });
    var suggestions = h("div", { id: "tv-search-suggestions", role: "listbox", "aria-label": "Návrhy hledání" });
    var status = statusBox("Napiš název a potvrď Hledat.", "info"), results = h("div"), idle = h("div"), activeFilters = h("p", { className: "tv-hint" });
    var suggestTimer = null, suggestionRequest = null, activeRequest = null, definition = {}, page = 1, natural = false, committedQuery = null, lastResult = null, pendingResultFocus = false, s;
    function valid() { return alive && scope === searchScope(); }
    function active() { return valid() && current() === s && !s.el.hidden; }
    function searchAction(label, action, className) {
      var control = button(label, function () { if (active() && s.el.contains(control)) action.call(control); }, className);
      return control;
    }
    function cancelSuggestions() {
      suggestRevision++; clearTimeout(suggestTimer);
      if (suggestionRequest) { suggestionRequest.abort(); suggestionRequest = null; }
      clear(suggestions); input.setAttribute("aria-expanded", "false");
    }
    function termButton(term) { return searchAction(term, function () { input.value = term; page = 1; natural = false; commitSearch(); }); }
    function renderHistory() {
      clear(idle);
      if (input.value.replace(/\s/g, "")) return;
      var history = h("div", { className: "tv-search-history" }), terms = historyTerms(owner);
      history.appendChild(h("h2", { text: "Poslední hledání" }));
      each(terms, function (term) {
        history.appendChild(h("div", { className: "tv-search-term" }, [termButton(term), searchAction("Odebrat „" + term + "“", function () {
          storeTerms(owner, filter(historyTerms(owner), function (v) { return v !== term; })); renderHistory(); focusEl(firstFocusable(idle));
        })]));
      });
      if (!terms.length) history.appendChild(h("p", { text: "Zatím tu žádná hledání nejsou." }));
      else history.appendChild(searchAction("Vymazat historii", function () { storeTerms(owner, []); renderHistory(); focusEl(firstFocusable(s.el)); }));
      idle.appendChild(history);
      var discoveries = h("div"); idle.appendChild(discoveries);
      if (!discoveryAllowed) { if (discoveryError) discoveries.appendChild(searchAction("Obnovit pravidla a návrhy", function () { s.onShow(); })); return; }
      var mine = revision, policy = policyRevision;
      function unchanged() { return valid() && mine === revision && policy === policyRevision && !input.value.replace(/\s/g, ""); }
      api("trending-searches?limit=10", {}, function (err, data) {
        if (!unchanged()) return;
        var section = h("div", {}, [h("h2", { text: "Populární hledání" })]);
        if (err) section.appendChild(searchAction("Populární hledání: zkusit znovu", renderHistory));
        else each(arrayList(data && data.trending_searches).slice(0, 10), function (v) {
          if (v && typeof v.query === "string" && v.query.length <= 100 && v.search_count > 0) section.appendChild(termButton(v.query));
        });
        discoveries.appendChild(section);
      });
      api("popular-titles-search?limit=10", {}, function (err, data) {
        if (!unchanged()) return;
        var section = h("div", {}, [h("h2", { text: "Nejčastěji vybírané tituly" })]);
        if (err) section.appendChild(searchAction("Populární tituly: zkusit znovu", renderHistory));
        else each(arrayList(data && data.popular_titles).slice(0, 10), function (v) {
          if (!v || !isId(v.title_id) || v.interaction_count <= 0 || typeof v.title !== "string") return;
          // No unrestricted title data/poster hydration: the discovery API is policy-scoped.
          section.appendChild(searchAction(v.title, function () { openDetail({ id: v.title_id, title: v.title, type: v.type }); }));
        });
        discoveries.appendChild(section);
      });
    }
    function suggest() {
      if (!active()) return;
      cancelSuggestions();
      var q = input.value.replace(/^\s+|\s+$/g, "");
      if (!valid() || !discoveryAllowed || !q || q.length > 100) return;
      var mine = suggestRevision, policy = policyRevision;
      suggestionRequest = api("autocomplete" + query({ q: q, limit: 8 }), {}, function (err, data) {
        if (!valid() || mine !== suggestRevision || policy !== policyRevision || input.value.replace(/^\s+|\s+$/g, "") !== q) return;
        if (err) {
          var retry = searchAction("Zkusit návrhy znovu", suggest); retry.setAttribute("role", "option"); suggestions.appendChild(retry);
          input.setAttribute("aria-expanded", "true"); return;
        }
        each(arrayList(data && data.suggestions).slice(0, 8), function (term) {
          if (typeof term !== "string" || !term || term.length > 100) return;
          var choice = termButton(term); choice.setAttribute("role", "option"); suggestions.appendChild(choice);
        });
        input.setAttribute("aria-expanded", suggestions.firstChild ? "true" : "false");
      });
    }
    function renderResults(data, focus, searchText, resultOffset, generation) {
      lastResult = { data: data, text: searchText, offset: resultOffset, policy: policyRevision };
      var items = filter(map((data && data.results) || [], titleOf), Boolean);
      clear(results);
      setStatus(status, items.length ? "Nalezeno: " + (typeof data.total === "number" ? data.total : items.length) : "Nic jsme nenašli.", items.length ? null : "info");
      if (data.degraded || (data.warnings && data.warnings.length) || (data.degraded_sources && data.degraded_sources.length)) results.appendChild(statusBox("Některé zdroje výsledků nejsou dostupné. Výsledky mohou být neúplné.", "info"));
      if (data.parsed && data.parsed.matched) results.appendChild(statusBox("Rozpoznané filtry: " + filterDescription(data.parsed), "info"));
      var renderedRevision = generation, renderedQuery = searchText;
      var grouped = exactSearchGroups(data.results, renderedQuery, resultOffset);
      function section(entries, heading, className) {
        if (!entries.length) return;
        var cards = h("div", { className: "tv-grid" }), section = h("section", { className: className }, [h("h2", { text: heading }), cards]);
        each(entries, function (entry) {
          var title = entry.title, card = posterCard(title, function () {
            if (!active() || renderedRevision !== revision || !s.el.contains(card)) return;
            if (renderedQuery) api("track-search", { method: "POST", body: { query: renderedQuery, title_id: title.id, interaction_type: "click", position_in_results: entry.position } }, function () {});
            openDetail(title);
          });
          cards.appendChild(card);
        });
        results.appendChild(section);
      }
      section(grouped.exact, "Přesná shoda názvu", "tv-search-exact");
      section(grouped.related, grouped.exact.length ? "Další výsledky" : "Výsledky", "tv-search-related");
      var pages = h("div", { className: "tv-search-actions" });
      if (page > 1) pages.appendChild(searchAction("Předchozí stránka", function () { page--; run(false); }));
      if (data.total > page * 30 || data.total_pages > page) pages.appendChild(searchAction("Další stránka", function () { page++; run(false); }));
      results.appendChild(pages);
      if (focus && current() === s) focusEl(firstFocusable(results) || input);
    }
    function commitSearch() {
      if (!active()) return;
      committedQuery = input.value.replace(/^\s+|\s+$/g, "");
      run(true);
    }
    function run(focus) {
      if (!active() || committedQuery === null || input.value.replace(/^\s+|\s+$/g, "") !== committedQuery) return;
      if (focus) cancelSuggestions();
      var q = committedQuery, params = filterQuery(definition), mine = ++revision, resultOffset = (page - 1) * 30;
      lastResult = null; clear(results); clear(idle);
      if (!q && !Object.keys(params).length) { setStatus(status, "Napiš název nebo nastav filtry.", "info"); renderHistory(); return; }
      if (q.length > 200) return;
      if (q && focus) rememberTerm(owner, q);
      setStatus(status, "Hledám…");
      if (activeRequest) activeRequest.abort();
      var filtered = Object.keys(params).length > 0;
      params.limit = 30; params.page = page;
      if (q) params.q = q;
      var path = natural && q ? "search/filters" : filtered ? "titles/filter" : "search";
      if (path === "search") { params.type = "both"; params.offset = (page - 1) * 30; delete params.page; }
      if (path === "search/filters") params = { q: q, page: page, limit: 30 };
      function done(err, data) {
        if (!valid() || mine !== revision) return;
        if (err) { setStatus(status, err.message, "error"); results.appendChild(searchAction("Zkusit znovu", function () { if (mine === revision) run(focus); })); return; }
        if (path === "search/filters" && data && data.parsed && data.parsed.matched === false) {
          activeRequest = api("search" + query({ q: q, type: "both", limit: 30, offset: (page - 1) * 30 }), {}, function (fallbackError, fallback) {
            if (!valid() || mine !== revision) return;
            if (fallbackError) { setStatus(status, fallbackError.message, "error"); results.appendChild(searchAction("Zkusit znovu", function () { if (mine === revision) run(focus); })); return; }
            renderResults(fallback || {}, focus, q, resultOffset, mine);
          });
          return;
        }
        renderResults(data || {}, focus, q, resultOffset, mine);
      }
      activeRequest = api(path + query(params), {}, done);
    }
    input.addEventListener("input", function () {
      if (!active()) return;
      revision++; cancelSuggestions(); committedQuery = null; lastResult = null; page = 1; natural = false;
      if (activeRequest) { activeRequest.abort(); activeRequest = null; }
      clear(results); clear(idle);
      if (!input.value.replace(/\s/g, "")) { clear(results); setStatus(status, "Napiš název nebo nastav filtry.", "info"); renderHistory(); return; }
      setStatus(status, "Potvrď Hledat nebo vyber návrh.", "info");
      suggestTimer = setTimeout(suggest, 250);
    }, false);
    var form = h("form", { className: "tv-form tv-search-form", novalidate: true, role: "search" }, [input, suggestions,
      h("div", { className: "tv-search-actions" }, [searchAction("Hledat", function () { page = 1; natural = false; commitSearch(); }), searchAction("Rozpoznat filtry z textu", function () { page = 1; natural = true; commitSearch(); }), searchAction("Filtry a uložené filtry", function () {
        cancelSuggestions(); revision++;
        push(searchFilterScreen(definition, function (next) { definition = next; natural = false; page = 1; activeFilters.textContent = Object.keys(next).length ? "Použité filtry: " + filterDescription(next) : ""; pendingResultFocus = true; back(); }));
      }), searchAction("Zrušit filtry", function () { definition = {}; activeFilters.textContent = ""; page = 1; commitSearch(); })])]);
    form.onsubmit = function (event) { event.preventDefault(); page = 1; natural = false; commitSearch(); };
    s = makeScreen("search", [header("Hledat"), form, activeFilters, status, idle, results], {
      onShow: function () {
        if (!valid()) return;
        var policyMine = ++policyGeneration;
        revision++; clear(results); clear(idle);
        discoveryAllowed = false; cancelSuggestions();
        api("profiles/effective-content-policy", {}, function (err, policy) {
          if (!valid() || policyMine !== policyGeneration || current() !== s) return;
          var revisionValue = !err && policy && policy.revision || "";
          if (policyRevision && revisionValue !== policyRevision) { revision++; clear(results); clear(idle); }
          policyRevision = revisionValue;
          discoveryError = !!err || !policy || policy.user_id !== account.id || policy.profile_id !== profile.id || typeof policy.is_kids !== "boolean";
          discoveryAllowed = !err && policy && policy.schema_version === 1 && policy.user_id === account.id && policy.profile_id === profile.id && policy.is_kids === false && policy.age_controls_active === false && /^ep1\.[a-f0-9]{64}$/.test(policy.revision || "");
          renderHistory();
          if (pendingResultFocus) { pendingResultFocus = false; commitSearch(); }
          else if (lastResult && lastResult.policy === policyRevision && lastResult.text === committedQuery) renderResults(lastResult.data, false, lastResult.text, lastResult.offset, revision);
          else if (committedQuery !== null) setStatus(status, "Potvrď Hledat pro obnovení výsledků.", "info");
        });
        renderHistory();
      },
      onBlur: function () { policyGeneration++; discoveryAllowed = false; revision++; cancelSuggestions(); s.el.hidden = true; },
      onFocus: function () { verifySearchScope(s, scope, function () { s.onShow(); }); },
      onKey: function (event) {
        if (event.keyCode === KEY.ESC && suggestions.firstChild) { cancelSuggestions(); focusEl(input); return true; }
        if (event.target === input && event.keyCode === KEY.DOWN && suggestions.firstChild) { focusEl(firstFocusable(suggestions)); return true; }
        if (suggestions.contains(event.target) && event.keyCode === KEY.UP && event.target === firstFocusable(suggestions)) { focusEl(input); return true; }
        return false;
      },
      onDestroy: function () { alive = false; policyGeneration++; revision++; cancelSuggestions(); if (activeRequest) activeRequest.abort(); }
    });
    return s;
  }

  function filterDescription(definition) {
    var labels = { type: "Typ", genre_ids: "Žánry", genre_names: "Žánry", genre_match: "Shoda žánrů", year_from: "Rok od", year_to: "Rok do", rating_from: "Hodnocení od", rating_to: "Hodnocení do", runtime_from: "Délka od (min)", runtime_to: "Délka do (min)", video_height_min: "Kvalita", hdr: "HDR", has_streams: "Dostupné zdroje", audio_languages: "Audio", audio_language: "Audio", subtitle_languages: "Titulky", subtitle_language: "Titulky", original_languages: "Původní jazyk", original_language: "Původní jazyk", countries: "Země", sort_by: "Řazení", sort_order: "Směr", text: "Název" };
    var values = { movie: "Filmy", tv: "Seriály", all: "Všechny", any: "Libovolný", asc: "Vzestupně", desc: "Sestupně", popularity: "Popularita", rating: "Hodnocení", year: "Rok", title: "Název", runtime: "Délka", vote_count: "Počet hodnocení" }, out = [];
    for (var key in definition) if (Object.prototype.hasOwnProperty.call(definition, key) && labels[key]) {
      var value = definition[key];
      if (value === null || value === undefined || value === false || value === "") continue;
      if (key === "genre_ids") { if (definition.genre_names) continue; value = value.length + " vybraných"; }
      else if (Object.prototype.toString.call(value) === "[object Array]") { if (!value.length) continue; value = value.join(", "); }
      else if (value === true) value = "Ano";
      else value = values[value] || String(value);
      out.push(labels[key] + ": " + value);
    }
    return out.join(" · ");
  }
  function searchFilterScreen(initial, apply) {
    var owner = searchOwner(), scope = searchScope(), alive = true, fields = {}, stored = [], selectedID = null, savedGeneration = 0, genreGeneration = 0, facetGeneration = 0, s;
    var status = statusBox(""), controls = h("div", { className: "tv-search-filter-fields" }), saved = h("div"), facetHints = h("div"), genreChoices = h("div", { className: "tv-filter-facets" });
    var name = h("input", { type: "text", maxlength: 60, className: "tv-f tv-input", "aria-label": "Název uloženého filtru" });
    function valid() { return alive && scope === searchScope(); }
    function active() { return valid() && current() === s && !s.el.hidden; }
    function filterAction(label, action, className) {
      var control = button(label, function () { if (active() && s.el.contains(control)) action.call(control); }, className);
      return control;
    }
    function row(label, input) { controls.appendChild(h(input.tagName === "BUTTON" ? "div" : "label", { className: "tv-filter-field" }, input.tagName === "BUTTON" ? [input] : [h("span", { text: label }), input])); }
    function field(key, label, kind, max) {
      var input = h("input", { type: kind || "text", className: "tv-f tv-input", maxlength: max || 200, "aria-label": label });
      if (kind === "number") input.setAttribute("step", key.indexOf("rating_") === 0 ? "0.1" : "1");
      fields[key] = input; row(label, input);
    }
    function cycle(key, label, options) {
      var control = filterAction(label, function () {
        var at = 0; each(options, function (o, i) { if (o[0] === control.value) at = i; });
        control.value = options[(at + 1) % options.length][0]; control.refresh();
      });
      control.value = "";
      control.refresh = function () { var text = control.value; each(options, function (o) { if (o[0] === control.value) text = o[1]; }); control.textContent = label + ": " + (text || "Libovolné"); };
      fields[key] = control; row(label, control);
    }
    cycle("type", "Typ", [["", "Vše"], ["movie", "Filmy"], ["tv", "Seriály"]]);
    fields.genre_ids = h("input", { type: "hidden" });
    controls.appendChild(h("h2", { text: "Žánry" })); controls.appendChild(genreChoices);
    cycle("genre_match", "Shoda žánrů", [["any", "Libovolný"], ["all", "Všechny"]]);
    each([["year_from", "Rok od"], ["year_to", "Rok do"], ["rating_from", "Hodnocení od (0–10)"], ["rating_to", "Hodnocení do (0–10)"], ["runtime_from", "Délka od (min)"], ["runtime_to", "Délka do (min)"]], function (entry) { field(entry[0], entry[1], "number"); });
    cycle("video_height_min", "Kvalita", [["", "Libovolná"], ["720", "HD"], ["1080", "Full HD"], ["2160", "4K"]]);
    cycle("hdr", "HDR", [["", "Libovolné"], ["true", "Ano"]]);
    cycle("has_streams", "Dostupné zdroje", [["", "Vše"], ["true", "Jen dostupné"]]);
    each([["audio_languages", "Audio"], ["subtitle_languages", "Titulky"], ["original_languages", "Původní jazyk"], ["countries", "Země"]], function (entry) { field(entry[0], entry[1] + " (kódy oddělené čárkou)"); });
    controls.appendChild(facetHints);
    cycle("sort_by", "Řazení", [["popularity", "Popularita"], ["title", "Název"], ["year", "Rok"], ["rating", "Hodnocení"], ["runtime", "Délka"], ["vote_count", "Počet hodnocení"]]);
    cycle("sort_order", "Směr", [["desc", "Sestupně"], ["asc", "Vzestupně"]]);
    function refreshChoices() {
      each(controls.querySelectorAll(".tv-filter-choice"), function (choice) {
        var key = choice.getAttribute("data-filter-key"), code = choice.getAttribute("data-filter-code");
        choice.setAttribute("aria-pressed", contains(fields[key].value.split(","), code) ? "true" : "false");
      });
    }
    function facetChoice(key, code, label) {
      var choice = filterAction(label, function () {
        var values = fields[key].value ? fields[key].value.split(",") : [];
        fields[key].value = (contains(values, code) ? filter(values, function (v) { return v !== code; }) : values.concat([code])).join(",");
        refreshChoices();
      }, "tv-filter-choice");
      choice.setAttribute("data-filter-key", key); choice.setAttribute("data-filter-code", code);
      choice.setAttribute("aria-pressed", contains(fields[key].value.split(","), code) ? "true" : "false");
      return choice;
    }
    function fill(definition) {
      each(Object.keys(fields), function (key) {
        var value = definition[key];
        if (key === "audio_languages" && !value) value = definition.audio_language;
        if (key === "original_languages" && !value) value = definition.original_language;
        fields[key].value = value === undefined || value === null || value === false ? "" : Object.prototype.toString.call(value) === "[object Array]" ? value.join(",") : String(value);
        if (fields[key].refresh) fields[key].refresh();
      });
      refreshChoices();
    }
    function read() {
      var out = {};
      each(Object.keys(fields), function (key) {
        var raw = fields[key].value.replace(/^\s+|\s+$/g, "");
        if (!raw) return;
        if (key === "hdr" || key === "has_streams") { out[key] = raw === "true"; return; }
        if (key === "genre_ids" || /_languages$/.test(key) || key === "countries") {
          var parts = raw.split(","), values = [];
          if (parts.length > 30) throw new Error("Vyber nejvýše 30 hodnot v jednom poli.");
          each(parts, function (part) {
            part = part.replace(/^\s+|\s+$/g, "");
            if (key === "genre_ids") { if (!/^[1-9]\d*$/.test(part)) throw new Error("Žánr musí mít platný číselný kód."); part = Number(part); }
            else { if (!(key === "countries" ? /^[a-z]{2}$/i : /^[a-z]{2,3}$/i).test(part)) throw new Error("Použij platné kódy jazyků a zemí."); part = key === "countries" ? part.toUpperCase() : part.toLowerCase(); }
            if (!contains(values, part)) values.push(part);
          }); out[key] = values; return;
        }
        if (/^(year_|rating_|runtime_|video_height)/.test(key)) {
          var value = Number(raw), low = key.indexOf("year_") === 0 ? 1800 : 0, high = key.indexOf("year_") === 0 ? 2100 : key.indexOf("rating_") === 0 ? 10 : 10000;
          if (!isFinite(value) || value < low || value > high) throw new Error("Zkontroluj číselné rozsahy filtru.");
          out[key] = value; return;
        }
        out[key] = raw;
      });
      each(["year", "rating", "runtime"], function (key) { if (out[key + "_from"] !== undefined && out[key + "_to"] !== undefined && out[key + "_from"] > out[key + "_to"]) throw new Error("Dolní mez nesmí být vyšší než horní."); });
      return out;
    }
    function choose(item) { selectedID = item.id; name.value = item.name; fill(item.filter || {}); setStatus(status, "Vybraný filtr: " + item.name, "info"); focusEl(firstFocusable(controls)); }
    function loadSaved() {
      var mine = ++savedGeneration;
      api("saved-filters", {}, function (err, data) {
        if (!valid() || mine !== savedGeneration) return; clear(saved);
        saved.appendChild(h("h2", { text: "Uložené filtry" }));
        if (err) { saved.appendChild(filterAction("Uložené filtry: zkusit znovu", loadSaved)); return; }
        stored = data && data.items || [];
        each(stored, function (item) {
          if (!item || !isId(item.id) || typeof item.name !== "string") return;
          saved.appendChild(h("div", { className: "tv-search-term" }, [filterAction(item.name, function () { choose(item); }), filterAction("Smazat filtr „" + item.name + "“", function () {
            api("saved-filters/" + item.id, { method: "DELETE" }, function (error) { if (!valid()) return; if (error) setStatus(status, error.message, "error"); else { if (selectedID === item.id) selectedID = null; loadSaved(); setStatus(status, "Filtr byl smazán.", "info"); } });
          })]));
        });
        if (!stored.length) saved.appendChild(h("p", { text: "Zatím nemáš žádné uložené filtry." }));
      });
    }
    function save(update) {
      if (!active()) return;
      var definition; try { definition = read(); } catch (e) { setStatus(status, e.message, "error"); return; }
      var value = name.value.replace(/^\s+|\s+$/g, "");
      if (!value || value.length > 60) { setStatus(status, "Pojmenuj filtr (nejvýše 60 znaků).", "error"); focusEl(name); return; }
      if (update && !selectedID) { setStatus(status, "Nejdřív vyber uložený filtr.", "error"); return; }
      api("saved-filters" + (update ? "/" + selectedID : ""), { method: update ? "PUT" : "POST", body: { name: value, filter: definition } }, function (err) { if (!valid()) return; setStatus(status, err ? err.message : "Filtr byl uložen.", err ? "error" : "info"); if (!err) loadSaved(); });
    }
    each(["audio_languages", "subtitle_languages", "original_languages", "countries"], function (key) { fields[key].addEventListener("input", refreshChoices, false); });
    fill(initial);
    s = makeScreen("search-filters", [header("Filtry hledání"), status, saved, controls, name, h("div", { className: "tv-search-actions" }, [
      filterAction("Použít filtry", function () { if (!valid()) return; try { apply(read()); } catch (e) { setStatus(status, e.message, "error"); } }),
      filterAction("Uložit jako nový filtr", function () { save(false); }), filterAction("Upravit vybraný filtr", function () { save(true); }),
      filterAction("Vyčistit formulář", function () { selectedID = null; name.value = ""; fill({}); })
    ])], { onBlur: function () { facetGeneration++; genreGeneration++; s.el.hidden = true; }, onFocus: function () { verifySearchScope(s, scope, function () { loadFacets(); loadGenres(); }); }, onDestroy: function () { alive = false; } });
    loadSaved();
    function loadGenres() {
    var mine = ++genreGeneration;
    clear(genreChoices);
    api("titles/genres", {}, function (err, data) {
      if (!valid() || mine !== genreGeneration) return;
      if (err) { genreChoices.appendChild(filterAction("Žánry: zkusit znovu", loadGenres)); return; }
      each(arrayList(data && data.genres || data).slice(0, 60), function (genre) {
        if (!genre || !isId(genre.id)) return;
        genreChoices.appendChild(facetChoice("genre_ids", String(genre.id), genre.name_cs || genre.name || String(genre.id)));
      });
    });
    }
    function loadFacets() {
    var mine = ++facetGeneration;
    clear(facetHints);
    api("titles/filter/facets", {}, function (err, facets) {
      if (!valid() || mine !== facetGeneration) return;
      if (err || !facets || facets.policy_scoped !== true) { facetHints.appendChild(filterAction("Nabídka jazyků: zkusit znovu", loadFacets)); return; }
      each(["audio_languages", "subtitle_languages", "original_languages", "countries"], function (key) {
        var group = h("div", { className: "tv-filter-facets" }, [h("h3", { text: fields[key].getAttribute("aria-label") })]);
        each(arrayList(facets && facets[key]).slice(0, 60), function (facet) {
          if (!facet || typeof facet.code !== "string" || !(key === "countries" ? /^[A-Z]{2}$/ : /^[a-z]{2,3}$/).test(facet.code)) return;
          group.appendChild(facetChoice(key, facet.code, facet.label || facet.code));
        }); facetHints.appendChild(group);
      });
    });
    }
    loadGenres(); loadFacets();
    return s;
  }

  // ---------- detail titulu ----------
  function openDetail(t) { push(detailScreen(t)); }
  function released(episode) {
    var d = episode && episode.air_date;
    if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(d)) return true;
    var now = new Date(), today = now.getUTCFullYear() + "-" + pad(now.getUTCMonth() + 1) + "-" + pad(now.getUTCDate());
    return d.slice(0, 10) <= today;
  }
  function detailScreen(t) {
    var body = h("div", { className: "tv-detail" });
    var status = statusBox("Načítám detail…");
    var s;
    function render(data) {
      clear(body);
      var meta = filter([
        data.year || (typeof data.release_date === "string" ? data.release_date.slice(0, 4) : null),
        data.runtime ? data.runtime + " min" : null,
        map(filter(data.genres || [], function (g) { return g && typeof g.name === "string"; }), function (g) { return g.name; }).slice(0, 3).join(", ") || null,
        data.type === "tv" ? "Seriál" : "Film"
      ], Boolean).join(" · ");
      var ratings = map(filter(data.ratings || [], function (r) { return r && r.source && typeof r.rating === "number"; }), function (r) { return r.source + " " + r.rating + " %"; }).join(" · ");
      var src = imageURL(data.poster_path, "w342");
      var wp = data.watch_progress || data.watch_history;
      var actions = h("div", { className: "tv-actions" });
      var info = h("div", { className: "tv-detail-info" }, [
        h("h1", { className: "tv-detail-title", text: data.title }),
        data.original_title && data.original_title !== data.title ? h("p", { className: "tv-muted", text: data.original_title }) : null,
        meta ? h("p", { className: "tv-meta", text: meta }) : null,
        ratings ? h("p", { className: "tv-meta", text: ratings }) : null,
        data.overview ? h("p", { className: "tv-overview", text: data.overview }) : null,
        actions
      ]);
      body.appendChild(h("div", { className: "tv-detail-top" }, [
        src ? h("img", { className: "tv-detail-poster", src: src, alt: "" }) : null,
        info
      ]));
      if (data.type !== "tv") {
        var resume = wp && wp.watch_status !== "completed" && wp.progress_seconds > 5 ? " (od " + clock(wp.progress_seconds) + ")" : "";
        actions.appendChild(button("Přehrát" + resume, function () { push(sourcesScreen(data, null, true)); }, "tv-primary tv-autofocus"));
        actions.appendChild(button("Vybrat zdroj", function () { push(sourcesScreen(data, null, false)); }));
      } else {
        actions.appendChild(statusBox("Vyber řadu a epizodu níže.", "info"));
        loadSeasons(data);
      }
      if (data.type !== "tv") autoFocus(s, body);
    }
    function loadSeasons(data) {
      var has = false;
      each(data.seasons || [], function (x) { if (x && x.episodes && x.episodes.length !== undefined) has = true; });
      if (has) { renderSeasons(data, data.seasons); return; }
      api("titles/" + data.id + "/seasons", {}, function (err, result) {
        if (err) { body.appendChild(statusBox(err.message, "error")); return; }
        renderSeasons(data, (result && result.seasons) || []);
      });
    }
    function renderSeasons(data, seasons) {
      // Pouze běžné řady a epizody (bez speciálů s číslem 0).
      seasons = filter(seasons, function (x) { return x && x.season_number > 0; });
      seasons.sort(function (a, b) { return a.season_number - b.season_number; });
      if (!seasons.length) { body.appendChild(statusBox("Seriál zatím nemá žádné epizody.", "info")); return; }
      var wp = data.watch_progress;
      var selected = seasons[0];
      each(seasons, function (x) { if (wp && wp.season_number === x.season_number) selected = x; });
      var tabs = h("div", { className: "tv-season-tabs tv-scroll-x" });
      var episodes = h("div", { className: "tv-episodes" });
      var tabButtons = [];
      function pick(season, focusFirst) {
        selected = season;
        each(tabButtons, function (b) { b.btn.className = "tv-f tv-button tv-season" + (b.season === season ? " tv-selected" : ""); });
        clear(episodes);
        var list = filter(season.episodes || [], function (e) { return e && isId(e.id) && e.episode_number > 0; });
        list.sort(function (a, b) { return a.episode_number - b.episode_number; });
        if (!list.length) episodes.appendChild(statusBox("Řada nemá žádné epizody.", "info"));
        each(list, function (e) {
          var episode = { id: e.id, season_number: season.season_number, episode_number: e.episode_number, name: e.name, runtime: e.runtime, air_date: e.air_date };
          var ok = released(e);
          var progress = e.watch_history || e.watch_progress;
          var note = !ok ? "Premiéra " + e.air_date.slice(0, 10)
            : progress && progress.watch_status === "completed" ? "Viděno"
            : progress && progress.progress_seconds > 5 ? "Rozkoukáno " + clock(progress.progress_seconds) : "";
          var btn = h("button", { type: "button", className: "tv-f tv-episode", disabled: !ok, onclick: function () { push(sourcesScreen(data, episode, true)); } }, [
            h("strong", { text: "S" + pad(season.season_number) + "E" + pad(e.episode_number) + " · " + (e.name || "Epizoda " + e.episode_number) }),
            note ? h("span", { className: "tv-muted", text: note }) : null
          ]);
          episodes.appendChild(btn);
        });
        if (focusFirst) { var f = firstFocusable(episodes); if (f) focusEl(f); }
      }
      each(seasons, function (season) {
        var btn = button(season.name || "Řada " + season.season_number, function () { pick(season, true); }, "tv-season");
        tabButtons.push({ btn: btn, season: season });
        tabs.appendChild(btn);
      });
      body.appendChild(h("section", { className: "tv-seasons" }, [h("h2", { text: "Řady a epizody" }), scroller(tabs), episodes]));
      pick(selected, false);
      autoFocus(s, firstFocusable(episodes) ? episodes : tabs);
    }
    s = makeScreen("detail", [header(t.title), status, body], {
      onShow: function () {
        if (body.firstChild) return;
        api("titles/" + t.id, {}, function (err, data) {
          if (err) { setStatus(status, err.message, "error"); body.appendChild(button("Zkusit znovu", function () { clear(body); s.onShow(); }, "tv-autofocus")); focusEl(firstFocusable(s.el), true); return; }
          if (!data || !isId(data.id)) { setStatus(status, "API vrátilo neplatný titul.", "error"); return; }
          setStatus(status, "");
          render(data);
        });
      }
    });
    return s;
  }

  // ---------- zdroje ----------
  // Shodné s player.js: podporovaní poskytovatelé a účty, které musí být připojené.
  var SUPPORTED = /^(?:webshare|hellspy|fastshare|sosac|streamuj|sktorrent|sledujteto|crwiki|ceskawiki|prehrajto|stremio|bombuj|voe|mixdrop|streamtape|doodstream|streamwish|vidhide|lulustream|ct|ceskatelevize|stvr)$/;
  function providerKey(name) { return plain(name).replace(/[ ._-]/g, ""); }
  function rank(s) { var v = s.video_height || 0; return v >= 4320 ? 5 : v >= 2160 ? 4 : v >= 1440 ? 3 : v >= 1080 ? 2 : v >= 720 ? 1 : 0; }
  function words(value) { return plain(value).replace(/[^a-z0-9]+/g, " ").replace(/^\s+|\s+$/g, ""); }
  // Stejná kontrola identity jako stream-recommendations.js (název, rok, SxxEyy).
  function identityMatches(s, t, episode) {
    var name = words(s.file_name);
    var names = filter([words(t.title), words(t.original_title)], Boolean);
    var ok = false;
    each(names, function (n) { if (name === n || name.indexOf(n + " ") === 0) ok = true; });
    if (!ok) return false;
    if (episode) {
      var m = /(?:^|[^a-z0-9])s(\d{1,2})[ ._-]*e(\d{1,3})(?!\d)|(?:^|[^a-z0-9])(\d{1,2})x(\d{1,3})(?!\d)/i.exec(s.file_name || "");
      return Boolean(m && Number(m[1] || m[3]) === episode.season_number && Number(m[2] || m[4]) === episode.episode_number);
    }
    var year = t.year || Number(String(t.release_date || "").slice(0, 4)) || null;
    var years = String(s.file_name || "").match(/\b(?:19|20)\d{2}\b/g) || [];
    return !year || !years.length || contains(years, String(year));
  }
  function displayCap() {
    var width = Math.max(window.screen.width || 0, window.screen.height || 0) * (window.devicePixelRatio || 1);
    // Starší TV dekódují spolehlivě nejvýše Full HD.
    return width >= 1920 ? 2 : width >= 1280 ? 1 : 0;
  }
  function sourcesScreen(t, episode, autoPlay) {
    var origins = ["Databáze", "Databáze AI", "Webshare · živé hledání", "Hellspy · živé hledání", "Další poskytovatelé a doplňky"];
    var statusList = h("div", { className: "tv-source-status" });
    var rows = map(origins, function (name) { var r = h("p", { className: "tv-muted", text: name + ": hledám…" }); statusList.appendChild(r); return r; });
    var bestBox = h("div", { className: "tv-actions" });
    var list = h("div", { className: "tv-sources" });
    var status = statusBox(autoPlay ? "Hledám nejlepší zdroj…" : "Hledám zdroje…");
    var connections = {}, results = [], pending = origins.length, alive = true, s;
    function ready(stream) {
      var key = providerKey(stream.provider_name || stream.provider_identifier || "");
      return contains(["webshare", "fastshare", "sosac", "stremio"], key) ? connections[key] === true : true;
    }
    function playable(stream) {
      return SUPPORTED.test(providerKey(stream.provider_name || stream.provider_identifier || "")) && stream.available !== false && ready(stream);
    }
    function selectionFor(stream) {
      var sel = { title_id: t.id };
      if (stream.origin >= 2) { sel.source = "live"; sel.ticket = stream.ticket; }
      else { sel.source = stream.origin ? "ai" : "human"; sel.stream_id = stream.id; }
      if (episode) sel.episode_id = episode.id;
      return sel;
    }
    function label(stream) {
      var langs = map(stream.audio_languages || (stream.audio_language ? [stream.audio_language] : []), function (l) { return String(l).toUpperCase(); });
      return filter([stream.provider_name || stream.provider_identifier || origins[stream.origin],
        stream.video_height >= 2160 ? "4K" : stream.video_height ? stream.video_height + "p" : null,
        stream.video_codec, stream.hdr_type, langs.join(", ") || null,
        stream.file_size ? (stream.file_size / 1073741824).toFixed(2) + " GB" : null], Boolean).join(" · ");
    }
    // „Podobné" (demoted verdikt relevance z resolveru) se automaticky nikdy nevybírají.
    function demoted(x) { return Boolean(x.relevance && x.relevance.bucket === "demoted"); }
    // Doporučení jako stream-recommendations.js; jinak nejvyšší kvalita jako automatické přehrání v player.js.
    function best() {
      var cap = displayCap();
      var recommended = window.MovlyTvScoring.recommended(results, {
        displayMaxRank: cap,
        runtimeMinutes: episode && episode.runtime || t.runtime,
        primaryLanguage: document.documentElement.lang || "cs",
        downlinkMbps: navigator.connection && navigator.connection.downlink
      }, playable, function (x) { return identityMatches(x, t, episode); });
      if (recommended) return recommended;
      var options = filter(results, function (x) { return !demoted(x) && playable(x) && rank(x) <= cap; });
      if (!options.length) options = filter(results, function (x) { return !demoted(x) && playable(x); });
      options.sort(function (a, b) { return (b.video_height || 0) - (a.video_height || 0); });
      return options[0] || null;
    }
    function play(stream) {
      push(playerScreen(t, episode, selectionFor(stream), label(stream)));
    }
    function render() {
      var focused = document.activeElement;
      var hadFocus = s && s.el.contains(focused) && isFocusable(focused);
      clear(bestBox);
      clear(list);
      var b = best();
      if (b) {
        bestBox.appendChild(button("Přehrát doporučený zdroj", function () { play(b); }, "tv-primary tv-autofocus"));
        bestBox.appendChild(h("p", { className: "tv-muted", text: label(b) }));
      }
      var sorted = results.slice(0);
      sorted.sort(function (a, b2) { return Number(playable(b2)) - Number(playable(a)) || (b2.video_height || 0) - (a.video_height || 0); });
      each(sorted.slice(0, 60), function (x) {
        var ok = playable(x);
        list.appendChild(h("button", { type: "button", className: "tv-f tv-source", disabled: !ok, onclick: function () { play(x); } }, [
          h("strong", { text: label(x) }),
          x.file_name ? h("span", { className: "tv-muted", text: x.file_name }) : null,
          !ok ? h("span", { className: "tv-muted", text: x.available === false ? "Nedostupné" : "Vyžaduje připojení účtu v plné aplikaci" }) : null
        ]));
      });
      if (!pending) setStatus(status, results.length ? "Nalezeno zdrojů: " + results.length : "Žádné zdroje nebyly nalezeny. Webshare a další účty připoj v plné aplikaci Movly.", results.length ? null : "error");
      if (s && (!hadFocus || !s.el.contains(focused))) { s.touched = false; autoFocus(s); }
    }
    function search() {
      var suffix = query({ limit: 100, episode_id: episode ? episode.id : null });
      var ep = query({ episode_id: episode ? episode.id : null });
      var paths = [
        "streaming/titles/" + t.id + "/streams" + suffix,
        "streaming2/titles/" + t.id + "/streams" + suffix + "&type=" + encodeURIComponent(t.type || "movie"),
        "sources/" + t.id + "/webshare" + ep,
        "sources/" + t.id + "/hellspy" + ep,
        "sources/" + t.id + "/native" + ep
      ];
      each(paths, function (path, i) {
        api(path, {}, function (err, data) {
          if (!alive) return;
          pending--;
          if (err) { rows[i].textContent = origins[i] + ": " + err.message; rows[i].className = "tv-muted tv-error-text"; }
          else {
            var streams = data && data.streams && data.streams.length !== undefined ? data.streams : [];
            each(streams, function (x) { if (x && typeof x === "object") { x.origin = i; results.push(x); } });
            rows[i].textContent = origins[i] + ": " + (data && data.state === "not_connected" ? (data.message || "účet není připojený") : streams.length + " výsledků");
          }
          if (autoPlay && !pending && current() === s) {
            var b = best();
            if (b) { autoPlay = false; s.autoStarted = true; play(b); return; }
            autoPlay = false;
          }
          render();
        });
      });
    }
    s = makeScreen("sources", [
      header(t.title + (episode ? " · S" + pad(episode.season_number) + "E" + pad(episode.episode_number) : "")),
      status, bestBox, statusList, list
    ], {
      onShow: function () {
        if (s.started) {
          // Návrat z přehrávače po automatickém spuštění: rovnou zpět na detail.
          if (s.autoStarted) { s.autoStarted = false; render(); }
          return;
        }
        s.started = true;
        var left = 4;
        each(["webshare", "fastshare", "sosac", "stremio"], function (name) {
          api("providers/" + name, { quiet: true }, function (err, data) {
            connections[name] = !err && (name === "stremio" ? Boolean(data && data.addons && data.addons.length) : data && data.connected === true);
            if (--left === 0 && alive) search();
          });
        });
      },
      onDestroy: function () { alive = false; }
    });
    return s;
  }

  // ---------- přehrávač ----------
  var activePlayer = null;
  function stopPlayback() { if (activePlayer) activePlayer.stop(); }
  var hlsLoading = null;
  function loadHls(done) {
    if (window.Hls) { done(window.Hls); return; }
    if (hlsLoading) { hlsLoading.push(done); return; }
    hlsLoading = [done];
    var script = document.createElement("script");
    script.src = HLS_SCRIPT;
    function finish() { var cbs = hlsLoading; hlsLoading = null; each(cbs, function (cb) { cb(window.Hls || null); }); }
    script.onload = finish;
    script.onerror = finish;
    (document.getElementsByTagName("head")[0] || document.documentElement).appendChild(script);
  }
  function hasMediaSource() { return Boolean(window.MediaSource || window.WebKitMediaSource); }
  function canNativeHls(video) {
    var r = video.canPlayType ? video.canPlayType("application/vnd.apple.mpegurl") : "";
    if (!r) r = video.canPlayType ? video.canPlayType("application/x-mpegURL") : "";
    return r === "probably" || r === "maybe";
  }
  function playerScreen(t, episode, selection, sourceLabel) {
    var video = h("video", { className: "tv-video", preload: "auto" });
    var titleText = t.title + (episode ? " · S" + pad(episode.season_number) + "E" + pad(episode.episode_number) + (episode.name ? " " + episode.name : "") : "");
    var timeText = h("span", { className: "tv-osd-time", text: "00:00" });
    var fill = h("span", { className: "tv-osd-fill" });
    var info = h("p", { className: "tv-osd-status", role: "status", text: "Připravuji video…" });
    var osd = h("div", { className: "tv-osd" }, [
      h("p", { className: "tv-osd-title", text: titleText }),
      h("div", { className: "tv-osd-bar" }, [fill]),
      h("div", { className: "tv-osd-row" }, [timeText, h("span", { className: "tv-osd-hint", text: "OK přehrát/pozastavit · ◀ ▶ posun o 10 s · Zpět ukončit" })]),
      info
    ]);
    // Tlačítka pro kurzor ovladače (LG NetCast posílá šipky jako pohyb kurzoru).
    var playButton = button("Pozastavit", function () { togglePlay(); }, "tv-f-player tv-osd-play");
    var controls = h("div", { className: "tv-osd-controls" }, [
      button("\u25C0 Zpět", back, "tv-f-player"),
      button("\u221210 s", function () { seek(-10); }, "tv-f-player"),
      playButton,
      button("+10 s", function () { seek(10); }, "tv-f-player"),
      button("+60 s", function () { seek(60); }, "tv-f-player")
    ]);
    osd.insertBefore(controls, info);
    var errorBox = h("div", { className: "tv-player-error" });
    errorBox.hidden = true;
    var el = h("section", { className: "tv-player" }, [video, osd, errorBox]);
    // Video jde přímo od poskytovatele, ne přes server (#153): délku a pozici
    // zná jen přehrávač televizoru.
    var session = null, offset = 0, hls = null, stopped = false, progressTimer = null, openTimer = null,
      osdTimer = null, seekTimer = null, seekTarget = null, generation = 0, lastSaved = -1, played = false, loaded = false;

    function duration() { return isFinite(video.duration) && video.duration > 0 ? video.duration : 0; }
    function position() { return loaded ? video.currentTime || 0 : offset; }
    function paint() {
      var dur = duration(), pos = seekTarget !== null ? seekTarget : position();
      timeText.textContent = clock(pos) + " / " + clock(dur);
      fill.style.width = (dur > 0 ? Math.min(100, (pos / dur) * 100) : 0) + "%";
    }
    function showOsd(sticky) {
      osd.className = "tv-osd tv-osd-visible";
      clearTimeout(osdTimer);
      if (!sticky && !video.paused) osdTimer = setTimeout(function () { osd.className = "tv-osd"; }, 4000);
    }
    function say(text) { info.textContent = text || ""; showOsd(Boolean(text)); }
    function fail(text) {
      diag("fail", { stage: "playback", engine: el.getAttribute("data-engine") });
      var at = position();
      saveHistory();
      teardown();
      offset = at;
      say("");
      clear(errorBox);
      errorBox.appendChild(h("h2", { text: "Přehrávání selhalo" }));
      errorBox.appendChild(h("p", { text: text }));
      var retry = button("Zkusit znovu", function () { errorBox.hidden = true; start(position()); }, "tv-primary tv-f-player");
      errorBox.appendChild(h("div", { className: "tv-actions" }, [retry, button("Zpět", back, "tv-f-player")]));
      errorBox.hidden = false;
      focusEl(retry, true);
    }
    // Ukládání pozice stejně jako player.js (každých 20 s a při ukončení).
    function saveHistory() {
      if (!session || !loaded || !(video.currentTime > 0) || !duration()) return;
      var pos = Math.floor(position());
      if (pos === lastSaved) return;
      lastSaved = pos;
      var body = {
        title_id: t.id,
        type: t.type,
        watch_status: video.ended || pos >= duration() * 0.85 ? "completed" : "watching",
        progress_seconds: pos,
        duration_seconds: Math.floor(duration())
      };
      if (episode) { body.season_number = episode.season_number; body.episode_number = episode.episode_number; }
      api("watch-history", { method: "POST", body: body, quiet: true }, function (err) {
        if (err) {
          if (lastSaved === pos) lastSaved = -1;
          if (!stopped) say("Pozice se neuložila: " + err.message);
        }
      });
    }
    function teardown() {
      clearInterval(progressTimer);
      clearTimeout(openTimer);
      clearTimeout(seekTimer);
      if (hls) { try { hls.destroy(); } catch (e) { /* ignorovat */ } hls = null; }
      try { video.pause(); } catch (e) { /* ignorovat */ }
      video.removeAttribute("src");
      try { video.load(); } catch (e) { /* ignorovat */ }
      session = null;
      loaded = false;
    }
    function start(at) {
      var mine = ++generation;
      if (session) { saveHistory(); }
      teardown();
      seekTarget = null;
      offset = Math.max(0, Math.floor(at || 0));
      say("Připravuji video…");
      var body = {};
      for (var k in selection) if (Object.prototype.hasOwnProperty.call(selection, k)) body[k] = selection[k];
      api("playback", { method: "POST", body: body }, function (err, data) {
        if (stopped || mine !== generation) return;
        if (err) {
          fail(err.code === "app_required"
            ? "Tento zdroj nejde na televizoru přehrát přímo. Otevři ho v aplikaci Movly, nebo zkus jiný zdroj."
            : err.status === 0 ? NETWORK_ERROR : "Zdroj se nepodařilo připravit: " + err.message);
          return;
        }
        if (!data || data.direct !== true || typeof data.url !== "string" || !/^https:\/\//.test(data.url) || (data.kind !== "file" && data.kind !== "hls")) { fail("Server vrátil neplatný zdroj přehrávání."); return; }
        session = data;
        diag("session", { kind: data.kind, offset: offset });
        paint();
        attach(mine);
      });
    }
    function attach(mine, skipNative) {
      function go() {
        var p = video.play();
        if (p && typeof p.then === "function") p.then(null, function () { say("Stiskni OK pro přehrání."); });
      }
      clearInterval(progressTimer);
      progressTimer = setInterval(function () { saveHistory(); }, 20000);
      played = false;
      // Některé televizory nepodporovaný kontejner ani nenahlásí jako chybu.
      // Rezerva pro přípravu a plánování UI před celkovým limitem 25 s.
      clearTimeout(openTimer);
      openTimer = setTimeout(function () {
        if (stopped || mine !== generation || loaded || video.error) return;
        fail("Televizor tento zdroj neotevřel. Zkus jiný zdroj, nebo ho otevři v aplikaci Movly.");
      }, 24000);
      if (session.kind === "file" || (!skipNative && canNativeHls(video))) {
        el.setAttribute("data-engine", session.kind === "file" ? "file" : "native");
        diag("engine", { e: el.getAttribute("data-engine") });
        video.src = session.url;
        go();
        return;
      }
      if (!hasMediaSource()) { fail("Tento televizor neumí přehrát video ve formátu HLS (chybí nativní HLS i Media Source Extensions)."); return; }
      say("Načítám přehrávač…");
      loadHls(function (Hls) {
        if (stopped || mine !== generation) return;
        if (!Hls || !Hls.isSupported()) { fail("Tento televizor neumí přehrát video ve formátu HLS (hls.js zde není podporováno)."); return; }
        el.setAttribute("data-engine", "hls.js");
        diag("engine", { e: "hls.js" });
        hls = new Hls({ enableWorker: false, startPosition: offset, maxBufferLength: 24 });
        hls.on(Hls.Events.ERROR, function (_event, data) {
          if (data) diag("hls-error", { type: data.type, fatal: Boolean(data.fatal), code: data.response && data.response.code });
          if (!data || !data.fatal || stopped || mine !== generation) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !hls.__recovered) { hls.__recovered = true; hls.recoverMediaError(); return; }
          fail(data.type === Hls.ErrorTypes.NETWORK_ERROR ? "Poskytovatel nedovoluje přehrát tento stream v prohlížeči televizoru. Zkus jiný zdroj nebo aplikaci Movly." : "Televizor nedokáže toto video dekódovat. Zkus jiný zdroj.");
        });
        hls.on(Hls.Events.MANIFEST_PARSED, go);
        hls.loadSource(session.url);
        hls.attachMedia(video);
      });
    }
    function togglePlay() {
      if (!session || !errorBox.hidden) return;
      if (video.paused) { var p = video.play(); if (p && p.then) p.then(null, function () {}); }
      else video.pause();
      showOsd();
    }
    // Posun v přímém souboru zvládne přehrávač sám.
    function seek(delta) {
      if (!session || !loaded || !errorBox.hidden) return;
      seekTarget = Math.max(0, Math.min(duration() - 5, (seekTarget !== null ? seekTarget : position()) + delta));
      paint();
      showOsd(true);
      clearTimeout(seekTimer);
      seekTimer = setTimeout(function () {
        var target = seekTarget;
        seekTarget = null;
        video.currentTime = target;
        showOsd();
      }, 800);
    }
    video.addEventListener("timeupdate", paint, false);
    video.addEventListener("loadedmetadata", function () {
      if (loaded || !session) return;
      loaded = true;
      if (offset > 0 && session.kind === "file") { try { video.currentTime = offset; } catch (e) { /* ignorovat */ } }
      paint();
    }, false);
    function syncPlayButton() { playButton.textContent = video.paused ? "Přehrát" : "Pozastavit"; }
    video.addEventListener("play", syncPlayButton, false);
    video.addEventListener("pause", syncPlayButton, false);
    // Pohyb kurzoru ukáže ovládání; klik do obrazu přepne přehrávání.
    el.addEventListener("mousemove", function () { if (!stopped) showOsd(); }, false);
    video.addEventListener("click", function () { if (osd.className.indexOf("tv-osd-visible") < 0) showOsd(); else togglePlay(); }, false);
    // Diagnostika průběhu přehrávání (každých 5 s).
    var beat = setInterval(function () {
      if (stopped) { clearInterval(beat); return; }
      if (!session) return;
      var end = null;
      try { if (video.buffered.length) end = Math.round(video.buffered.end(video.buffered.length - 1) * 10) / 10; } catch (e) { end = "err"; }
      diag("beat", { ct: Math.round((video.currentTime || 0) * 10) / 10, buf: end, dur: isFinite(video.duration) ? Math.round(video.duration) : null, p: video.paused, rs: video.readyState, ns: video.networkState });
    }, 5000);
    video.addEventListener("playing", function () { say(""); showOsd(); diag("playing", { engine: el.getAttribute("data-engine"), w: video.videoWidth, h: video.videoHeight }); }, false);
    video.addEventListener("pause", function () { if (!stopped) showOsd(true); }, false);
    each(["loadstart", "loadedmetadata", "canplay", "stalled"], function (name) {
      video.addEventListener(name, function () { diag("video", { ev: name, rs: video.readyState, ns: video.networkState }); }, false);
    });
    video.addEventListener("waiting", function () { say("Načítám video…"); diag("video", { ev: "waiting", ct: video.currentTime }); }, false);
    video.addEventListener("ended", function () { saveHistory(); say("Konec videa. Stiskni Zpět."); }, false);
    video.addEventListener("timeupdate", function () { if (video.currentTime > 1) played = true; }, false);
    video.addEventListener("error", function () {
      diag("video-error", { code: video.error ? video.error.code : null, engine: el.getAttribute("data-engine"), played: played });
      if (stopped || hls || !session) return;
      // Nativní HLS ohlášené přes canPlayType, které nic nepřehrálo: zkusit hls.js nad stejnou relací.
      if (el.getAttribute("data-engine") === "native" && !played && hasMediaSource()) {
        el.setAttribute("data-engine", "native-failed");
        video.removeAttribute("src");
        try { video.load(); } catch (e) { /* ignorovat */ }
        attach(generation, true);
        return;
      }
      fail("Televizor nemůže video přehrát (kód " + (video.error ? video.error.code : "?") + "). Zkus jiný zdroj.");
    }, false);
    var player = {
      stop: function () {
        if (stopped) return;
        saveHistory();
        stopped = true;
        clearTimeout(osdTimer);
        teardown();
        if (activePlayer === player) activePlayer = null;
      }
    };
    function unload() { player.stop(); }
    return {
      name: "player",
      el: el,
      onShow: function () {
        if (activePlayer && activePlayer !== player) activePlayer.stop();
        activePlayer = player;
        if (session || stopped) return;
        window.addEventListener("pagehide", unload, false);
        say("Zjišťuji, kde jsi skončil(a)…");
        var path = "watch-history/position/" + t.id + (episode ? query({ season_number: episode.season_number, episode_number: episode.episode_number }) : "");
        api(path, { quiet: true }, function (err, pos) {
          if (stopped) return;
          if (err && err.status !== 404 && err.status !== 0) { if (handleAuthError(err)) return; }
          var at = !err && pos && pos.watch_status !== "completed" && pos.progress_seconds > 0 ? pos.progress_seconds : 0;
          if (sourceLabel) say("Připravuji video… " + sourceLabel);
          start(at);
        });
      },
      onDestroy: function () { window.removeEventListener("pagehide", unload, false); player.stop(); },
      onKey: function (event) {
        var k = event.keyCode;
        if (!errorBox.hidden) {
          // Chybový panel: šipky a OK obsluhuje běžná navigace (tlačítka Zkusit znovu / Zpět).
          if (k === KEY.LEFT || k === KEY.RIGHT || k === KEY.UP || k === KEY.DOWN) {
            var buttons = errorBox.querySelectorAll("button"), i = 0;
            for (; i < buttons.length; i++) if (buttons[i] === document.activeElement) break;
            var next = buttons[(i + (k === KEY.LEFT || k === KEY.UP ? buttons.length - 1 : 1)) % buttons.length];
            if (next) next.focus();
            return true;
          }
          if (k === KEY.ENTER && document.activeElement && errorBox.contains(document.activeElement)) { document.activeElement.click(); return true; }
          return false;
        }
        if (k === KEY.ENTER || k === KEY.PLAY_PAUSE) { togglePlay(); return true; }
        if (k === KEY.PLAY) { if (video.paused) togglePlay(); return true; }
        if (k === KEY.PAUSE) { if (!video.paused) togglePlay(); return true; }
        if (k === KEY.LEFT || k === KEY.REWIND) { seek(-10); return true; }
        if (k === KEY.RIGHT || k === KEY.FORWARD) { seek(10); return true; }
        if (k === KEY.UP || k === KEY.DOWN) { showOsd(); return true; }
        if (k === KEY.STOP) { back(); return true; }
        return false;
      },
      // Pro testy a diagnostiku.
      state: function () { return { session: session ? session.kind : null, offset: offset, engine: el.getAttribute("data-engine") }; }
    };
  }

  window.addEventListener("blur", function () { var screen = current(); if (screen && screen.onBlur) screen.onBlur(); }, false);
  window.addEventListener("focus", function () { var screen = current(); if (screen && screen.onFocus) screen.onFocus(); }, false);
  document.addEventListener("visibilitychange", function () {
    var screen = current();
    if (!screen) return;
    if (document.hidden && screen.onBlur) screen.onBlur();
    else if (!document.hidden && screen.onFocus) screen.onFocus();
  }, false);

  // ---------- start ----------
  function boot() {
    var html = document.documentElement;
    if ((" " + html.className + " ").indexOf(" tv-lite ") < 0) html.className += " tv-lite";
    root = document.getElementById("tv-root");
    if (!root) { root = h("div", { id: "tv-root", className: "tv-root" }); document.body.appendChild(root); }
    document.title = "Movly TV";
    var loading = makeScreen("boot", [h("div", { className: "tv-center" }, [h("h1", { className: "tv-logo", text: "Movly" }), statusBox("Načítám…")])]);
    resetTo(loading);
    api("session", { quiet: true }, function (err, data) {
      if (err) {
        if (err.status === 401 || contains(SESSION_CODES, err.code)) { resetTo(loginScreen()); return; }
        if (contains(PROFILE_CODES, err.code)) { resetTo(profilesScreen()); return; }
        var retry = button("Zkusit znovu", boot, "tv-autofocus");
        resetTo(makeScreen("boot-error", [h("div", { className: "tv-center" }, [h("h1", { className: "tv-logo", text: "Movly" }), statusBox(err.message, "error"), retry])]));
        return;
      }
      searchEnvironment = data && /^[a-f0-9]{32}$/.test(data.environment || "") ? data.environment : "";
      account = data && data.account;
      profile = data && data.profile;
      resetTo(profile ? homeScreen() : profilesScreen());
    });
  }
  // Příznak pro legacy.js: až po úspěšném vykreslení první obrazovky, jinak zobrazí původní hlášku.
  function start() {
    diag("boot", { sw: window.screen.width, sh: window.screen.height, iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio || 1, media: mediaSupport() });
    boot();
    window.__movlyTvStarted = true;
  }
  window.MovlyTv = { current: function () { return current(); } };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, false);
})();

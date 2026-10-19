/* Shared, server-owned Home editor document. ES5 for Chrome34 TV clients. */
(function (root) {
  "use strict";
  var slugPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
  function signedInteger(value) { return typeof value === "number" && isFinite(value) && Math.floor(value) === value && Math.abs(value) <= 9007199254740991; }
  function integer(value) { return signedInteger(value) && value >= 0; }
  function list(value) { return Object.prototype.toString.call(value) === "[object Array]"; }
  function fail() { throw new Error("Invalid home preferences"); }
  function document(value, profileId, page) {
    if (page !== undefined && (["home", "movies", "series"].indexOf(page) < 0 || !value || value.page !== page || typeof value.catalog_revision !== "string" || value.catalog_revision.length !== 64 || /[^a-f0-9]/.test(value.catalog_revision))) fail();
    if (!integer(profileId) || profileId < 1 || !value || value.profile_id !== profileId || !integer(value.revision) || typeof value.catalog_revision !== "string" || !/^[a-f0-9]{64}$/.test(value.catalog_revision) || !list(value.sections) || value.sections.length > 256) fail();
    var seen = {}, positions = {}, sections = [];
    for (var i = 0; i < value.sections.length; i++) {
      var row = value.sections[i];
      if (page !== undefined && (!row || typeof row.slug !== "string" || row.slug.length < 1 || row.slug.length > 80 || !/^[a-z0-9]/.test(row.slug) || /[^a-z0-9-]/.test(row.slug))) fail();
      if (!row || !slugPattern.test(row.slug || "") || seen["$" + row.slug] || typeof row.kind !== "string" || !row.kind || typeof row.name !== "string" || typeof row.visible !== "boolean" || !integer(row.display_order) || row.display_order >= value.sections.length || positions["$" + row.display_order] || !signedInteger(row.default_order)) fail();
      seen["$" + row.slug] = true; positions["$" + row.display_order] = true;
      sections.push({ slug: row.slug, kind: row.kind, name: row.name, visible: row.visible, display_order: row.display_order, default_order: row.default_order });
    }
    sections.sort(function (a, b) { return a.display_order - b.display_order || a.default_order - b.default_order || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0); });
    var result = { profile_id: profileId, revision: value.revision, catalog_revision: value.catalog_revision, sections: sections };
    if (page !== undefined) result.page = page;
    return result;
  }
  function receipt(value, profileId, previousRevision, page) {
    var doc = document(value, profileId, page);
    if (!integer(previousRevision) || doc.revision <= previousRevision) fail();
    return doc;
  }
  function draft(doc) {
    var order = [], hidden = [];
    for (var i = 0; i < doc.sections.length; i++) { order.push(doc.sections[i].slug); if (!doc.sections[i].visible) hidden.push(doc.sections[i].slug); }
    return { order: order, hidden: hidden };
  }
  function reconcile(previous, value, fresh, dirty, samePolicy, blocked) {
    if (previous && (dirty || blocked)) return { document: previous, draft: value, dirty: !!dirty, ready: samePolicy,
      conflict: !!blocked || !samePolicy || fresh.page !== previous.page || fresh.revision !== previous.revision || fresh.catalog_revision !== previous.catalog_revision };
    return { document: fresh, draft: draft(fresh), dirty: false, ready: true, conflict: false };
  }
  // One pending read, cancellable generation, and no background requests.
  function watch(options) {
    var timer = null, request = null, generation = 0, running = false, baseline = null;
    var later = options.setTimer || setTimeout, clear = options.clearTimer || clearTimeout;
    function key(value) { return [value.page, value.profile_id, value.revision, value.catalog_revision, value.policy_revision].join(":"); }
    function schedule(mine) { if (running && mine === generation) timer = later(tick, options.delay || 30000); }
    function tick() {
      timer = null;
      if (!running) return;
      if (!options.active()) { stop(); return; }
      var mine = generation, completed = false;
      request = options.read(function (err, value) {
        completed = true;
        if (!running || mine !== generation || !options.active()) return;
        request = null;
        if (!err && value) {
          var identity = key(value);
          var changed = baseline === null ? !!options.initial : baseline !== identity; baseline = identity;
          if (changed) options.changed();
        }
        schedule(mine);
      });
      if (completed) request = null;
    }
    function stop() { running = false; generation++; clear(timer); timer = null; if (request && request.abort) request.abort(); request = null; }
    return { accept: function (value) { baseline = key(value); }, start: function () { if (running) return; running = true; generation++; tick(); }, stop: stop };
  }
  function move(value, slug, delta) {
    var i = value.order.indexOf(slug), next = i + delta;
    if (i < 0 || (delta !== -1 && delta !== 1) || next < 0 || next >= value.order.length) return;
    value.order.splice(i, 1); value.order.splice(next, 0, slug);
  }
  function relocate(value, slug, index) {
    var old = value.order.indexOf(slug);
    if (old < 0 || !integer(index) || index >= value.order.length) return;
    value.order.splice(old, 1); value.order.splice(index, 0, slug);
  }
  function toggle(value, slug) {
    if (value.order.indexOf(slug) < 0) return;
    var i = value.hidden.indexOf(slug);
    if (i < 0) value.hidden.push(slug); else value.hidden.splice(i, 1);
  }
  function body(doc, value, reset) { return { revision: doc.revision, catalog_revision: doc.catalog_revision, order: reset ? [] : value.order.slice(0), hidden: reset ? [] : value.hidden.slice(0) }; }
  var words = {
    pages: ["Řady na stránkách", "Rady na stránkach", "Page rows"], home: ["Domů", "Domov", "Home"], movies: ["Filmy", "Filmy", "Movies"], series: ["Seriály", "Seriály", "Series"], edit: ["Upravit", "Upraviť", "Edit"], done: ["Hotovo", "Hotovo", "Done"], drag: ["Přesunout řadu", "Presunúť rad", "Move row"], resetConfirm: ["Obnovit výchozí řady této stránky?", "Obnoviť predvolené rady tejto stránky?", "Reset rows for this page?"],
    title: ["Řady na Domů", "Rady na Domov", "Home rows"], settings: ["Nastavení", "Nastavenia", "Settings"],
    description: ["Pořadí a zobrazení řad pro tento profil", "Poradie a zobrazenie radov pre tento profil", "Row order and visibility for this profile"],
    loading: ["Načítám řady…", "Načítavam rady…", "Loading rows…"], save: ["Uložit", "Uložiť", "Save"], reset: ["Obnovit výchozí", "Obnoviť predvolené", "Reset to defaults"],
    reload: ["Načíst znovu", "Načítať znovu", "Reload"], up: ["Nahoru", "Nahor", "Move up"], down: ["Dolů", "Nadol", "Move down"], hide: ["Skrýt", "Skryť", "Hide"], show: ["Zobrazit", "Zobraziť", "Show"],
    hidden: ["Skrytá", "Skrytá", "Hidden"], visible: ["Zobrazená", "Zobrazená", "Visible"], saved: ["Uloženo.", "Uložené.", "Saved."], saving: ["Ukládám…", "Ukladám…", "Saving…"],
    error: ["Změna nebyla uložena. Zkus to znovu.", "Zmena sa neuložila. Skús to znova.", "Changes were not saved. Try again."], loadError: ["Řady se nepodařilo načíst.", "Rady sa nepodarilo načítať.", "Could not load rows."],
    conflict: ["Řady se změnily na jiném zařízení. Načti aktuální stav a změnu zadej znovu.", "Rady sa zmenili na inom zariadení. Načítaj aktuálny stav a zmenu zadaj znova.", "Rows changed on another device. Reload the current state and reapply your change."],
    context: ["Profil nebo jeho pravidla se změnily. Načti aktuální stav.", "Profil alebo jeho pravidlá sa zmenili. Načítaj aktuálny stav.", "The profile or its rules changed. Reload the current state."],
    empty: ["Pro tento profil nejsou dostupné žádné řady.", "Pre tento profil nie sú dostupné žiadne rady.", "No rows are available for this profile."], retry: ["Zkusit znovu", "Skúsiť znova", "Try again"]
  };
  function text(key, lang) { return words[key] ? words[key][lang === "sk" ? 1 : lang === "en" ? 2 : 0] : key; }
  var api = { document: document, receipt: receipt, draft: draft, reconcile: reconcile, watch: watch, move: move, relocate: relocate, toggle: toggle, body: body, text: text };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MovlyHomePreferences = api;
}(typeof window !== "undefined" ? window : this));

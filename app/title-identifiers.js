/* Local diagnostic display, shared with the ES5 TV client. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MovlyTitleIdentifiers = api;
}(typeof window !== "undefined" ? window : this, function (root) {
  "use strict";
  var key = "movly.showTitleIdentifiers", eventName = "movly:title-identifiers-changed";
  function positive(value) {
    if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) value = Number(value);
    return typeof value === "number" && isFinite(value) && Math.floor(value) === value && value > 0 && value <= 9007199254740991 ? value : null;
  }
  function ids(title) {
    title = title || {};
    var db = positive(title.id), tmdb = positive(title.tmdb_id);
    var sentinel = typeof title.id === "string" ? /^tmdb:(?:movie|tv|series):([1-9][0-9]*)$/.exec(title.id) : null;
    if (tmdb === null && sentinel) tmdb = positive(sentinel[1]);
    return { db: db, tmdb: tmdb };
  }
  function enabled() { try { return root.localStorage.getItem(key) === "1"; } catch (_) { return false; } }
  function setEnabled(value) {
    try { root.localStorage.setItem(key, value ? "1" : "0"); } catch (_) { return false; }
    var event = root.document.createEvent("Event"); event.initEvent(eventName, false, false); root.dispatchEvent(event); return true;
  }
  function text(name, lang) {
    var words = {
      cs: { advanced: "Pokročilé", title: "Zobrazovat ID titulů", note: "V detailu zobrazí DB ID a TMDB ID titulu.", error: "Volbu nelze uložit.", on: "Zapnuto", off: "Vypnuto" },
      sk: { advanced: "Pokročilé", title: "Zobrazovať ID titulov", note: "V detaile zobrazí DB ID a TMDB ID titulu.", error: "Voľbu nemožno uložiť.", on: "Zapnuté", off: "Vypnuté" },
      en: { advanced: "Advanced", title: "Show title IDs", note: "Show DB ID and TMDB ID in title details.", error: "Unable to save this preference.", on: "On", off: "Off" }
    };
    return (words[String(lang || "cs").slice(0, 2)] || words.en)[name];
  }
  function paint(node, title) {
    var value = ids(title);
    node.textContent = "DB ID: " + (value.db === null ? "—" : value.db) + " · TMDB ID: " + (value.tmdb === null ? "—" : value.tmdb);
    node.hidden = !enabled();
  }
  function watch(node, title) {
    function update() { paint(node, title); }
    function storage(event) { if (!event || event.key === key || event.key === null) update(); }
    update(); root.addEventListener(eventName, update); root.addEventListener("storage", storage);
    return function () { root.removeEventListener(eventName, update); root.removeEventListener("storage", storage); };
  }
  return { ids: ids, enabled: enabled, setEnabled: setEnabled, text: text, paint: paint, watch: watch };
}));

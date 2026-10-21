/* Shared pure inventory rules; ES5 for TV lite. No URLs or credentials. */
(function (root) {
  "use strict";
  function rowsValid(rows) {
    if (!Array.isArray(rows)) return false;
    var ids = {}, sum = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !integer(r.provider_id) || r.provider_id <= 0 || ids[r.provider_id] || !integer(r.streams_count) || r.streams_count <= 0 ||
        (r.video_height != null && (!integer(r.video_height) || r.video_height <= 0)) ||
        (r.audio_languages != null && (!Array.isArray(r.audio_languages) || !r.audio_languages.every(function (v) { return typeof v === "string"; })))) return false;
      ids[r.provider_id] = true; sum += r.streams_count;
    }
    return integer(sum);
  }
  function integer(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v && Math.abs(v) <= 9007199254740991; }
  function valid(value, titleId) {
    if (!value || value.degraded === true || value.title_id !== titleId || !integer(titleId) || titleId <= 0 || !rowsValid(value.providers) || !value.episodes || Array.isArray(value.episodes) || typeof value.episodes !== "object") return false;
    return Object.keys(value.episodes).every(function (id) { return /^[1-9][0-9]*$/.test(id) && rowsValid(value.episodes[id]); });
  }
  function provider(row) {
    var known = {1:"webshare",2:"hellspy",3:"fastshare",4:"sktorrent",5:"sosac"};
    if (known[row.provider_id]) return known[row.provider_id];
    return String(row.provider_name || "").toLowerCase().replace(/[č]/g,"c").replace(/[á]/g,"a").replace(/[ř]/g,"r").replace(/[ ._-]/g, "");
  }
  function allowed(row, connections) {
    var name = provider(row);
    if (!/^(?:webshare|hellspy|fastshare|sosac|streamuj|sktorrent|sledujteto|crwiki|ceskawiki|prehrajto|stremio|bombuj|voe|mixdrop|streamtape|doodstream|streamwish|vidhide|lulustream|ct|ceskatelevize|stvr)$/.test(name)) return false;
    if (name === "streamuj") name = "sosac";
    return ["webshare","fastshare","sosac","stremio"].indexOf(name) < 0 || connections[name] === true;
  }
  function publicRow(value) {
    var row={provider_id:value.provider_id,streams_count:value.streams_count};
    if(typeof value.provider_name==="string") row.provider_name=value.provider_name;
    if(value.video_height!=null) row.video_height=value.video_height;
    if(Array.isArray(value.audio_languages)) row.audio_languages=value.audio_languages.slice(0);
    return row;
  }
  function filtered(value, connections) {
    if (!valid(value, value && value.title_id)) return null;
    var episodes = {};
    Object.keys(value.episodes).forEach(function (id) { episodes[id] = value.episodes[id].filter(function (r) { return allowed(r, connections); }).map(publicRow); });
    return {title_id:value.title_id, providers:value.providers.filter(function (r) { return allowed(r, connections); }).map(publicRow), episodes:episodes};
  }
  function language(value) {
    var code = value.trim().toLowerCase().replace(/_/g,"-").split("-")[0];
    if (["und","unk","unknown","mul","zxx","n/a",""].indexOf(code)>=0) return null;
    var aliases = {czech:"CZ",slovak:"SK",english:"EN",german:"DE",polish:"PL",svk:"SK",por:"PT",hun:"HU",cs:"CZ",cz:"CZ",ces:"CZ",cze:"CZ",sk:"SK",slk:"SK",slo:"SK",en:"EN",eng:"EN",de:"DE",deu:"DE",ger:"DE",fr:"FR",fra:"FR",fre:"FR",es:"ES",spa:"ES",it:"IT",ita:"IT",pl:"PL",pol:"PL",ru:"RU",rus:"RU",uk:"UK",ukr:"UK",ja:"JA",jpn:"JA",ko:"KO",kor:"KO",zh:"ZH",zho:"ZH",chi:"ZH"};
    return aliases[code] || (/^[a-z]{2,3}$/.test(code) ? code.toUpperCase() : null);
  }
  function summary(rows) {
    if (!rowsValid(rows)) return null;
    var count = 0, height = 0, languages = [];
    rows.forEach(function (r) { count += r.streams_count; height = Math.max(height,r.video_height || 0); (r.audio_languages || []).forEach(function (a) { var l = language(a); if (l && languages.indexOf(l) < 0) languages.push(l); }); });
    function order(v) { var i = ["CZ","SK","EN"].indexOf(v); return i < 0 ? 3 : i; }
    languages.sort(function (a,b) { return order(a)-order(b) || (a < b ? -1 : a > b ? 1 : 0); });
    var quality = height >= 4320 ? "8K" : height >= 2160 ? "4K" : height >= 1440 ? "QHD" : height >= 1080 ? "FHD" : height >= 720 ? "HD" : height > 0 ? "SD" : null;
    return {count:count,quality:quality,audio:languages.join(" / ")};
  }
  function paint(node, value, access) {
    var locale = ((document.documentElement && document.documentElement.lang) || "cs").slice(0,2);
    var labels = locale === "en" ? {unknown:"Availability not verified",zero:"No streams yet",audio:"Audio not specified",quality:"Highest quality ",sound:"Audio ",one:" stream",few:" streams",many:" streams"}
      : locale === "sk" ? {unknown:"Dostupnosť neoverená",zero:"Zatiaľ bez streamu",audio:"Zvuk neuvedený",quality:"Najvyššia kvalita ",sound:"Zvuk ",one:" stream",few:" streamy",many:" streamov"}
      : {unknown:"Dostupnost neověřena",zero:"Zatím bez streamu",audio:"Zvuk neuveden",quality:"Nejvyšší kvalita ",sound:"Zvuk ",one:" stream",few:" streamy",many:" streamů"};
    node.hidden = access === false; node.style.display = access === false ? "none" : "";
    while (node.firstChild) node.removeChild(node.firstChild);
    var fields = value ? [(value.count === 0 ? labels.zero : value.count + "x")] : [labels.unknown];
    if (value && value.count > 0) { if(value.quality) fields.push(value.quality); fields.push(value.audio || labels.audio); }
    fields.forEach(function (text, index) {
      if (index) { var divider = document.createElement("span"); divider.className="inventory-divider"; divider.textContent="│"; divider.setAttribute("aria-hidden","true"); node.appendChild(divider); }
      var span = document.createElement("span"); span.textContent=text;
      if (value && index > 0 && (text === value.audio || text === labels.audio)) span.className="inventory-audio";
      node.appendChild(span);
    });
    node.setAttribute("aria-label", !value ? labels.unknown : value.count === 0 ? labels.zero : value.count + (value.count === 1 ? labels.one : value.count <= 4 ? labels.few : labels.many) + (value.quality ? ", " + labels.quality + value.quality : "") + ", " + (value.audio ? labels.sound + value.audio : labels.audio));
  }
  var api = {valid:valid, filtered:filtered, allowed:allowed, summary:summary, paint:paint};
  if (typeof module !== "undefined" && module.exports) module.exports=api;
  else root.MovlyDatabaseAvailability=api;
}(typeof window !== "undefined" ? window : this));

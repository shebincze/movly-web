// ES5 port of app/stream-scoring.js; contract fixtures guard numerical and ordering parity.
(function(root,factory){
  if(typeof module === "object" && module.exports) module.exports=factory();
  else root.MovlyTvScoring=factory();
}(this,function(){
"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
// Stream scoring — doporučené skóre, řazení a facety podle sdíleného kontraktu
// shebincze/Movly contracts/stream-relevance (README „Stream scoring“, scoring.json).
// Čisté funkce bez DOM; stejné vstupy jako StreamScoring na Apple, Android a Windows.
// TABLES je doslovná kopie scoring.json → tables; stream-scoring.test.js ji porovnává
// s test-support/stream-scoring.fixtures.json a prochází všechny sekce fixtures.
var TABLES = Object.freeze({
    tolerance: 1e-6,
    bitrateCenters: [2.5, 6.5, 12.5, 20, 32.5, 100],
    bitrateSigmas: [1.5, 3, 5, 8, 15, 50],
    adaptationRatios: [0.9, 0.85, 0.8, 0.75, 0.72, 0.7],
    safeRatio: 0.8,
    overloadRatio: 0.9,
    closenessTolerance: 0.3,
    closenessBonus: 3,
    tierPenalty: 2,
    overloadPenalty: 5,
    bitrateMinMbps: 0.1,
    bitrateMaxMbps: 200,
    durationMinSeconds: 60,
    durationMaxSeconds: 86400,
    filterPenalty: -200,
    forcedLanguageScore: 1100,
    primaryLanguageScore: 100,
    secondaryLanguageScore: 50,
    recommendedLimit: 3,
    weights: [0, 1, 2, 4, 8],
    criteria: ["quality", "bitrate", "size", "sizeSmall", "audioLanguage", "subtitleLanguage", "forcedSubtitles", "audioChannels",
        "audioCodecPreference", "videoCodecPreference", "hdr", "sdr", "recommendedScore", "bitrateFit", "adaptation", "database", "durationMatch"],
    dynamicRangeScores: { DV: 1, "HDR10+": 0.8, HDR10: 0.6, HLG: 0.5, SDR: 0 },
    languageCodes: {
        cz: "cs", cze: "cs", ces: "cs", czech: "cs", cesky: "cs", ceske: "cs",
        sk: "sk", slo: "sk", slk: "sk", svk: "sk", slovensky: "sk", slovak: "sk",
        en: "en", eng: "en", english: "en", anglicky: "en",
        ger: "de", deu: "de", german: "de", nemecky: "de",
        fre: "fr", fra: "fr", french: "fr", spa: "es", esp: "es", spanish: "es", ita: "it", italian: "it",
        rus: "ru", russian: "ru", polish: "pl", polski: "pl", hun: "hu", hungarian: "hu", ukr: "uk",
        jpn: "ja", jap: "ja", kor: "ko", chi: "zh", zho: "zh", dan: "da", swe: "sv", nor: "no", fin: "fi",
        dut: "nl", nld: "nl", por: "pt", tur: "tr", ara: "ar", heb: "he", hin: "hi", tha: "th", gre: "el", ell: "el",
        rum: "ro", ron: "ro", bul: "bg", srp: "sr", hrv: "hr", slv: "sl", lit: "lt", lav: "lv", est: "et",
    },
});
var member = function (list, v) { return list.indexOf(v) !== -1; };
var set = function (list) { return ({ has: function (v) { return member(list, v); } }); };
var known = function (v) { return v !== null && v !== undefined; };
var own = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
// ---------------------------------------------------------------- pomocné funkce
function languageCode(token) {
    if (!known(token))
        return null;
    var s = String(token).trim().toLowerCase();
    var pair = /^([a-z]{2,3})[-_][a-z]{2}$/.exec(s);
    if (pair)
        s = pair[1];
    if (own(TABLES.languageCodes, s))
        return TABLES.languageCodes[s];
    return /^[a-z]{2}$/.test(s) ? s : null;
}
var codecKey = function (s) { return String(s !== null && s !== void 0 ? s : "").toLowerCase().replace(/[^a-z0-9]/g, ""); };
// Index první položky seznamu, jejíž codecKey je neprázdný podřetězec codecKey(codec).
function listIndex(list, codec) {
    var key = codecKey(codec);
    var items = list || [];
    for (var i = 0; i < items.length; i++) {
        var item = codecKey(items[i]);
        if (item && member(key, item))
            return i;
    }
    return null;
}
function dynamicRange(hdr) {
    if (!hdr)
        return "SDR";
    var k = codecKey(hdr);
    if (member(k, "dolbyvision") || member(k, "dovi") || k === "dv")
        return "DV";
    if (member(k, "hdr10plus") || member(String(hdr).toLowerCase(), "hdr10+"))
        return "HDR10+";
    if (member(k, "hlg"))
        return "HLG";
    if (member(k, "hdr"))
        return "HDR10";
    return "SDR";
}
// Bez lookbehind (starší Safari ho nezná): číslice před shodou vylučuje skupina 1.
function channelsFromName(name) {
    var match = /(^|[^0-9])([1-9])\.([0-9])(?![0-9])/.exec(String(name !== null && name !== void 0 ? name : ""));
    if (match)
        return Number(match[2]) + Number(match[3]);
    return member(String(name !== null && name !== void 0 ? name : "").toLowerCase(), "atmos") ? 8 : null;
}
function effectiveBitrateMbps(c) {
    var kb = c.bitrateKbps, size = c.sizeBytes, duration = c.durationSeconds;
    var b;
    if (known(kb) && kb > 0)
        b = kb / 1000;
    else if (known(size) && size > 0 && known(duration) && duration >= TABLES.durationMinSeconds && duration <= TABLES.durationMaxSeconds)
        b = size * 8 / duration / 1000000;
    else
        return null;
    return b >= TABLES.bitrateMinMbps && b <= TABLES.bitrateMaxMbps ? b : null;
}
function isHEVC(videoCodec) {
    var k = codecKey(videoCodec);
    return member(k, "hevc") || member(k, "h265") || member(k, "x265");
}
var hasAtmos = function (c) { return (c.audioTracks || []).some(function (t) { return member(codecKey(t.codec), "atmos"); }); };
// `>x` a `<x` ostře, `a:b` včetně mezí; neplatný zápis → null (filtr se ignoruje).
function parseRange(spec) {
    if (!known(spec))
        return null;
    var s = String(spec).trim();
    var m = /^>\s*(\d+)$/.exec(s);
    if (m)
        return { min: Number(m[1]), max: null, minExclusive: true, maxExclusive: false };
    m = /^<\s*(\d+)$/.exec(s);
    if (m)
        return { min: null, max: Number(m[1]), minExclusive: false, maxExclusive: true };
    m = /^(\d+)\s*:\s*(\d+)$/.exec(s);
    if (m)
        return { min: Number(m[1]), max: Number(m[2]), minExclusive: false, maxExclusive: false };
    return null;
}
function outOfRange(v, r) {
    if (known(r.min) && (r.minExclusive ? v <= r.min : v < r.min))
        return true;
    if (known(r.max) && (r.maxExclusive ? v >= r.max : v > r.max))
        return true;
    return false;
}
var codes = function (tracks) { return set((tracks || []).map(function (t) { return languageCode(t.language); }).filter(Boolean)); };
var audioCodes = function (c) { return codes(c.audioTracks); };
var subtitleCodes = function (c) { return codes(c.subtitleTracks); };
var linkSpeed = function (st) { return (known(st.linkSpeedMbps) && st.linkSpeedMbps > 0 ? st.linkSpeedMbps : null); };
// ---------------------------------------------------------------- skóre
function score(st, c) {
    var rank = known(c.qualityRank) ? c.qualityRank : null;
    var b = effectiveBitrateMbps(c), link = linkSpeed(st);
    var centers = TABLES.bitrateCenters, sigmas = TABLES.bitrateSigmas;
    var cap = known(st.qualityCap) ? st.qualityCap : null, dmax = known(st.displayMaxRank) ? st.displayMaxRank : null;
    // 1. quality
    var quality = rank === null ? 0 : dmax !== null && rank > dmax ? 0 : cap === null ? rank + 1 : rank <= cap ? rank + 2 : 0;
    // 2. bitrate
    var bitrate = 0;
    if (b !== null) {
        var safe = link !== null ? link * TABLES.safeRatio : null;
        if (safe !== null && b > safe)
            bitrate = Math.max(0, 10 - 20 * (b - safe) / safe);
        else if (rank !== null) {
            var center = centers[rank], sigma = sigmas[rank];
            var g = 10 * Math.exp(-(Math.pow((b - center), 2)) / (2 * sigma * sigma));
            if (center - sigma <= b && b <= center + sigma)
                g += 1;
            bitrate = Math.min(10, g);
        }
    }
    // 3. adaptation
    var adaptation = 0;
    if (link !== null) {
        var recommended = null;
        for (var t = 0; t < centers.length; t++)
            if (centers[t] <= link * TABLES.adaptationRatios[t])
                recommended = t;
        if (recommended !== null) {
            if (rank !== null && rank > recommended)
                adaptation -= TABLES.tierPenalty * (rank - recommended);
            if (b !== null) {
                var target = centers[recommended];
                var d = Math.abs(b - target) / (TABLES.closenessTolerance * target);
                if (d <= 1)
                    adaptation += TABLES.closenessBonus * (1 - d);
                if (b > TABLES.overloadRatio * link)
                    adaptation -= TABLES.overloadPenalty;
            }
        }
    }
    // 4. language
    var A = audioCodes(c);
    var language = known(st.forcedLanguage) && A.has(st.forcedLanguage) ? TABLES.forcedLanguageScore
        : known(st.primaryLanguage) && A.has(st.primaryLanguage) ? TABLES.primaryLanguageScore
            : known(st.secondaryLanguage) && A.has(st.secondaryLanguage) ? TABLES.secondaryLanguageScore : 0;
    // 5. audio
    var tracks = c.audioTracks || [];
    var audio = tracks.length ? Math.max.apply(Math, tracks.map(function (t) {
        var s = 0;
        if (listIndex(st.audioCodecWhitelist, t.codec) !== null)
            s += 1;
        if (listIndex(st.audioCodecBlacklist, t.codec) !== null)
            s -= 10;
        if (known(t.channels) && t.channels > 3)
            s += t.channels - 3;
        return s;
    })) : 0;
    // 6. video
    var video = 0;
    var wl = listIndex(st.videoCodecWhitelist, c.videoCodec);
    if (wl !== null)
        video += Math.max(1, 5 - wl);
    if (listIndex(st.videoCodecBlacklist, c.videoCodec) !== null)
        video -= 10;
    if (dynamicRange(c.hdr) !== "SDR") {
        if (st.excludeHDR)
            video -= 10;
        if (st.preferHDR)
            video += 1;
    }
    // 7. filters (nikdy neodstraňují, jen −200 za každý porušený)
    var f = st.filters || {};
    var violations = 0;
    var r = parseRange(f.bitrateRangeKbps);
    if (r && b !== null && outOfRange(b * 1000, r))
        violations++;
    r = parseRange(f.sizeRangeBytes);
    if (r && known(c.sizeBytes) && c.sizeBytes > 0 && outOfRange(c.sizeBytes, r))
        violations++;
    if (f.excludeHEVC && isHEVC(c.videoCodec))
        violations++;
    if (f.exclude3D && c.is3D)
        violations++;
    if (f.atmosOnly && !hasAtmos(c))
        violations++;
    var filters = TABLES.filterPenalty * violations;
    return { quality: quality, bitrate: bitrate, adaptation: adaptation, language: language, audio: audio, video: video, filters: filters, total: quality + bitrate + adaptation + language + audio + video + filters };
}
// ---------------------------------------------------------------- řazení
// Sestupně, null za známou hodnotou.
function compareDesc(a, b) {
    var ka = known(a), kb = known(b);
    if (!ka || !kb)
        return ka === kb ? 0 : ka ? -1 : 1;
    return a === b ? 0 : a > b ? -1 : 1;
}
function stableOrder(n, compare) {
    return Array.apply(null, Array(n)).map(function (_, i) { return i; }).sort(function (i, j) { return compare(i, j) || i - j; });
}
function effectiveWeight(w) {
    var allowed = __spreadArray([], TABLES.weights, true).sort(function (a, b) { return a - b; });
    var best = allowed[0];
    for (var _i = 0, allowed_1 = allowed; _i < allowed_1.length; _i++) {
        var a = allowed_1[_i];
        if (a <= w)
            best = a;
    }
    return best;
}
function preferenceValue(whitelist, blacklist, codec) {
    var i = listIndex(whitelist, codec);
    if (i !== null)
        return Math.max(1, 5 - i);
    return listIndex(blacklist, codec) !== null ? 0 : null;
}
function criterionValue(key, st, c, breakdown) {
    var size = known(c.sizeBytes) && c.sizeBytes > 0 ? c.sizeBytes : null;
    switch (key) {
        case "quality": return known(c.qualityRank) ? c.qualityRank : null;
        case "bitrate": return effectiveBitrateMbps(c);
        case "size": return size;
        case "sizeSmall": return size === null ? null : -size;
        case "audioLanguage": {
            var A = audioCodes(c);
            return known(st.primaryLanguage) && A.has(st.primaryLanguage) ? 1 : known(st.secondaryLanguage) && A.has(st.secondaryLanguage) ? 0.5 : 0;
        }
        case "subtitleLanguage": {
            var S = subtitleCodes(c);
            return known(st.primaryLanguage) && S.has(st.primaryLanguage) ? 1 : known(st.secondaryLanguage) && S.has(st.secondaryLanguage) ? 0.5 : 0;
        }
        case "forcedSubtitles": {
            var code_1 = known(st.forcedLanguage) ? st.forcedLanguage : known(st.primaryLanguage) ? st.primaryLanguage : null;
            if (code_1 === null)
                return 0;
            return (c.subtitleTracks || []).some(function (t) { return t.forced && languageCode(t.language) === code_1; }) ? 1 : 0;
        }
        case "audioChannels": {
            var channels = (c.audioTracks || []).map(function (t) { return t.channels; }).filter(known);
            return channels.length ? Math.max.apply(Math, channels) : null;
        }
        case "audioCodecPreference": {
            var values = (c.audioTracks || []).map(function (t) { return preferenceValue(st.audioCodecWhitelist, st.audioCodecBlacklist, t.codec); }).filter(known);
            return values.length ? Math.max.apply(Math, values) : null;
        }
        case "videoCodecPreference": return preferenceValue(st.videoCodecWhitelist, st.videoCodecBlacklist, c.videoCodec);
        case "hdr": return TABLES.dynamicRangeScores[dynamicRange(c.hdr)];
        case "sdr": return dynamicRange(c.hdr) === "SDR" ? 1 : 0;
        case "recommendedScore": return breakdown.total;
        case "bitrateFit": return breakdown.bitrate;
        case "adaptation": return breakdown.adaptation;
        case "database": return c.isDatabase ? 1 : 0;
        case "durationMatch": {
            var runtime = st.runtimeMinutes, duration = c.durationSeconds;
            if (known(runtime) && runtime > 0 && known(duration) && duration > 0)
                return 1 - Math.min(1, Math.abs(duration - runtime * 60) / (runtime * 60));
            return null;
        }
        default: throw new Error("Nezn\u00E1m\u00E9 krit\u00E9rium \u0159azen\u00ED: ".concat(key));
    }
}
var FIXED = { quality: 5, audioChannels: 8, audioCodecPreference: 5, videoCodecPreference: 5, bitrateFit: 10 };
var RELATIVE = set(["bitrate", "size", "sizeSmall", "recommendedScore", "adaptation"]);
function normalized(key, values) {
    if (RELATIVE.has(key)) {
        var present = values.filter(known);
        if (!present.length)
            return values;
        var lo_1 = Math.min.apply(Math, present), hi_1 = Math.max.apply(Math, present);
        return values.map(function (v) { return (!known(v) ? null : hi_1 === lo_1 ? 1 : (v - lo_1) / (hi_1 - lo_1)); });
    }
    var div = FIXED[key];
    if (key === "audioChannels")
        return values.map(function (v) { return (known(v) ? Math.min(1, v / div) : null); });
    if (div)
        return values.map(function (v) { return (known(v) ? v / div : null); });
    return values;
}
// Vrací indexy kandidátů v novém pořadí; spec = {mode, normalization?, weights?}.
function sortOrder(st, spec, candidates) {
    var n = candidates.length;
    var mode = spec.mode;
    if (mode === "quality")
        return stableOrder(n, function (i, j) { return compareDesc(candidates[i].qualityRank, candidates[j].qualityRank)
            || compareDesc(candidates[i].sizeBytes, candidates[j].sizeBytes); });
    if (mode === "size")
        return stableOrder(n, function (i, j) { return compareDesc(candidates[i].sizeBytes, candidates[j].sizeBytes); });
    var breakdowns = candidates.map(function (c) { return score(st, c); });
    if (mode === "recommended")
        return stableOrder(n, function (i, j) { return compareDesc(breakdowns[i].total, breakdowns[j].total)
            || compareDesc(candidates[i].qualityRank, candidates[j].qualityRank)
            || compareDesc(candidates[i].sizeBytes, candidates[j].sizeBytes); });
    if (mode !== "custom")
        throw new Error("Nezn\u00E1m\u00FD re\u017Eim \u0159azen\u00ED: ".concat(mode));
    var weights = {};
    for (var _i = 0, _a = Object.keys(spec.weights || {}).map(function (key) { return [key, spec.weights[key]]; }); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], w = _b[1];
        weights[key] = effectiveWeight(w);
    }
    var active = TABLES.criteria.filter(function (key) { return (weights[key] || 0) > 0; });
    var norm = {};
    var _loop_1 = function (key) {
        norm[key] = normalized(key, candidates.map(function (c, i) { return criterionValue(key, st, c, breakdowns[i]); }));
    };
    for (var _c = 0, active_1 = active; _c < active_1.length; _c++) {
        var key = active_1[_c];
        _loop_1(key);
    }
    if ((spec.normalization || "lexicographic") === "weighted") {
        var totals_1 = Array.apply(null, Array(n)).map(function (_, i) { return active.reduce(function (sum, key) { return sum + weights[key] * (norm[key][i] || 0); }, 0); });
        return stableOrder(n, function (i, j) { return compareDesc(totals_1[i], totals_1[j]); });
    }
    var order = __spreadArray([], active, true).sort(function (a, b) { return weights[b] - weights[a] || TABLES.criteria.indexOf(a) - TABLES.criteria.indexOf(b); });
    return stableOrder(n, function (i, j) {
        for (var _i = 0, order_1 = order; _i < order_1.length; _i++) {
            var key = order_1[_i];
            var c = compareDesc(norm[key][i], norm[key][j]);
            if (c)
                return c;
        }
        return 0;
    });
}
function sortBy(st, spec, items, candidateOf) {
    return sortOrder(st, spec, items.map(candidateOf)).map(function (i) { return items[i]; });
}
// ---------------------------------------------------------------- facety
// OR uvnitř dimenze, AND mezi dimenzemi; prázdný výsledek neprázdného filtru → vše a relaxed.
function applyFacets(filter, items, candidateOf) {
    if (candidateOf === void 0) { candidateOf = function (x) { return x; }; }
    var languages = filter.languages || [], resolutions = filter.resolutions || [], ranges = filter.dynamicRanges || [];
    var kept = items.filter(function (item) {
        var c = candidateOf(item);
        if (languages.length) {
            var A_1 = audioCodes(c), S_1 = subtitleCodes(c);
            if (!languages.some(function (t) { return (t.indexOf("audio_") === 0 && A_1.has(t.slice(6))) || (t.indexOf("sub_") === 0 && S_1.has(t.slice(4))); }))
                return false;
        }
        if (resolutions.length && !(known(c.qualityRank) && member(resolutions, c.qualityRank)))
            return false;
        if (ranges.length && !member(ranges, dynamicRange(c.hdr)))
            return false;
        return true;
    });
    if ((languages.length || resolutions.length || ranges.length) && !kept.length)
        return { items: items, relaxed: true };
    return { items: kept, relaxed: false };
}


// Wire fields match the modern picker; resolver metadata takes precedence.
function qualityRank(s) {
  if (s.scoring && known(s.scoring.quality_rank)) return s.scoring.quality_rank;
  var h = Number(s.video_height) || 0, q = String(s.quality || "").toLowerCase();
  if (h) return h >= 4320 ? 5 : h >= 2160 ? 4 : h >= 1440 ? 3 : h >= 1080 ? 2 : h >= 720 ? 1 : 0;
  return /4320|8k/.test(q) ? 5 : /2160|4k|uhd/.test(q) ? 4 : /1440|2k|qhd/.test(q) ? 3 : /1080|fhd|full ?hd/.test(q) ? 2 : /720|\bhd\b/.test(q) ? 1 : /480|576|360|\bsd\b/.test(q) ? 0 : null;
}
function candidate(s, runtimeMinutes) {
  var sc = s.scoring, runtime = runtimeMinutes > 0 ? runtimeMinutes * 60 : null;
  if (sc) return {
    qualityRank: known(sc.quality_rank) ? sc.quality_rank : null, hdr: sc.hdr || null,
    sizeBytes: sc.size_bytes > 0 ? sc.size_bytes : null, durationSeconds: sc.duration_seconds > 0 ? sc.duration_seconds : runtime,
    bitrateKbps: sc.bitrate_kbps > 0 ? sc.bitrate_kbps : null, videoCodec: sc.video_codec || null,
    audioTracks: (sc.audio_tracks || []).map(function(t) { return {language:t.language || null,codec:t.codec || null,channels:known(t.channels) ? t.channels : null}; }),
    subtitleTracks: (sc.subtitle_tracks || []).map(function(t) {return {language:t.language || null,forced:Boolean(t.forced)};}),
    is3D:Boolean(sc.is_3d),isDatabase:Boolean(sc.is_database)
  };
  var name=s.file_name || "", channels=channelsFromName(name), languages=[];
  (Array.isArray(s.audio_languages) ? s.audio_languages : s.audio_language ? [s.audio_language] : []).forEach(function(l) {
    String(l || "").split(/[,/+;|]/).forEach(function(v) {v=v.trim(); if(v) languages.push(v);});
  });
  var audio=languages.map(function(l) {return {language:l,codec:s.audio_codec || null,channels:channels};});
  if(!audio.length && s.audio_codec) audio.push({language:null,codec:s.audio_codec,channels:channels});
  return {qualityRank:qualityRank(s),hdr:s.hdr_type || null,sizeBytes:s.file_size > 0 ? s.file_size : null,
    durationSeconds:s.duration_seconds > 0 ? s.duration_seconds : runtime,bitrateKbps:s.bitrate_kbps > 0 ? s.bitrate_kbps : null,
    videoCodec:s.video_codec || null,audioTracks:audio,
    subtitleTracks:(Array.isArray(s.subtitle_languages) ? s.subtitle_languages : []).filter(Boolean).map(function(l) {return {language:l,forced:false};}),
    is3D:name.toLowerCase().split(/[^a-z0-9]+/).some(function(t) {return member(["3d","hsbs","hou","sbs"],t);}),isDatabase:s.origin < 2};
}
function settings(ctx) {
  return {linkSpeedMbps:typeof ctx.downlinkMbps === "number" && isFinite(ctx.downlinkMbps) && ctx.downlinkMbps > 0 ? ctx.downlinkMbps : null,
    qualityCap:known(ctx.qualityCap) ? ctx.qualityCap : null,displayMaxRank:known(ctx.displayMaxRank) ? ctx.displayMaxRank : null,
    primaryLanguage:languageCode(ctx.primaryLanguage),secondaryLanguage:languageCode(ctx.secondaryLanguage),forcedLanguage:null,
    audioCodecWhitelist:[],audioCodecBlacklist:[],videoCodecWhitelist:[],videoCodecBlacklist:[],preferHDR:Boolean(ctx.wideColor),excludeHDR:false,filters:{},runtimeMinutes:ctx.runtimeMinutes > 0 ? ctx.runtimeMinutes : null};
}
function recommended(streams, ctx, playable, identityMatches) {
  var st=settings(ctx);
  var options=streams.filter(function(s) {
    if(s.origin < 2 || s.available === false || !playable(s) || (s.relevance && s.relevance.bucket === "demoted")) return false;
    var c=candidate(s,ctx.runtimeMinutes);
    if(st.primaryLanguage && !c.audioTracks.some(function(t) {return languageCode(t.language) === st.primaryLanguage;})) return false;
    return s.relevance && s.relevance.bucket === "accepted" || identityMatches(s);
  });
  var ranked=sortBy(st,{mode:"recommended"},options,function(s) {return candidate(s,ctx.runtimeMinutes);});
  for(var i=0;i<ranked.length;i++) if(score(st,candidate(ranked[i],ctx.runtimeMinutes)).total >= 0) return ranked[i];
  return null;
}

return {candidate:candidate,settings:settings,recommended:recommended,qualityRank:qualityRank,TABLES:TABLES,languageCode:languageCode,codecKey:codecKey,dynamicRange:dynamicRange,channelsFromName:channelsFromName,effectiveBitrateMbps:effectiveBitrateMbps,parseRange:parseRange,score:score,sortOrder:sortOrder,sortBy:sortBy,applyFacets:applyFacets};
}));

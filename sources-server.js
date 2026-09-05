"use strict";
// Search heuristics shared by the native providers, using canonical catalog metadata.
const crypto = require("node:crypto");
const deaccent = (s) => s.normalize("NFD").replace(/\p{M}/gu, "");
const compact = (s) =>
  deaccent(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const unique = (values) => [
  ...new Map(values.filter(Boolean).map((s) => [s.toLowerCase(), s])).values(),
];
function names(title) {
  return unique(
    [
      title.title,
      title.original_title,
      ...Object.values(title.all_titles || {}).filter(
        (v) => typeof v === "string",
      ),
    ]
      .filter(Boolean)
      .flatMap((s) => {
        s = s.replace(/:/g, " ").replace(/\s+/g, " ").trim();
        const stripped = s.replace(/^(?:marvel|dc)['’]?\s+/i, "");
        return [
          s,
          deaccent(s),
          s.replace(/['’]/g, ""),
          stripped,
          deaccent(stripped),
        ];
      }),
  );
}
function queries(title, episode) {
  const titles = names(title),
    variants = (s) =>
      unique([
        s,
        s.replace(/ /g, "."),
        s.replace(/ /g, "-"),
        s.replace(/ /g, "_"),
      ]);
  if (episode) {
    const { season_number: s, episode_number: e } = episode;
    return unique(
      [
        `S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}`,
        `${s}x${String(e).padStart(2, "0")}`,
        `${s}x${e}`,
      ].flatMap((tag) => titles.flatMap((t) => variants(`${t} ${tag}`))),
    ).slice(0, 12);
  }
  const year = title.year || Number(title.release_date?.slice(0, 4));
  const groups = titles.map((t) => [
    ...variants(t),
    ...(year ? variants(`${t} ${year}`) : []),
  ]);
  return unique(
    Array.from({ length: 8 }, (_, i) => groups.map((g) => g[i])).flat(),
  ).slice(0, 12);
}
function matches(file, title, episode) {
  const n = file.file_name,
    size = file.file_size || 0;
  if (
    typeof n !== "string" ||
    /\.(?:rar|zip|7z|tar|gz|iso|srt|sub|txt|nfo|mp3|flac|wav|wma|aac|exe|bat|apk|msi|jpg|jpeg|png|bmp|gif|torrent)$/i.test(
      n,
    )
  )
    return false;
  if (
    !/\.(?:mp4|mkv|avi|mov|wmv|flv|webm|mpg|mpeg|ts|m4v)$/i.test(n) &&
    size <= 50 * 1024 ** 2
  )
    return false;
  if (!names(title).some((t) => compact(n).includes(compact(t)))) return false;
  const year = title.year || Number(title.release_date?.slice(0, 4)),
    years = [...n.matchAll(/(?:19|20)\d{2}/g)].map((x) => Number(x[0]));
  // Series episodes may be released years after the series premiere.
  if (
    !episode &&
    year &&
    years.length &&
    !years.some((y) => Math.abs(y - year) <= 1)
  )
    return false;
  if (episode) {
    const tags = [
      ...n.matchAll(
        /(?:s(\d{1,2})[ ._-]*e(\d{1,3})|(\d{1,2})x(\d{1,3}))(?!\d)/gi,
      ),
    ];
    if (
      !tags.some(
        (m) =>
          Number(m[1] || m[3]) === episode.season_number &&
          Number(m[2] || m[4]) === episode.episode_number,
      )
    )
      return false;
  }
  return true;
}
function metadata(n) {
  const langs = [];
  if (/\b(?:cz|cs|cze|czech|cesky)\b/i.test(deaccent(n))) langs.push("CS");
  if (/\b(?:sk|slo|slovak)\b/i.test(n)) langs.push("SK");
  if (/\b(?:en|eng|english)\b/i.test(n)) langs.push("EN");
  return {
    video_height: /2160|\b4k\b|uhd/i.test(n)
      ? 2160
      : /1080|fhd/i.test(n)
        ? 1080
        : /720/i.test(n)
          ? 720
          : null,
    video_codec: /[hx][ .]?265|hevc/i.test(n)
      ? "H.265"
      : /[hx][ .]?264|avc/i.test(n)
        ? "H.264"
        : /\bav1\b/i.test(n)
          ? "AV1"
          : null,
    hdr_type: /dolby.?vision|dovi|\bdv\b/i.test(n)
      ? "Dolby Vision"
      : /hdr10\+|hdr10plus/i.test(n)
        ? "HDR10+"
        : /hdr/i.test(n)
          ? "HDR"
          : null,
    audio_languages: langs,
  };
}
async function search(provider, title, episode, token, request) {
  const work = queries(title, episode),
    results = [],
    errors = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (next < work.length) {
        const q = work[next++];
        try {
          results.push(...(await request(provider, q, token)));
        } catch (e) {
          errors.push(e.message);
        }
      }
    }),
  );
  if (errors.length === work.length)
    throw Object.assign(new Error(unique(errors).join(" ")), { status: 502 });
  const seen = new Set();
  const streams = results
    .filter((f) => {
      if (!matches(f, title, episode) || seen.has(f.source_stream_id))
        return false;
      seen.add(f.source_stream_id);
      return true;
    })
    .map((f) => ({ ...f, ...metadata(f.file_name) }))
    .sort((a, b) => (b.video_height || 0) - (a.video_height || 0));
  return { streams, warnings: unique(errors), partial: errors.length > 0 };
}
function tickets(secret) {
  const sign = (s) =>
    crypto
      .createHmac("sha256", secret)
      .update("movly-source-v1:")
      .update(s)
      .digest("base64url");
  const owner = (s) =>
    crypto
      .createHash("sha256")
      .update(JSON.stringify([s.token, s.device, s.profile?.id, s.grant]))
      .digest("hex");
  return {
    issue(session, data) {
      const body = Buffer.from(
        JSON.stringify({
          ...data,
          owner: owner(session),
          expires: Date.now() + 12 * 60 * 60 * 1000,
        }),
      ).toString("base64url");
      return `${body}.${sign(body)}`;
    },
    read(session, ticket) {
      if (typeof ticket !== "string" || ticket.length > 4096)
        throw new Error("Neplatný zdroj.");
      const [body, sig, ...rest] = ticket.split(".");
      const expected = sign(body);
      if (
        rest.length ||
        !sig ||
        sig.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
      )
        throw new Error("Neplatný zdroj.");
      const data = JSON.parse(Buffer.from(body, "base64url"));
      if (data.owner !== owner(session) || data.expires < Date.now())
        throw new Error("Platnost zdroje vypršela. Vyhledej zdroje znovu.");
      return data;
    },
  };
}
module.exports = { names, queries, matches, metadata, search, tickets };

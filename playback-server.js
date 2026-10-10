"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns/promises");
const { spawn } = require("node:child_process");
const fail = (status, message) => Object.assign(new Error(message), { status });
function allowedURL(value, trustedProvider = false) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    (!trustedProvider &&
      !/^(?:[a-z0-9-]+\.)*(?:webshare\.cz|hellspy\.to)$/.test(url.hostname) &&
      url.hostname !== "sixseven.onecdn1.net")
  )
    throw fail(422, "Neplatný mediální server poskytovatele.");
  return url;
}
function publicIPv4(ip) {
  const a = ip.split(".").map(Number);
  return (
    a.length === 4 &&
    a.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    ![0, 10, 127].includes(a[0]) &&
    a[0] < 224 &&
    !(a[0] === 169 && a[1] === 254) &&
    !(a[0] === 172 && a[1] >= 16 && a[1] <= 31) &&
    !(a[0] === 192 && a[1] === 168) &&
    !(a[0] === 100 && a[1] >= 64 && a[1] <= 127) &&
    !(a[0] === 198 && [18, 19].includes(a[1]))
  );
}
async function mediaRequest(value, range, options = {}, redirects = 0) {
  const url = allowedURL(value, options.trustedProvider === true);
  const headers = {};
  for (const [key, value] of Object.entries(options.headers || {})) {
    if (
      !/^(user-agent|referer|cookie)$/i.test(key) ||
      typeof value !== "string" ||
      /[\r\n]/.test(value)
    )
      continue;
    if (
      key.toLowerCase() === "cookie" &&
      url.hostname !== options.credentialHost &&
      !(
        options.credentialHost?.endsWith("fastshare.cz") &&
        /^(?:[a-z0-9-]+\.)*fastshare\.cz$/.test(url.hostname)
      )
    )
      continue;
    headers[key] = value;
  }
  if (range) headers.Range = range;
  // Use the OS resolver so a long-lived local app follows network/VPN changes.
  // c-ares resolve4 retains the nameservers from process startup on macOS.
  // Still pin the connection to the validated public IPv4 answers below.
  const addresses = (await dns.lookup(url.hostname, { family: 4, all: true }))
    .map(answer => answer.address);
  if (!addresses.length || !addresses.every(publicIPv4))
    throw fail(422, "Mediální server má nepovolenou adresu.");
  return await new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers,
        // Node's connection family selection may request lookup({ all: true }).
        // Returning the legacy scalar shape in that case fails on newer Node.
        lookup: (_host, opts, cb) => opts.all
          ? cb(null, addresses.map(address => ({ address, family: 4 })))
          : cb(null, addresses[0], 4),
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          if (redirects >= 3)
            return reject(fail(502, "Příliš mnoho přesměrování zdroje."));
          try {
            resolve(
              mediaRequest(
                new URL(res.headers.location, url).href,
                range,
                {
                  ...options,
                  credentialHost: options.credentialHost || url.hostname,
                },
                redirects + 1,
              ),
            );
          } catch (e) {
            reject(e);
          }
        } else resolve(res);
      },
    );
    req.setTimeout(20000, () =>
      req.destroy(fail(504, "Mediální server neodpovídá.")),
    );
    req.on("error", reject);
  });
}
function rewritePlaylist(text, map) {
  if (!text.trimStart().startsWith("#EXTM3U"))
    throw fail(502, "Neplatný HLS playlist.");
  if (/#EXT-X-SESSION-DATA:.*URI=|#EXT-X-CONTENT-STEERING/i.test(text))
    throw fail(422, "Nepodporovaný externí HLS zdroj.");
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;
      if (!line.startsWith("#")) return map(line.trim());
      return line.replace(/URI="([^"]+)"/g, (_all, uri) => `URI="${map(uri)}"`);
    })
    .join("\n");
}
function mediaPlan(info, audio = 0, subtitle = -1, options = {}) {
  const video = info.streams.find((s) => s.codec_type === "video");
  const track = info.streams.filter((s) => s.codec_type === "audio")[audio];
  const sub = info.streams.filter((s) => s.codec_type === "subtitle")[subtitle];
  const bitmap =
    sub &&
    ["hdmv_pgs_subtitle", "dvd_subtitle", "xsub"].includes(sub.codec_name);
  const hdr = ["smpte2084", "arib-std-b67"].includes(video?.color_transfer);
  const dovi = video?.side_data_list?.find((s) =>
    /dovi/i.test(s.side_data_type || ""),
  );
  const native = options.videoMode === "native";
  const capabilities = options.capabilities || {};
  const width = [1280, 1920, 3840].includes(options.maxWidth)
    ? options.maxWidth
    : 1280;
  const copyVideo =
    (native || !video?.width || video.width <= width) &&
    !bitmap &&
    (!hdr || native) &&
    (!dovi || (native && capabilities.dolbyVision === true)) &&
    (video?.codec_name === "h264" ||
      (video?.codec_name === "hevc" && native && capabilities.hevc === true));
  if (dovi?.dv_profile === 5 && !copyVideo)
    throw fail(
      422,
      "Tento Dolby Vision zdroj vyžaduje prohlížeč s nativní podporou. Zvol jiný zdroj.",
    );
  const requestedChannels =
    options.audioMode === "surround" && capabilities.aacMultichannel === true
      ? Math.min(8, Math.max(2, track?.channels || 2))
      : 2;
  const copyAudio =
    !options.audioDelay &&
    options.audioMode === "native" &&
    ((track?.codec_name === "aac" &&
      ((track.channels || 2) <= 2 || capabilities.aacMultichannel === true)) ||
      (track?.codec_name === "ac3" && capabilities.ac3 === true) ||
      (track?.codec_name === "eac3" && capabilities.eac3 === true));
  const fmp4 =
    (copyVideo && video?.codec_name === "hevc") ||
    (copyAudio && ["ac3", "eac3"].includes(track?.codec_name));
  return {
    video,
    track,
    bitmap: Boolean(bitmap),
    hdr,
    dovi,
    copyVideo,
    copyAudio,
    width,
    channels: copyAudio ? track.channels : requestedChannels,
    fmp4: Boolean(fmp4),
  };
}
function ffmpegArgs(
  input,
  output,
  info,
  offset = 0,
  audio = 0,
  subtitle = -1,
  options = {},
) {
  const plan = mediaPlan(info, audio, subtitle, options);
  const filters = [];
  if (plan.hdr && !plan.copyVideo)
    filters.push(
      "zscale=t=linear:npl=100",
      "format=gbrpf32le",
      "zscale=p=bt709",
      "tonemap=tonemap=hable:desat=0",
      "zscale=t=bt709:m=bt709:r=tv",
    );
  filters.push(`scale=w='min(${plan.width},iw)':h=-2`, "format=yuv420p");
  const args = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-threads",
    "2",
    "-filter_threads",
    "1",
    "-format_whitelist",
    "matroska,mov,mpegts,avi,hls,aac",
    "-protocol_whitelist",
    "http,tcp,crypto",
    "-rw_timeout",
    "20000000",
    "-ss",
    String(offset),
    "-readrate",
    String(Math.max(1, options.playbackRate || 1)),
    "-i",
    input,
  ];
  if (plan.bitmap)
    args.push(
      "-filter_complex",
      `[0:v:0]${filters.slice(0, -2).join(",") || "null"}[base];[base][0:s:${subtitle}]overlay=eof_action=pass:shortest=0,${filters.slice(-2).join(",")}[video]`,
      "-map",
      "[video]",
    );
  else args.push("-map", "0:v:0");
  args.push("-map", `0:a:${audio}?`);
  if (plan.copyVideo) {
    args.push("-c:v", "copy");
    if (plan.video.codec_name === "hevc")
      args.push("-tag:v", plan.dovi ? "dvh1" : "hvc1");
  } else {
    args.push(
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-preset",
      "ultrafast",
      "-crf",
      "23",
    );
    if (!plan.bitmap) args.push("-vf", filters.join(","));
    args.push("-force_key_frames", "expr:gte(t,n_forced*4)");
  }
  if (
    options.audioDelay &&
    info.streams.some((s) => s.codec_type === "audio")
  ) {
    const seconds = options.audioDelay / 1000;
    args.push(
      "-af",
      seconds > 0
        ? "adelay=" + options.audioDelay + ":all=1"
        : "atrim=start=" + -seconds + ",asetpts=PTS-STARTPTS",
    );
  }
  if (plan.copyAudio) args.push("-c:a", "copy");
  else
    args.push(
      "-c:a",
      "aac",
      "-ac",
      String(plan.channels),
      "-b:a",
      plan.channels > 2 ? "512k" : "192k",
    );
  if (subtitle < 0 || plan.bitmap) args.push("-sn");
  else
    args.push(
      "-map",
      `0:s:${subtitle}`,
      "-c:s",
      "webvtt",
      "-var_stream_map",
      `v:0,${info.streams.some((s) => s.codec_type === "audio") ? "a:0," : ""}s:0,sgroup:subtitle`,
      "-master_pl_name",
      "master.m3u8",
    );
  args.push(
    "-f",
    "hls",
    "-hls_time",
    "4",
    "-hls_list_size",
    "30",
    "-hls_flags",
    "delete_segments+temp_file",
    "-hls_delete_threshold",
    "4",
  );
  if (plan.fmp4)
    args.push(
      "-hls_segment_type",
      "fmp4",
      "-hls_fmp4_init_filename",
      "init.mp4",
    );
  args.push(output);
  return args;
}
function offlineExportArgs(
  input,
  output,
  info,
  audio = 0,
  maxBytes = 2 * 1024 ** 3,
) {
  const base = ffmpegArgs(input, output, info, 0, audio, -1);
  const args = base.slice(0, base.lastIndexOf("-f"));
  const realtime = args.indexOf("-readrate");
  if (realtime >= 0) args.splice(realtime, 2);
  return [
    ...args,
    "-fs",
    String(maxBytes),
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    output,
  ];
}
function createPlayback({ requestMedia = mediaRequest } = {}) {
  const sessions = new Map();
  let proxy,
    port,
    starting = false;
  const owner = (s) =>
    crypto
      .createHash("sha256")
      .update(`${s.token}:${s.device}:${s.profile.id}:${s.grant}`)
      .digest("hex");
  async function stop(p) {
    if (!p) return;
    sessions.delete(p.id);
    p.child?.kill("SIGKILL");
    await fs.rm(p.dir, { recursive: true, force: true });
  }
  const timer = setInterval(() => {
    for (const p of sessions.values())
      if (Date.now() - p.touched > 180000) stop(p).catch(() => {});
  }, 30000);
  timer.unref();
  let proxyInitialization;
  async function init() {
    if (port) return;
    if (!proxyInitialization)
      proxyInitialization = initializeProxy().catch((error) => {
        proxyInitialization = null;
        throw error;
      });
    await proxyInitialization;
  }
  async function initializeProxy() {
    if (port) return;
    proxy = http.createServer(async (req, res) => {
      const [sessionID, resourceID] = req.url.slice(1).split("/");
      const p = sessions.get(sessionID);
      if (!p) {
        res.writeHead(404).end();
        return;
      }
      try {
        const range = req.headers.range;
        if (range && !/^bytes=\d+-\d*$/.test(range)) {
          res.writeHead(416).end();
          return;
        }
        const resourceURL = resourceID ? p.resources.get(resourceID) : p.url;
        if (!resourceURL) {
          res.writeHead(404).end();
          return;
        }
        const upstream = await requestMedia(resourceURL, range, p.mediaOptions);
        const isPlaylist =
          /mpegurl/i.test(upstream.headers["content-type"] || "") ||
          /\.m3u8(?:[?#]|$)/i.test(resourceURL);
        if (isPlaylist && upstream.statusCode === 200) {
          let bytes = 0,
            chunks = [];
          for await (const chunk of upstream) {
            bytes += chunk.length;
            if (bytes > 1024 * 1024) {
              upstream.destroy();
              throw fail(502, "Playlist je příliš velký.");
            }
            chunks.push(chunk);
          }
          const map = (value) => {
            const remote = allowedURL(
              new URL(value, resourceURL).href,
              p.mediaOptions.trustedProvider,
            ).href;
            let id = p.resourceIDs.get(remote);
            if (!id) {
              if (p.resources.size >= 20000)
                throw fail(502, "Příliš mnoho částí zdroje.");
              // FFmpeg 8 checks HLS segment extensions before fetching them.
              // Keep a known media suffix while the opaque ID still identifies
              // only a URL already validated and registered by this proxy.
              const suffix = /\.(?:m3u8|ts|m4s|mp4|aac|vtt|webvtt|key|cmfv|cmfa|fmp4)$/i
                .exec(new URL(remote).pathname)?.[0].toLowerCase() || "";
              id = crypto.randomBytes(16).toString("hex") + suffix;
              p.resources.set(id, remote);
              p.resourceIDs.set(remote, id);
            }
            return `http://127.0.0.1:${port}/${p.id}/${id}`;
          };
          const text = rewritePlaylist(
            Buffer.concat(chunks).toString("utf8"),
            map,
          );
          res.writeHead(200, {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Content-Length": Buffer.byteLength(text),
          });
          res.end(text);
          return;
        }
        const headers = {};
        for (const k of [
          "content-length",
          "content-range",
          "content-type",
          "accept-ranges",
        ])
          if (upstream.headers[k]) headers[k] = upstream.headers[k];
        res.writeHead(upstream.statusCode, headers);
        upstream.pipe(res);
        res.on("close", () => upstream.destroy());
        upstream.on("error", () => res.destroy());
      } catch {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      }
    });
    await new Promise((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(0, "127.0.0.1", resolve);
    });
    proxy.unref();
    port = proxy.address().port;
  }
  async function probe(input) {
    return await new Promise((resolve, reject) => {
      const proc = spawn(
        "ffprobe",
        [
          "-v",
          "error",
          "-format_whitelist",
          "matroska,mov,mpegts,avi,hls,aac",
          "-protocol_whitelist",
          "http,tcp,crypto",
          "-rw_timeout",
          "15000000",
          "-show_format",
          "-show_streams",
          "-show_chapters",
          "-of",
          "json",
          input,
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      let text = "";
      const timeout = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(fail(504, "Analýza videa překročila časový limit."));
      }, 25000);
      proc.stdout.on("data", (d) => {
        text += d;
        if (text.length > 1000000) proc.kill("SIGKILL");
      });
      proc.on("error", () => {
        clearTimeout(timeout);
        reject(fail(503, "Přehrávací služba není dostupná."));
      });
      proc.on("close", (code) => {
        clearTimeout(timeout);
        try {
          if (code !== 0) throw 0;
          resolve(JSON.parse(text));
        } catch {
          reject(fail(422, "Soubor se nepodařilo otevřít jako video."));
        }
      });
    });
  }
  async function analyze(s, url, options = {}) {
    allowedURL(url, options.trustedProvider === true);
    if (sessions.size >= 5) throw fail(429, "Analýza videa je vytížená.");
    await init();
    const p = {
      id: crypto.randomBytes(24).toString("hex"),
      owner: owner(s),
      url,
      mediaOptions: { ...options, credentialHost: new URL(url).hostname },
      resources: new Map(),
      resourceIDs: new Map(),
      dir: await fs.mkdtemp(path.join(os.tmpdir(), "movly-probe-")),
      touched: Date.now(),
      analyzing: true,
    };
    sessions.set(p.id, p);
    try {
      return await probe(`http://127.0.0.1:${port}/${p.id}`);
    } finally {
      await stop(p);
    }
  }
  async function start(s, url, options = {}) {
    if (starting)
      throw fail(
        429,
        "Jiné přehrávání se právě připravuje. Zkus to za chvíli.",
      );
    const who = owner(s);
    if ([...sessions.values()].some((p) => p.owner !== who))
      throw fail(
        429,
        "Webový přehrávač právě využívá jiný uživatel. Zkus to za chvíli.",
      );
    starting = true;
    let p;
    try {
      allowedURL(url, options.trustedProvider === true);
      for (const previous of sessions.values())
        if (!previous.analyzing) await stop(previous);
      await init();
      p = {
        id: crypto.randomBytes(24).toString("hex"),
        owner: who,
        url,
        mediaOptions: {
          trustedProvider: options.trustedProvider === true,
          headers: options.headers,
          credentialHost: new URL(url).hostname,
        },
        resources: new Map(),
        resourceIDs: new Map(),
        dir: await fs.mkdtemp(path.join(os.tmpdir(), "movly-play-")),
        touched: Date.now(),
      };
      sessions.set(p.id, p);
      const input = `http://127.0.0.1:${port}/${p.id}`;
      let info;
      try { info = await probe(input); }
      catch (error) { error.diagnosticStage = "video_analysis"; throw error; }
      if (!info.streams?.some((t) => t.codec_type === "video"))
        throw Object.assign(fail(422, "Soubor neobsahuje video."), { diagnosticStage: "video_analysis" });
      const duration = Number(info.format?.duration);
      if (!Number.isFinite(duration) || duration <= 0)
        throw Object.assign(fail(422, "Zdroj neobsahuje platnou délku videa."), { diagnosticStage: "video_analysis" });
      const offset = Number(options.offset || 0),
        tracks = info.streams.filter((t) => t.codec_type === "audio");
      const trackKey = t => JSON.stringify([t.tags?.language || null, t.tags?.title || null, t.codec_name || null]);
      const audioMatch = typeof options.audioSelector === "string" ? tracks.findIndex(t => trackKey(t) === options.audioSelector) : -1;
      const audio = options.audioSelector ? Math.max(0, audioMatch) : Number(options.audio || 0);
      if (
        !Number.isFinite(offset) ||
        offset < 0 ||
        offset >= duration ||
        !Number.isInteger(audio) ||
        audio < 0 ||
        audio >= Math.max(1, tracks.length)
      )
        throw fail(400, "Neplatná pozice nebo zvuková stopa.");
      const subtitles = info.streams.filter((t) => t.codec_type === "subtitle");
      const subtitle =
        options.subtitleSelector === "off" ? -1 : typeof options.subtitleSelector === "string"
          ? subtitles.findIndex(t => trackKey(t) === options.subtitleSelector)
          : options.subtitle === undefined ? -1 : Number(options.subtitle);
      const textCodecs = ["subrip", "ass", "ssa", "webvtt", "mov_text", "text"];
      if (
        !Number.isInteger(subtitle) ||
        subtitle < -1 ||
        subtitle >= subtitles.length
      )
        throw fail(400, "Neplatná titulková stopa.");
      if (
        subtitle >= 0 &&
        ![...textCodecs, "hdmv_pgs_subtitle", "dvd_subtitle", "xsub"].includes(
          subtitles[subtitle].codec_name,
        )
      )
        throw fail(422, "Tato titulková stopa není podporovaná.");
      p.info = info;
      p.offset = offset;
      p.audio = audio;
      const plan = mediaPlan(info, audio, subtitle, options);
      p.subtitle = plan.bitmap ? -1 : subtitle;
      p.duration = duration;
      p.offlineExport = options.offlineExport === true;
      p.maxBytes = [1, 2, 4, 8]
        .map((n) => n * 1024 ** 3)
        .includes(options.maxBytes)
        ? options.maxBytes
        : 2 * 1024 ** 3;
      if (p.offlineExport && (!Number.isFinite(duration) || duration <= 0))
        throw fail(422, "Pro offline knihovnu musí mít zdroj známou délku.");
      p.child = spawn(
        "ffmpeg",
        p.offlineExport
          ? offlineExportArgs(
              input,
              path.join(p.dir, "export.mp4"),
              info,
              audio,
              p.maxBytes,
            )
          : ffmpegArgs(
              input,
              path.join(p.dir, "index.m3u8"),
              info,
              offset,
              audio,
              subtitle,
              options,
            ),
        { stdio: ["ignore", "ignore", "ignore"] },
      );
      p.child.on("error", () => {
        p.error = "Přehrávací služba není dostupná.";
      });
      p.child.on("close", async (code) => {
        if (code !== 0)
          p.error = "Převod videa se přerušil. Vyber zdroj znovu.";
        if (p.offlineExport && code === 0) {
          try {
            const exportedDuration = await new Promise((resolve, reject) => {
              const probe = spawn(
                "ffprobe",
                [
                  "-v",
                  "error",
                  "-show_entries",
                  "format=duration",
                  "-of",
                  "json",
                  path.join(p.dir, "export.mp4"),
                ],
                { stdio: ["ignore", "pipe", "ignore"] },
              );
              let data = "";
              const timer = setTimeout(() => {
                probe.kill("SIGKILL");
                reject(new Error("validation timeout"));
              }, 10000);
              probe.stdout.on("data", (chunk) => {
                data += chunk;
                if (data.length > 8192) probe.kill("SIGKILL");
              });
              probe.on("error", (error) => {
                clearTimeout(timer);
                reject(error);
              });
              probe.on("close", (status) => {
                clearTimeout(timer);
                try {
                  if (status !== 0) throw new Error("invalid export");
                  resolve(Number(JSON.parse(data).format.duration));
                } catch (error) {
                  reject(error);
                }
              });
            });
            if (
              !Number.isFinite(exportedDuration) ||
              exportedDuration < p.duration - 2
            )
              p.error = "Převod neobsahuje celé video. Stažení nebylo přijato.";
            if (!p.error) {
              const hash = crypto.createHash("sha256");
              for await (const chunk of createReadStream(
                path.join(p.dir, "export.mp4"),
              ))
                hash.update(chunk);
              p.exportHash = hash.digest("hex");
            }
          } catch {
            p.error = "Úplnost offline videa se nepodařilo ověřit.";
          }
        }
        p.finished = true;
      });
      return {
        id: p.id,
        duration,
        offset,
        chapters: (info.chapters || [])
          .map((chapter) => ({
            start: Number(chapter.start_time),
            end: Number(chapter.end_time),
            name: chapter.tags?.title || "",
          }))
          .filter(
            (chapter) =>
              Number.isFinite(chapter.start) &&
              Number.isFinite(chapter.end) &&
              chapter.start >= 0 &&
              chapter.end > chapter.start &&
              chapter.end <= duration + 1,
          ),
        mode: plan.copyVideo ? "remux" : "transcode",
        quality: {
          originalVideo: plan.copyVideo,
          hdr: plan.hdr && plan.copyVideo,
          dolbyVision: Boolean(plan.dovi && plan.copyVideo),
          maxWidth: plan.copyVideo ? plan.video.width : plan.width,
          audio: plan.copyAudio ? "original" : "aac",
          audioChannels: plan.channels,
          subtitles: plan.bitmap ? "burned" : subtitle >= 0 ? "text" : "off",
        },
        selected_audio: audio,
        selected_subtitle: subtitle,
        audio: tracks.map((t, index) => ({
          index,
          language: t.tags?.language || null,
          name: t.tags?.title || null,
          codec: t.codec_name,
        })),
        subtitles: subtitles.map((t, index) => ({
          index,
          language: t.tags?.language || null,
          name: t.tags?.title || null,
          codec: t.codec_name,
          supported: [
            ...textCodecs,
            "hdmv_pgs_subtitle",
            "dvd_subtitle",
            "xsub",
          ].includes(t.codec_name),
        })),
        playlist: `/api/app/playback/${p.id}/${p.subtitle >= 0 ? "master" : "index"}.m3u8`,
      };
    } catch (e) {
      await stop(p);
      throw e;
    } finally {
      starting = false;
    }
  }
  async function handle(s, req, res, id, file) {
    const p = sessions.get(id);
    if (!p || p.owner !== owner(s))
      throw fail(404, "Přehrávání vypršelo. Otevři zdroj znovu.");
    p.touched = Date.now();
    if (req.method === "DELETE") {
      await stop(p);
      return { stopped: true };
    }
    if (file === "status") {
      const exportSize = p.offlineExport
        ? await fs.stat(path.join(p.dir, "export.mp4")).then(
            (x) => x.size,
            () => 0,
          )
        : null;
      if (p.offlineExport && exportSize >= p.maxBytes)
        p.error =
          "Video přesahuje zvolený limit offline souboru. Zvol vyšší limit nebo menší zdroj.";
      return {
        ready: p.offlineExport
          ? p.finished && !p.error
          : await fs
              .stat(
                path.join(
                  p.dir,
                  p.subtitle >= 0 ? "master.m3u8" : "index.m3u8",
                ),
              )
              .then(
                () => true,
                () => false,
              ),
        error: p.error || null,
        finished: Boolean(p.finished),
        size: exportSize,
        etag: p.exportHash || null,
      };
    }
    if (file === "export.mp4" && p.offlineExport && p.finished && !p.error) {
      const filename = path.join(p.dir, "export.mp4"),
        stat = await fs.stat(filename);
      if (stat.size >= p.maxBytes)
        throw fail(422, "Video překročilo limit offline knihovny.");
      const etag = '"' + p.exportHash + '"';
      const match = /^bytes=(\d+)-$/.exec(req.headers?.range || "");
      const start =
        match && req.headers?.["if-range"] === etag ? Number(match[1]) : 0;
      if (!Number.isSafeInteger(start) || start < 0 || start >= stat.size)
        throw fail(416, "Neplatný rozsah stažení.");
      res.writeHead(start ? 206 : 200, {
        "Content-Type": "video/mp4",
        "Content-Length": stat.size - start,
        "Accept-Ranges": "bytes",
        ETag: etag,
        ...(start
          ? {
              "Content-Range":
                "bytes " + start + "-" + (stat.size - 1) + "/" + stat.size,
            }
          : {}),
        "Cache-Control": "private, no-store",
      });
      const stream = createReadStream(filename, { start });
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
      return null;
    }
    if (
      !/^(?:(?:index|index_vtt|master)\.m3u8|(?:init\.mp4|index\d+\.(?:ts|vtt|m4s)))$/.test(
        file,
      )
    )
      throw fail(404, "Neplatný segment.");
    const filename = path.join(p.dir, file);
    const stat = await fs.stat(filename).catch(() => null);
    if (!stat)
      throw fail(p.error ? 422 : 503, p.error || "Video se připravuje.");
    res.writeHead(200, {
      "Content-Type": file.endsWith("m3u8")
        ? "application/vnd.apple.mpegurl"
        : file.endsWith("vtt")
          ? "text/vtt; charset=utf-8"
          : file.endsWith("mp4") || file.endsWith("m4s")
            ? "video/mp4"
            : "video/mp2t",
      "Content-Length": stat.size,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const stream = createReadStream(filename);
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
    return null;
  }
  async function close() {
    clearInterval(timer);
    for (const p of sessions.values()) await stop(p);
    if (proxy) await new Promise((resolve) => proxy.close(resolve));
  }
  return { start, analyze, handle, close };
}
module.exports = {
  rewritePlaylist,
  createPlayback,
  allowedURL,
  publicIPv4,
  ffmpegArgs,
  offlineExportArgs,
  mediaRequest,
  mediaPlan,
};

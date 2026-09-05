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
function allowedURL(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !/^(?:[a-z0-9-]+\.)*(?:webshare\.cz|hellspy\.to)$/.test(url.hostname)
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
async function mediaRequest(value, range, redirects = 0) {
  const url = allowedURL(value);
  const addresses = await dns.resolve4(url.hostname);
  if (!addresses.length || !addresses.every(publicIPv4))
    throw fail(422, "Mediální server má nepovolenou adresu.");
  return await new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: range ? { Range: range } : {},
        lookup: (_host, _opts, cb) => cb(null, addresses[0], 4),
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
function ffmpegArgs(input, output, info, offset = 0, audio = 0, subtitle = -1) {
  const copy =
    info.streams.find((s) => s.codec_type === "video")?.codec_name === "h264";
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-threads",
    "2",
    "-filter_threads",
    "1",
    "-format_whitelist",
    "matroska,mov,mpegts,avi",
    "-protocol_whitelist",
    "http,tcp",
    "-rw_timeout",
    "20000000",
    "-ss",
    String(offset),
    "-re",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    `0:a:${audio}?`,
    ...(copy
      ? ["-c:v", "copy"]
      : [
          "-c:v",
          "libx264",
          "-threads",
          "2",
          "-preset",
          "ultrafast",
          "-crf",
          "23",
          "-vf",
          "scale=w='min(1280,iw)':h=-2,format=yuv420p",
          "-force_key_frames",
          "expr:gte(t,n_forced*4)",
        ]),
    "-c:a",
    "aac",
    "-ac",
    "2",
    "-b:a",
    "192k",
    ...(subtitle < 0
      ? ["-sn"]
      : [
          "-map",
          `0:s:${subtitle}`,
          "-c:s",
          "webvtt",
          "-var_stream_map",
          `v:0,${info.streams.some((s) => s.codec_type === "audio") ? "a:0," : ""}s:0,sgroup:subtitle`,
          "-master_pl_name",
          "master.m3u8",
        ]),
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
  async function init() {
    if (port) return;
    proxy = http.createServer(async (req, res) => {
      const p = sessions.get(req.url.slice(1));
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
        const upstream = await requestMedia(p.url, range);
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
      allowedURL(url);
      for (const previous of sessions.values()) await stop(previous);
      await init();
      p = {
        id: crypto.randomBytes(24).toString("hex"),
        owner: who,
        url,
        dir: await fs.mkdtemp(path.join(os.tmpdir(), "movly-play-")),
        touched: Date.now(),
      };
      sessions.set(p.id, p);
      const input = `http://127.0.0.1:${port}/${p.id}`;
      const info = await new Promise((resolve, reject) => {
        const proc = spawn(
          "ffprobe",
          [
            "-v",
            "error",
            "-format_whitelist",
            "matroska,mov,mpegts,avi",
            "-protocol_whitelist",
            "http,tcp",
            "-rw_timeout",
            "15000000",
            "-show_format",
            "-show_streams",
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
      if (!info.streams?.some((t) => t.codec_type === "video"))
        throw fail(422, "Soubor neobsahuje video.");
      const duration = Number(info.format?.duration);
      if (!Number.isFinite(duration) || duration <= 0)
        throw fail(422, "Zdroj neobsahuje platnou délku videa.");
      const offset = Number(options.offset || 0),
        audio = Number(options.audio || 0),
        tracks = info.streams.filter((t) => t.codec_type === "audio");
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
        options.subtitle === undefined ? -1 : Number(options.subtitle);
      const textCodecs = ["subrip", "ass", "ssa", "webvtt", "mov_text", "text"];
      if (
        !Number.isInteger(subtitle) ||
        subtitle < -1 ||
        subtitle >= subtitles.length
      )
        throw fail(400, "Neplatná titulková stopa.");
      if (subtitle >= 0 && !textCodecs.includes(subtitles[subtitle].codec_name))
        throw fail(422, "Tyto titulky jsou obrazové; vyber textovou stopu.");
      p.info = info;
      p.offset = offset;
      p.audio = audio;
      p.subtitle = subtitle;
      p.duration = duration;
      p.child = spawn(
        "ffmpeg",
        ffmpegArgs(
          input,
          path.join(p.dir, "index.m3u8"),
          info,
          offset,
          audio,
          subtitle,
        ),
        { stdio: ["ignore", "ignore", "ignore"] },
      );
      p.child.on("error", () => {
        p.error = "Přehrávací služba není dostupná.";
      });
      p.child.on("close", (code) => {
        p.finished = true;
        if (code !== 0)
          p.error = "Převod videa se přerušil. Vyber zdroj znovu.";
      });
      return {
        id: p.id,
        duration,
        offset,
        mode:
          info.streams.find((t) => t.codec_type === "video").codec_name ===
          "h264"
            ? "remux"
            : "transcode",
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
          supported: textCodecs.includes(t.codec_name),
        })),
        playlist: `/api/app/playback/${p.id}/${subtitle >= 0 ? "master" : "index"}.m3u8`,
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
    if (file === "status")
      return {
        ready: await fs
          .stat(
            path.join(p.dir, p.subtitle >= 0 ? "master.m3u8" : "index.m3u8"),
          )
          .then(
            () => true,
            () => false,
          ),
        error: p.error || null,
        finished: Boolean(p.finished),
      };
    if (
      !/^(?:(?:index|index_vtt|master)\.m3u8|index\d+\.(?:ts|vtt))$/.test(file)
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
  return { start, handle, close };
}
module.exports = { createPlayback, allowedURL, publicIPv4, ffmpegArgs };

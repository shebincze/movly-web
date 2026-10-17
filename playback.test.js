"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Writable } = require("node:stream");
const { finished } = require("node:stream/promises");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { md5crypt } = require("./providers-server");
const {
  bufferableSegment,
  readSegment,
  createPlayback,
  allowedURL,
  publicIPv4,
  ffmpegArgs,
} = require("./playback-server");
test("provider password hashing matches published MD5 crypt vector", () => {
  assert.equal(
    md5crypt("password", "saltqwer"),
    "$1$saltqwer$yCutmodwBoXKLyFtgW5r31",
  );
});
test("playback only accepts provider HTTPS origins and publicly routed IPv4", () => {
  for (const url of [
    "http://webshare.cz/a",
    "https://evil.test/a",
    "https://webshare.cz.evil.test/a",
    "https://user:pass@webshare.cz/a",
    "https://webshare.cz:444/a",
  ])
    assert.throws(() => allowedURL(url));
  assert.equal(
    allowedURL("https://h1.webshare.cz/file").hostname,
    "h1.webshare.cz",
  );
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.18.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
  ])
    assert.equal(publicIPv4(ip), false, ip);
  assert.equal(publicIPv4("8.8.8.8"), true);
});
test("VOD HLS through the protected proxy retains segment extensions and probes real tracks", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "movly-hls-probe-"));
  const requests = [];
  const engine = createPlayback({ requestMedia: async url => {
    const name = path.basename(new URL(url).pathname);
    assert.match(name, /^(?:master|index)\.m3u8$|^index\d+\.ts$/);
    requests.push(name);
    const file = path.join(dir, name), stream = createReadStream(file);
    stream.statusCode = 200;
    stream.headers = { "content-type": name.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t",
      "content-length": String((await fs.stat(file)).size) };
    return stream;
  } });
  try {
    const generated = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-threads", "1", "-g", "24", "-c:a", "aac", "-f", "hls", "-hls_time", "1", "-hls_playlist_type", "vod",
      path.join(dir, "index.m3u8")], { timeout: 15000 });
    assert.equal(generated.status, 0, generated.stderr?.toString());
    await fs.writeFile(path.join(dir, "master.m3u8"), "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nindex.m3u8\n");
    const info = await engine.analyze({ token: "local", device: "local", profile: { id: 1 } },
      "https://provider.test/master.m3u8", { trustedProvider: true });
    assert.ok(Number(info.format.duration) >= 1.9);
    assert.ok(info.streams.some(s => s.codec_type === "video" && s.codec_name === "h264"));
    assert.ok(info.streams.some(s => s.codec_type === "audio" && s.codec_name === "aac"));
    assert.ok(requests.some(name => name.endsWith(".ts")));
  } finally { await engine.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
test("HLS segments are buffered whole and independent of the FFmpeg read pace (#145)", async () => {
  const { Readable } = require("node:stream");
  const upstream = (bytes, headers = {}, statusCode = 200) => Object.assign(Readable.from([Buffer.alloc(bytes, 1)]),
    { statusCode, headers: { "content-length": String(bytes), ...headers } });
  assert.equal(bufferableSegment(upstream(10), undefined), true);
  assert.equal(bufferableSegment(upstream(10), "bytes=0-"), true);
  assert.equal(bufferableSegment(upstream(10, { "content-range": "bytes 0-9/10" }, 206), "bytes=0-"), true);
  assert.equal(bufferableSegment(upstream(10), "bytes=5-"), false, "a resumed Range read stays streamed");
  assert.equal(bufferableSegment(upstream(10, { "content-range": "bytes 5-9/10" }, 206), undefined), false);
  assert.equal(bufferableSegment(upstream(10, { "content-length": "" }), undefined), false, "unknown size stays streamed");
  assert.equal(bufferableSegment(upstream(11), undefined, 10), false, "over the limit stays streamed");
  assert.equal(bufferableSegment(upstream(10, {}, 404), undefined), false);
  assert.equal((await readSegment(upstream(3 * 1024 * 1024))).length, 3 * 1024 * 1024);
  const short = Object.assign(Readable.from([Buffer.alloc(5)]), { statusCode: 200, headers: { "content-length": "10" } });
  await assert.rejects(readSegment(short), /předčasně/);
});
test("a provider that drops a HLS segment midway is retried once and FFmpeg receives the whole segment (#145)", async () => {
  const { Readable } = require("node:stream");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "movly-hls-drop-"));
  const segmentRequests = new Map();
  const engine = createPlayback({ requestMedia: async url => {
    const name = path.basename(new URL(url).pathname), file = path.join(dir, name);
    const data = await fs.readFile(file), headers = { "content-type": name.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t", "content-length": String(data.length) };
    const count = (segmentRequests.get(name) || 0) + 1;
    if (name.endsWith(".ts")) segmentRequests.set(name, count);
    // The first read of each segment ends prematurely, as the ČT CDN did for a paced reader.
    const body = name.endsWith(".ts") && count === 1 ? data.subarray(0, Math.floor(data.length / 2)) : data;
    return Object.assign(Readable.from([body]), { statusCode: 200, headers });
  } });
  try {
    const generated = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-threads", "1", "-g", "24", "-c:a", "aac", "-f", "hls", "-hls_time", "1", "-hls_playlist_type", "vod",
      path.join(dir, "index.m3u8")], { timeout: 15000 });
    assert.equal(generated.status, 0, generated.stderr?.toString());
    const info = await engine.analyze({ token: "local", device: "local", profile: { id: 1 } },
      "https://provider.test/index.m3u8", { trustedProvider: true });
    assert.ok(info.streams.some(s => s.codec_type === "audio" && s.codec_name === "aac"));
    assert.ok(segmentRequests.size > 0);
    for (const [name, count] of segmentRequests) assert.equal(count, 2, `${name} retried exactly once`);
  } finally { await engine.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
for (const [codec, withSubs, native = false] of [
  ["libx264", false],
  ["libx265", false],
  ["libx265", true],
  ["libx265", false, true],
])
  test(
    `real ${codec} ${native ? "native HEVC " : ""}${withSubs ? "with subtitles " : ""}MKV reaches HLS with H264 video, AAC audio and isolated ownership`,
    { timeout: 45000 },
    async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "movly-codec-test-")),
        file = path.join(dir, "input.mkv");
      const subtitleFile = path.join(dir, "subtitle.srt");
      if (withSubs)
        await fs.writeFile(
          subtitleFile,
          "1\n00:00:00,500 --> 00:00:08,000\nTest českých titulků\n",
        );
      const generated = spawnSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=320x180:rate=24",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:sample_rate=48000",
          ...(withSubs
            ? [
                "-i",
                subtitleFile,
                "-map",
                "0:v",
                "-map",
                "1:a",
                "-map",
                "2:s",
                "-c:s",
                "srt",
              ]
            : []),
          "-t",
          "9",
          "-c:v",
          codec,
          "-threads",
          "1",
          ...(codec === "libx265"
            ? ["-x265-params", "pools=1:frame-threads=1"]
            : []),
          "-g",
          "48",
          "-c:a",
          "ac3",
          "-y",
          file,
        ],
        { timeout: 15000 },
      );
      assert.equal(generated.status, 0, generated.stderr?.toString());
      const source = async (_url, range) => {
        const size = (await fs.stat(file)).size,
          start = range ? Number(range.match(/\d+/)[0]) : 0;
        const stream = createReadStream(file, { start });
        stream.statusCode = range ? 206 : 200;
        stream.headers = {
          "content-type": "video/x-matroska",
          "content-length": String(size - start),
          "accept-ranges": "bytes",
          ...(range
            ? { "content-range": `bytes ${start}-${size - 1}/${size}` }
            : {}),
        };
        return stream;
      };
      const engine = createPlayback({ requestMedia: source }),
        session = {
          token: "account",
          device: "device",
          profile: { id: 1 },
          grant: "grant",
        };
      try {
        const result = await engine.start(
          session,
          "https://h1.webshare.cz/test",
          {
            subtitle: withSubs ? 0 : -1,
            cookieless: true,
            ...(native
              ? { videoMode: "native", capabilities: { hevc: true } }
              : {}),
          },
        );
        assert.equal(
          result.mode,
          codec === "libx264" || native ? "remux" : "transcode",
        );
        assert.ok(result.duration >= 9);
        assert.equal(result.audio[0].codec, "ac3");
        await assert.rejects(
          engine.handle(
            { ...session, profile: { id: 2 } },
            { method: "GET" },
            null,
            result.id,
            "status",
          ),
          { status: 404 },
        );
        await assert.rejects(
          engine.start(
            { ...session, token: "other" },
            "https://h1.webshare.cz/test",
          ),
          { status: 429 },
        );
        let state;
        for (let i = 0; i < 100; i++) {
          state = await engine.handle(
            session,
            { method: "GET" },
            null,
            result.id,
            "status",
          );
          if (state.ready || state.error) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        assert.equal(state.error, null);
        assert.equal(state.ready, true);
        const capture = async (file) => {
          const chunks = [];
          const res = new Writable({
            write(d, _enc, done) {
              chunks.push(d);
              done();
            },
          });
          res.writeHead = () => {};
          await engine.handle(session, { method: "GET" }, res, result.id, file);
          await finished(res);
          return Buffer.concat(chunks);
        };
        if (withSubs) {
          assert.equal(result.subtitles[0].supported, true);
          assert.match(
            (await capture("master.m3u8")).toString(),
            /TYPE=SUBTITLES/,
          );
          const subs = (await capture("index_vtt.m3u8")).toString();
          const vtt = subs.split("\n").find((line) => line.endsWith(".vtt"));
          assert.ok(vtt);
          assert.match((await capture(vtt)).toString(), /Test českých titulků/);
        }
        const playlist = (await capture("index.m3u8")).toString();
        // TV přehrávače bez cookie: klíč v adrese, jen playlist a TS segmenty, ne titulky/status.
        if (!withSubs) {
          const token = /^\/api\/app\/tv-media\/[a-f0-9]{48}\/([a-f0-9]{48})\/index\.m3u8$/.exec(result.media_playlist)[1];
          const viaToken = [];
          const res = new Writable({ write(d, _enc, done) { viaToken.push(d); done(); } });
          res.writeHead = () => {};
          await engine.handle(null, { method: "GET" }, res, result.id, "index.m3u8", token);
          await finished(res);
          assert.match(Buffer.concat(viaToken).toString(), /#EXTM3U/);
          await assert.rejects(engine.handle(null, { method: "GET" }, null, result.id, "index.m3u8", "0".repeat(48)), { status: 404 });
          await assert.rejects(engine.handle(null, { method: "GET" }, null, result.id, "status", token), { status: 404 });
          await assert.rejects(engine.handle(null, { method: "DELETE" }, null, result.id, undefined, token), { status: 404 });
        } else assert.equal(result.media_playlist, undefined);
        const segment = playlist
          .split("\n")
          .find((line) => /^index\d+\.(?:ts|m4s)$/.test(line));
        assert.ok(segment);
        const segmentFile = path.join(dir, "segment.ts");
        await fs.writeFile(
          segmentFile,
          native
            ? Buffer.concat([await capture("init.mp4"), await capture(segment)])
            : await capture(segment),
        );
        const probed = spawnSync("ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-of",
          "json",
          segmentFile,
        ]);
        assert.equal(probed.status, 0);
        const streams = JSON.parse(probed.stdout).streams;
        assert.equal(
          streams.find((s) => s.codec_type === "video").codec_name,
          native ? "hevc" : "h264",
        );
        assert.equal(
          streams.find((s) => s.codec_type === "audio").codec_name,
          "aac",
        );
        await assert.rejects(
          engine.handle(
            session,
            { method: "GET" },
            null,
            result.id,
            "../input.mkv",
          ),
          { status: 404 },
        );
        assert.deepEqual(
          await engine.handle(session, { method: "DELETE" }, null, result.id),
          { stopped: true },
        );
        await assert.rejects(
          engine.handle(session, { method: "GET" }, null, result.id, "status"),
          { status: 404 },
        );
      } finally {
        await engine.close();
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  );
test(
  "audio timing controls shift actual decoded audio while video duration stays intact",
  { timeout: 15000 },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "movly-audio-timing-"));
    try {
      const input = path.join(dir, "input.mkv");
      const generated = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=160x90:rate=24",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-t",
        "2",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-c:a",
        "aac",
        input,
      ]);
      assert.equal(generated.status, 0, generated.stderr?.toString());
      const probe = spawnSync("ffprobe", [
        "-v",
        "error",
        "-show_streams",
        "-of",
        "json",
        input,
      ]);
      assert.equal(probe.status, 0);
      const info = JSON.parse(probe.stdout);
      for (const delay of [500, -500]) {
        const folder = path.join(dir, String(delay));
        await fs.mkdir(folder);
        const output = path.join(folder, "index.m3u8");
        const args = ffmpegArgs(input, output, info, 0, 0, -1, {
          audioDelay: delay,
        });
        // Celý EVENT playlist; staré segmenty maže server podle pozice přehrávače.
        assert.equal(args[args.indexOf("-hls_list_size") + 1], "0");
        assert.equal(args[args.indexOf("-hls_playlist_type") + 1], "event");
        assert.ok(!args.join(" ").includes("delete_segments"));
        // This timing test reads its own generated local fixture. Production
        // continues to permit only the loopback HTTP media proxy.
        args[args.indexOf("-protocol_whitelist") + 1] += ",file";
        const encoded = spawnSync("ffmpeg", ["-v", "error", ...args]);
        assert.equal(encoded.status, 0, encoded.stderr?.toString());
        const decoded = spawnSync("ffmpeg", [
          "-v",
          "error",
          "-i",
          output,
          "-map",
          "0:a:0",
          "-ac",
          "1",
          "-ar",
          "48000",
          "-f",
          "f32le",
          "pipe:1",
        ]);
        assert.equal(decoded.status, 0, decoded.stderr?.toString());
        const rms = (start, end) => {
          let sum = 0,
            count = 0;
          for (
            let i = Math.floor(start * 48000);
            i < Math.floor(end * 48000) && i * 4 < decoded.stdout.length;
            i++
          ) {
            const value = decoded.stdout.readFloatLE(i * 4);
            sum += value * value;
            count++;
          }
          assert.ok(count > 0);
          return Math.sqrt(sum / count);
        };
        if (delay > 0) {
          assert.ok(rms(0.05, 0.3) < 0.001);
          assert.ok(rms(0.7, 1) > 0.01);
        } else assert.ok(rms(0.05, 0.3) > 0.01);
        const video = spawnSync("ffprobe", [
          "-v",
          "error",
          "-count_frames",
          "-show_streams",
          "-of",
          "json",
          output,
        ]);
        assert.equal(video.status, 0);
        assert.ok(
          Number(
            JSON.parse(video.stdout).streams.find(
              (stream) => stream.codec_type === "video",
            ).nb_read_frames,
          ) >= 47,
        );
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);

test("restored track descriptors select the same audio/subtitle and preserve explicit off", {timeout: 45000}, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "movly-track-resume-"));
  const file = path.join(dir, "input.mkv"), subs = path.join(dir, "captions.srt");
  await fs.writeFile(subs, "1\n00:00:00,500 --> 00:00:08,000\nResume test\n");
  const generated = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
    "-i", subs, "-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:s", "-t", "9", "-c:v", "libx264",
    "-threads", "1", "-c:a", "ac3", "-c:s", "srt", "-metadata:s:a:0", "language=cze", "-metadata:s:a:0", "title=Czech",
    "-metadata:s:a:1", "language=eng", "-metadata:s:a:1", "title=English", "-metadata:s:s:0", "language=cze", "-y", file], {timeout: 15000});
  assert.equal(generated.status, 0, generated.stderr?.toString());
  const source = async (_url, range) => {
    const size = (await fs.stat(file)).size, start = range ? Number(range.match(/\d+/)[0]) : 0;
    const stream = createReadStream(file, {start}); stream.statusCode = range ? 206 : 200;
    stream.headers = {"content-type": "video/x-matroska", "content-length": String(size-start), "accept-ranges": "bytes",
      ...(range ? {"content-range": `bytes ${start}-${size-1}/${size}`} : {})};
    return stream;
  };
  const session = {token: "fixture-account", device: "fixture-device", profile: {id: 1}, grant: "fixture-grant"};
  const audioSelector = JSON.stringify(["eng", "English", "ac3"]), subtitleSelector = JSON.stringify(["cze", null, "subrip"]);
  try {
    for (const [key, expected] of [[subtitleSelector, 0], ["off", -1], ["missing-track", -1]]) {
      const engine = createPlayback({requestMedia: source});
      try {
        const result = await engine.start(session, "https://h1.webshare.cz/resume", {offset: 2, audio: 0, subtitle: -1, audioSelector, subtitleSelector: key});
        assert.equal(result.selected_audio, 1); assert.equal(result.selected_subtitle, expected);
        assert.equal(result.audio[1].language, "eng");
      } finally { await engine.close(); }
    }
  } finally { await fs.rm(dir, {recursive: true, force: true}); }
});

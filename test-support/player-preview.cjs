"use strict";
// Isolated browser QA only. Not imported, packed or served in production.
const http = require("node:http"),
  fs = require("node:fs"),
  { createAppHandler } = require("../app-server"),
  { createPlayback } = require("../playback-server"),
  { createFixture } = require("./app-fixture.cjs");
const file = process.argv[2];
if (!file) throw new Error("Pass a generated test MKV.");
const size = fs.statSync(file).size;
const engine = createPlayback({
  requestMedia: async (_url, range) => {
    const start = range ? Number(range.match(/\d+/)[0]) : 0,
      stream = fs.createReadStream(file, { start });
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
  },
});
const fixture = createFixture();
class HttpError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}
const handler = createAppHandler({
  production: false,
  secret: "browser-playback-fixture-only",
  HttpError,
  providerClient: {
    login: async () => ({ token: "test-only", username: "fixture", vip: true }),
    resolve: async () => "https://h1.webshare.cz/test",
  },
  playbackEngine: engine,
  json: (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  },
  readBody: async (req) => {
    let text = "";
    for await (const d of req) text += d;
    return text ? JSON.parse(text) : {};
  },
  api: async (...args) => {
    const p = args[0];
    if (p.includes("/streams?"))
      return {
        payload: {
          streams: [
            {
              id: 1,
              source_stream_id: "test",
              provider_name: "Webshare",
              video_height: 360,
              video_codec: "H.265",
              available: true,
              audio_languages: ["cze"],
            },
          ],
        },
      };
    if (p.startsWith("v1/watch-history/position/"))
      throw new HttpError(404, "Bez historie");
    if (p === "v1/watch-history?lang=cs") return { payload: { ok: true } };
    return fixture(...args);
  },
});
http
  .createServer(async (req, res) => {
    try {
      if (req.url.startsWith("/api/app/")) {
        await handler(req, res, new URL(req.url, "http://127.0.0.1:8090"));
        return;
      }
      const up = http.request(
        {
          host: "127.0.0.1",
          port: 8086,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (r) => {
          res.writeHead(r.statusCode, r.headers);
          r.pipe(res);
        },
      );
      up.on("error", () => res.writeHead(502).end());
      req.pipe(up);
    } catch (e) {
      res.writeHead(e.status || 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: e.message }));
    }
  })
  .listen(8090, "127.0.0.1", () =>
    console.log(
      "Isolated playback QA http://127.0.0.1:8090/app — test / movly-test",
    ),
  );

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { Writable } = require("node:stream");
const { finished } = require("node:stream/promises");
const path = require("node:path");
const os = require("node:os");
const { createPlayback } = require("./playback-server");
test(
  "offline export stores the complete browser-playable movie and rejects a foreign profile",
  { timeout: 45000 },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "movly-offline-test-"));
    const input = path.join(dir, "source.mkv"),
      output = path.join(dir, "export.mp4");
    const generated = spawnSync("ffmpeg", [
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
      "-t",
      "6",
      "-c:v",
      "libx265",
      "-threads",
      "1",
      "-x265-params",
      "pools=1:frame-threads=1:log-level=error",
      "-c:a",
      "ac3",
      input,
    ]);
    assert.equal(generated.status, 0, generated.stderr?.toString());
    const size = (await fs.stat(input)).size;
    const engine = createPlayback({
      requestMedia: async (_url, range) => {
        const start = range ? Number(/^bytes=(\d+)/.exec(range)[1]) : 0;
        const stream = createReadStream(input, { start });
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
    const session = {
      token: "synthetic",
      device: "synthetic",
      profile: { id: 1 },
      grant: "synthetic",
    };
    try {
      const measured = await engine.analyze(
        session,
        "https://h1.webshare.cz/test",
      );
      assert.equal(
        measured.streams.find((s) => s.codec_type === "video").codec_name,
        "hevc",
      );
      assert.equal(
        measured.streams.find((s) => s.codec_type === "audio").codec_name,
        "ac3",
      );
      const job = await engine.start(session, "https://h1.webshare.cz/test", {
        offlineExport: true,
      });
      let state;
      for (let i = 0; i < 200; i++) {
        state = await engine.handle(
          session,
          { method: "GET" },
          null,
          job.id,
          "status",
        );
        if (state.ready || state.error) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(state.error, null);
      assert.equal(state.ready, true);
      assert.ok(state.size > 0);
      await assert.rejects(
        engine.handle(
          { ...session, profile: { id: 2 } },
          { method: "GET" },
          null,
          job.id,
          "export.mp4",
        ),
        { status: 404 },
      );
      const chunks = [],
        response = new Writable({
          write(chunk, _encoding, done) {
            chunks.push(chunk);
            done();
          },
        });
      let fullHeaders;
      response.writeHead = (status, headers) => {
        assert.equal(status, 200);
        fullHeaders = headers;
      };
      await engine.handle(
        session,
        { method: "GET" },
        response,
        job.id,
        "export.mp4",
      );
      await finished(response);
      const complete = Buffer.concat(chunks);
      assert.equal(
        state.etag,
        crypto.createHash("sha256").update(complete).digest("hex"),
      );
      assert.equal(fullHeaders.ETag, '"' + state.etag + '"');
      const offset = Math.floor(complete.length / 2),
        tail = [];
      const resumed = new Writable({
        write(chunk, _encoding, done) {
          tail.push(chunk);
          done();
        },
      });
      resumed.writeHead = (status, headers) => {
        assert.equal(status, 206);
        assert.equal(
          headers["Content-Range"],
          "bytes " +
            offset +
            "-" +
            (complete.length - 1) +
            "/" +
            complete.length,
        );
      };
      await engine.handle(
        session,
        {
          method: "GET",
          headers: {
            range: "bytes=" + offset + "-",
            "if-range": fullHeaders.ETag,
          },
        },
        resumed,
        job.id,
        "export.mp4",
      );
      await finished(resumed);
      assert.deepEqual(Buffer.concat(tail), complete.subarray(offset));
      await assert.rejects(
        engine.handle(
          session,
          {
            method: "GET",
            headers: {
              range: "bytes=" + complete.length + "-",
              "if-range": fullHeaders.ETag,
            },
          },
          null,
          job.id,
          "export.mp4",
        ),
        { status: 416 },
      );
      await fs.writeFile(output, complete);
      const probe = spawnSync("ffprobe", [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        output,
      ]);
      assert.equal(probe.status, 0);
      const media = JSON.parse(probe.stdout);
      assert.ok(Number(media.format.duration) >= 6);
      assert.equal(
        media.streams.find((s) => s.codec_type === "video").codec_name,
        "h264",
      );
      assert.equal(
        media.streams.find((s) => s.codec_type === "audio").codec_name,
        "aac",
      );
    } finally {
      await engine.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);

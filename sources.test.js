"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const {
  queries,
  matches,
  search,
  tickets,
  metadata,
} = require("./sources-server");
test("provider queries include localized and original names and exact episode", () => {
  const q = queries({
    title: "Černý příběh",
    original_title: "Black Story",
    year: 2024,
  });
  assert.ok(q.includes("Black Story"));
  assert.ok(q.includes("Černý příběh"));
  assert.ok(q.length <= 12);
  const ep = queries(
    { title: "Black Story" },
    { season_number: 2, episode_number: 3 },
  );
  assert.equal(ep[0], "Black Story S02E03");
});
test("source filtering excludes archives, wrong title/year/episode and accepts accented names", () => {
  const title = { title: "Černý příběh", year: 2024 };
  const file = (n) => ({ file_name: n, file_size: 1e9 });
  assert.equal(matches(file("Cerny pribeh 2024.mkv"), title), true);
  for (const name of [
    "Cerny pribeh 1995.mkv",
    "Other 2024.mkv",
    "Cerny pribeh 2024.zip",
  ])
    assert.equal(matches(file(name), title), false);
  assert.equal(
    matches(file("Cerny pribeh S02E03.mkv"), title, {
      season_number: 2,
      episode_number: 3,
    }),
    true,
  );
  assert.equal(
    matches(file("Cerny pribeh S02E04.mkv"), title, {
      season_number: 2,
      episode_number: 3,
    }),
    false,
  );
  assert.equal(
    matches(file("Cerny pribeh 1920x1080.mkv"), title, {
      season_number: 20,
      episode_number: 108,
    }),
    false,
  );
});
test("live search preserves partial errors and deduplicates identifiers", async () => {
  const r = await search(
    "webshare",
    { title: "Black Story" },
    null,
    "token",
    async (p, q) => {
      if (q.includes(".")) throw new Error("Unavailable");
      return [{ source_stream_id: "a", file_name: "Black Story 1080p.mkv" }];
    },
  );
  assert.equal(r.streams.length, 1);
  assert.equal(r.partial, true);
  assert.deepEqual(r.warnings, ["Unavailable"]);
  await assert.rejects(
    search("webshare", { title: "Black Story" }, null, "token", async () => {
      throw new Error("Offline");
    }),
    /Offline/,
  );
});
test("source tickets reject tampering and changed grants", () => {
  const t = tickets("secret"),
    s = { token: "u", device: "d", profile: { id: 1 }, grant: "g" },
    ticket = t.issue(s, { ident: "file" });
  assert.equal(t.read(s, ticket).ident, "file");
  assert.throws(() => t.read({ ...s, grant: "other" }, ticket));
  assert.throws(() => t.read(s, ticket + "A"));
});
test("filename metadata never guesses unlabelled codecs or quality", () => {
  assert.equal(metadata("Film.mkv").video_codec, null);
  assert.equal(metadata("Film.mkv").video_height, null);
  assert.equal(metadata("Film 2160p x265 CZ HDR10+.mkv").video_codec, "H.265");
});
test("Hellspy adapter reads the live API camelCase fileHash contract", async (t) => {
  t.mock.method(global, "fetch", async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({
        items: [
          { id: 42, title: "Film.mkv", fileHash: "abc123", size: 100000000 },
        ],
      }),
  }));
  const items = await require("./providers-server").searchFiles(
    "hellspy",
    "Film",
  );
  assert.equal(items[0].source_stream_id, "42/abc123");
  assert.equal(items[0].available, true);
});
test("Webshare adapter handles XML file names including CDATA", async (t) => {
  t.mock.method(global, "fetch", async () => ({
    ok: true,
    text: async () =>
      "<response><status>OK</status><file><ident>abc123</ident><name><![CDATA[Film & Friends.mkv]]></name><size>200000000</size></file></response>",
  }));
  const items = await require("./providers-server").searchFiles(
    "webshare",
    "Film",
    "private-token",
  );
  assert.equal(items[0].file_name, "Film & Friends.mkv");
  assert.equal(items[0].source_stream_id, "abc123");
});
test("media URLs accept observed Hellspy CDN and reject lookalike hosts", () => {
  const { allowedURL } = require("./playback-server");
  assert.equal(
    allowedURL("https://sixseven.onecdn1.net/file").hostname,
    "sixseven.onecdn1.net",
  );
  for (const url of [
    "https://sixseven.onecdn1.net.evil.test/file",
    "https://evil.onecdn1.net/file",
    "https://hellspy.to.evil.test/file",
  ])
    assert.throws(() => allowedURL(url));
});

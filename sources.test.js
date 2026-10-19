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
test("resume references survive session/grant renewal but remain bound to account and profile", () => {
  const t = tickets("secret", { resumable: true });
  const session = {
    accountId: 7,
    profile: { id: 2 },
    token: "old",
    grant: "old",
  };
  const token = t.issue(session, {
    provider: "webshare",
    ident: "file",
    title_id: 10,
    episode_id: 20,
  });
  assert.equal(
    t.read({ ...session, token: "new", grant: "new" }, token).ident,
    "file",
  );
  assert.throws(() => t.read({ ...session, accountId: 8 }, token));
  assert.throws(() => t.read({ ...session, profile: { id: 3 } }, token));
  assert.throws(() => t.read(session, token + "a"));
  assert.throws(() => tickets("secret").read(session, token));
  assert.equal(
    Buffer.from(token.split(".")[0], "base64url").toString().includes("old"),
    false,
  );
});

test("Node providers keep canonical demoted candidates and strip trailers before picker", async () => {
  const title = { title: "Speed", year: 1994, runtime: 116 };
  const files = [
    {
      source_stream_id: "exact",
      file_name: "Speed 1994 1080p.mkv",
      file_size: 2e9,
      duration_seconds: 6960,
    },
    {
      source_stream_id: "bonus",
      file_name: "Speed making of 1080p.mkv",
      file_size: 2e9,
    },
    {
      source_stream_id: "year",
      file_name: "Speed 2010 1080p.mkv",
      file_size: 2e9,
    },
    { source_stream_id: "small", file_name: "Speed 1994.mkv", file_size: 1e6 },
    {
      source_stream_id: "trailer",
      file_name: "Speed trailer.mp4",
      file_size: 1e9,
    },
    {
      source_stream_id: "unrelated",
      file_name: "Other 1994.mkv",
      file_size: 2e9,
    },
  ];
  for (const provider of ["webshare", "hellspy"]) {
    const result = await search(provider, title, null, null, async () => files);
    assert.deepEqual(
      result.streams.map((s) => s.source_stream_id),
      ["exact", "bonus", "year", "small"],
    );
    assert.deepEqual(
      result.streams.map((s) => s.relevance),
      [
        { bucket: "accepted", reason: null },
        { bucket: "demoted", reason: "bonusContent" },
        { bucket: "demoted", reason: "yearMismatch" },
        { bucket: "demoted", reason: "tooSmall" },
      ],
    );
    assert.equal(result.streams[0].scoring.size_bytes, 2e9);
    assert.equal(result.streams[0].scoring.duration_seconds, 6960);
    assert.equal(result.streams[0].scoring.quality_rank, 2);
    assert.equal(result.streams[1].scoring.duration_seconds, null);
  }
});
test("Node providers retain mismatched episodes and season packs as canonical Similar", async () => {
  const names = [
    "Breaking Bad S02E03.mkv",
    "Breaking Bad S02E04.mkv",
    "Breaking Bad S02 complete.mkv",
  ];
  const result = await search(
    "hellspy",
    { title: "Breaking Bad", year: 2008 },
    { season_number: 2, episode_number: 3 },
    null,
    async () =>
      names.map((file_name, i) => ({
        file_name,
        file_size: 1e9,
        source_stream_id: String(i),
      })),
  );
  assert.deepEqual(
    result.streams.map((s) => s.relevance),
    [
      { bucket: "accepted", reason: null },
      { bucket: "demoted", reason: "seasonEpisodeMismatch" },
      { bucket: "demoted", reason: "seasonPack" },
    ],
  );
});
test("Hellspy adapter preserves reported duration and rejects nonnumeric metadata", async (t) => {
  t.mock.method(global, "fetch", async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({
        items: [
          { id: 1, title: "Film", size: 1e9, duration: 4847 },
          { id: 2, title: "Film", size: 1e9, duration: "4847" },
          { id: 3, title: "Film", size: 1e9, duration: -1 },
        ],
      }),
  }));
  const result = await require("./providers-server").searchFiles(
    "hellspy",
    "Film",
  );
  assert.deepEqual(
    result.map((f) => f.duration_seconds),
    [4847, null, null],
  );
});

test("Node scoring keeps all canonical quality ranks and filename channel parsing", async () => {
  const qualities = [
    "480p",
    "720p",
    "1080p",
    "1440p",
    "2160p",
    "4320p",
    "unknown",
  ];
  const result = await search(
    "hellspy",
    { title: "Speed" },
    null,
    null,
    async () =>
      qualities.map((q, i) => ({
        source_stream_id: String(i),
        file_name: `Speed ${q} CZ 5.1.mkv`,
        file_size: 2e9,
      })),
  );
  assert.deepEqual(
    qualities.map(
      (q, i) =>
        result.streams.find((f) => f.source_stream_id === String(i)).scoring
          .quality_rank,
    ),
    [0, 1, 2, 3, 4, 5, null],
  );
  assert.equal(result.streams[0].scoring.audio_tracks[0].channels, 6);
});

test("numeric-only catalog titles retain name validation when canonical patterns are empty", async () => {
  for (const provider of ["webshare", "hellspy"]) {
    const result = await search(
      provider,
      { title: "1917", year: 2019 },
      null,
      null,
      async () => [
        {
          source_stream_id: "exact",
          file_name: "1917 2019 1080p.mkv",
          file_size: 2e9,
        },
        {
          source_stream_id: "unrelated",
          file_name: "Another Movie 2019.mkv",
          file_size: 2e9,
        },
      ],
    );
    assert.deepEqual(
      result.streams.map((s) => s.source_stream_id),
      ["exact"],
    );
    assert.deepEqual(result.streams[0].relevance, {
      bucket: "accepted",
      reason: null,
    });
  }
});

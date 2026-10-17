"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { directSource } = require("./direct-media");
const { md5crypt } = require("./providers-server");

test("provider password hashing matches published MD5 crypt vector", () => {
  assert.equal(
    md5crypt("password", "saltqwer"),
    "$1$saltqwer$yCutmodwBoXKLyFtgW5r31",
  );
});

test("a browser gets the provider link directly, progressive file or HLS", () => {
  assert.deepEqual(directSource("https://cdn.example.net/a/film.mp4?t=1", {}, "Přehraj.to"), {
    direct: true, url: "https://cdn.example.net/a/film.mp4?t=1", kind: "file",
  });
  assert.equal(directSource("https://cdn.example.net/x/master.m3u8", null, "SKTorrent").kind, "hls");
  // User-Agent si prohlížeč nastaví sám.
  assert.equal(directSource("https://cdn.example.net/f.mkv", { "User-Agent": "x" }, "sktorrent").kind, "file");
});

test("links a browser cannot open itself are app-only", () => {
  const reason = (...args) => {
    try { directSource(...args); } catch (error) { assert.equal(error.code, "app_required"); assert.equal(error.status, 422); return error.reason; }
    assert.fail("expected app_required");
  };
  assert.equal(reason("http://cdn.example.net/f.mp4", {}, "x"), "insecure_link");
  assert.equal(reason("https://user:pw@cdn.example.net/f.mp4", {}, "x"), "insecure_link");
  assert.equal(reason("not a url", {}, "x"), "invalid_link");
  assert.equal(reason("https://cdn.example.net/f.mp4", { Referer: "https://mixdrop.example/" }, "Mixdrop"), "headers");
  assert.equal(reason("https://cdn.example.net/f.mp4", { Cookie: "a=b" }, "Fastshare"), "headers");
  // Odkazy svázané s IP serveru (ověřeno 17. 10. 2026).
  assert.equal(reason("https://cdn.example.net/hls/index.m3u8", { "User-Agent": "x" }, "VOE"), "ip_bound");
  assert.equal(reason("https://streamtape.com/get_video?id=1", {}, "Streamtape"), "ip_bound");
  assert.equal(reason("https://api.ceskatelevize.cz/video/master.m3u8", {}, "ČT"), "ip_bound");
});

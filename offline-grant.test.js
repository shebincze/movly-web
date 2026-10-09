const { test } = require("node:test");
const assert = require("node:assert/strict");
const { offlineSigner } = require("./offline-grant");
test("offline grant survives JSON persistence and rejects tampering, restriction, expiry and another scope", async () => {
  const { verifiedGrant, mayRead } = await import("./app/offline-store.js");
  const signer = offlineSigner("synthetic-test-secret"), now = Date.now();
  const user = { id: 1, username: "test", role: "user", is_active: true, is_verified: true, premium_until: new Date(now + 86400000).toISOString() };
  const profile = { id: 2, name: "Adult", is_kids: false, has_pin: false, max_certification: 18, allow_unrated: true };
  const session = { token: "synthetic", device: "web-test" };
  const receipt = JSON.parse(JSON.stringify(signer.issue(user, profile, session, now)));
  assert.equal((await verifiedGrant(receipt, now)).profileId, 2);
  assert.equal(await verifiedGrant({ ...receipt, payload: Buffer.from('{"profileId":3}').toString("base64url") }, now), null);
  assert.equal(await verifiedGrant(receipt, now + 7 * 86400000), null);
  assert.equal(await verifiedGrant(receipt, now - 1), null);
  assert.throws(() => signer.issue(user, { ...profile, max_certification: undefined }, session), /dospělý/);
  assert.throws(() => signer.issue(user, { ...profile, max_certification: 7 }, session), /dospělý/);
  assert.throws(() => signer.issue(user, { ...profile, allow_unrated: false }, session), /dospělý/);
  assert.throws(() => signer.issue(user, { ...profile, has_pin: true }, session), /PIN/);
  assert.throws(() => signer.issue({ ...user, is_active: false }, profile, session));
  const another = signer.issue(user, { ...profile, id: 3 }, session, now);
  assert.equal(await mayRead({ complete: true, receipt }, receipt), true);
  assert.equal(await mayRead({ complete: true, receipt }, another), false);
  assert.equal(await mayRead({ complete: false, receipt }, receipt), false);
});

test("fresh authorization renews original ownership after session rotation but rejects another API environment", async () => {
  const { mayRead } = await import("./app/offline-store.js");
  const now = Date.now(), signer = offlineSigner("synthetic", "https://api.example.test");
  const user = { id: 1, username: "test", role: "vip", is_active: true, is_verified: true };
  const profile = { id: 2, name: "Adult", is_kids: false, has_pin: false, max_certification: 18, allow_unrated: true };
  const file = { complete: true, receipt: signer.issue(user, profile, { token: "previous", device: "previous" }, now - 8 * 86400000) };
  const renewed = signer.issue(user, profile, { token: "new-session", device: "new-device" }, now);
  assert.equal(await mayRead(file, renewed), true);
  assert.equal(await mayRead(file, signer.issue({ ...user, id: 99 }, profile, { token: "new", device: "device" }, now)), false);
  const differentAPI = offlineSigner("synthetic", "https://test-api.example.test").issue(user, profile, { token: "new", device: "device" }, now);
  assert.equal(await mayRead(file, differentAPI), false);
});

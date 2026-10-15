const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
test("feedback entitlement is explicit, future and authenticated", async () => {
  const source = fs.readFileSync("app/feedback-access.js", "utf8");
  const { canUseFeedback } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const now = Date.parse("2026-10-15T00:00:00Z");
  for (const role of ["premium", "vip", "moderator", "admin"]) assert.equal(canUseFeedback({ id: 1, role }, now), true);
  for (const account of [null, {}, { role: "admin" }, {id:1,role:"future-role"}, {id:1,canModerate:true}, ...[null,"", "bad", "2030", "2030-01-01", "2030-02-30T00:00:00Z", "2030-01-01T00:00:00-00:00", 9999999999999, "2000-01-01T00:00:00Z"].map(premiumUntil => ({id:1, role:"user",premiumUntil}))]) assert.equal(canUseFeedback(account, now), false);
  assert.equal(canUseFeedback({id:1, role:"unknown",premiumUntil:"2027-01-01T00:00:00Z"}, now), true);
  assert.equal(canUseFeedback({id:1, role:"user",premiumUntil:new Date(now).toISOString()}, now), false);
});

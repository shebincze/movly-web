const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
test("feedback supports free users and still rejects invalid or inactive accounts", async () => {
  const source = fs.readFileSync("app/feedback-access.js", "utf8");
  const { canUseFeedback } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  for (const role of ["user", "premium", "vip", "moderator", "admin"])
    for (const premiumUntil of [null, "bad", "2000-01-01T00:00:00Z"])
      assert.equal(canUseFeedback({ id: 1, role, premiumUntil, isActive: true, isVerified: true }), true);
  for (const account of [null, {}, { role: "admin" }, {id:1,role:"future-role"},
    {id:1,canModerate:true}, {id:1,role:"user",isActive:false}, {id:1,role:"user",is_verified:false}])
    assert.equal(canUseFeedback(account), false);
});

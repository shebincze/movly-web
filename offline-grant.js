const crypto = require("node:crypto");
function offlineSigner(secret, environment = "local") {
  const seed = Buffer.from(crypto.hkdfSync("sha256", secret, "movly-web", environment === "local" ? "offline-policy-v1" : `offline-policy-v1:${environment}`, 32));
  const key = crypto.createPrivateKey({ format: "der", type: "pkcs8",
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]) });
  const publicKey = crypto.createPublicKey(key).export({ format: "jwk" });
  return { issue(user, profile, session, now = Date.now()) {
    if (!Number.isSafeInteger(user.id) || !user.is_active || !user.is_verified ||
      !(new Date(user.premium_until).getTime() > now || ["vip", "moderator", "admin"].includes(user.role)) ||
      !profile || profile.is_kids !== false || !Number.isInteger(profile.max_certification) || profile.max_certification < 18 || typeof profile.has_pin !== "boolean" || profile.allow_unrated !== true)
      throw Object.assign(new Error("Offline knihovna vyžaduje aktivní Premium a dospělý profil bez věkového omezení."), { status: 403 });
    let expiresAt = now + 7 * 86400000;
    if (!["vip", "moderator", "admin"].includes(user.role))
      expiresAt = Math.min(expiresAt, Date.parse(user.premium_until));
    if (profile.has_pin) {
      const pinExpiry = Date.parse(session.grantExpiresAt);
      if (!Number.isFinite(pinExpiry) || pinExpiry <= now)
        throw Object.assign(new Error("Profil musí být odemčený platným PINem."), { status: 403 });
      expiresAt = Math.min(expiresAt, pinExpiry);
    }
    const scope = crypto.createHmac("sha256", seed).update(`${session.token}:${session.device}:${profile.id}`).digest("hex");
    const payload = Buffer.from(JSON.stringify({ version: 1, accountId: user.id, profileId: profile.id,
      deviceId: session.device, scope, name: `${user.username} · ${profile.name}`, verifiedAt: now, expiresAt }));
    return { payload: payload.toString("base64url"), signature: crypto.sign(null, payload, key).toString("base64url"), publicKey };
  } };
}
module.exports = { offlineSigner };

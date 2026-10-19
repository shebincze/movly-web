function feedbackPremiumActive(value, now = Date.now()) {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!m) return false;
  const [, y, month, d, h, minute, second, sign, oh = "0", om = "0"] = m;
  const probe = new Date(Date.UTC(+y, +month - 1, +d));
  return probe.getUTCFullYear() === +y && probe.getUTCMonth() === +month - 1 && probe.getUTCDate() === +d && +h < 24 && +minute < 60 && +second < 60 && +oh < 24 && +om < 60 && !(sign === "-" && +oh === 0 && +om === 0) && Number.isFinite(Date.parse(value)) && Date.parse(value) > now;
}
// Feedback is an authenticated Premium benefit; moderation flags alone are not a tier.
export function canUseFeedback(account, now = Date.now()) {
  if (!account || !Number.isSafeInteger(account.id) || account.id <= 0 || account.is_active === false || account.isActive === false) return false;
  if (["premium", "vip", "moderator", "admin"].includes(account.role)) return true;
  const until = account.premiumUntil ?? account.premium_until;
  return feedbackPremiumActive(until, now);
}
let account = null;
let expiryTimer = null;
export const feedbackAllowed = () => canUseFeedback(account);
export function setFeedbackAccount(value) {
  const previous = account;
  account = value;
  clearTimeout(expiryTimer);
  const until = Date.parse(account?.premiumUntil ?? account?.premium_until);
  if (!["premium", "vip", "moderator", "admin"].includes(account?.role) && Number.isFinite(until) && until > Date.now())
    expiryTimer = setTimeout(() => setFeedbackAccount(account), Math.min(until - Date.now() + 1, 2147483647));
  if (previous?.id !== account?.id || !feedbackAllowed()) {
    window.dispatchEvent(new CustomEvent("movly-feedback-revoked"));
  }
  document.querySelectorAll('[href="#feedback"], [data-feedback-entry]').forEach(node => { node.hidden = !feedbackAllowed(); });
}
export function requireFeedback() {
  if (!feedbackAllowed()) throw new Error("Pomozte zlepšovat Movly je dostupné s Premium.");
}

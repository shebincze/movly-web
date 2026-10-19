// The authenticated BFF verifies active accounts; paid tiers do not gate feedback.
export function canUseFeedback(account) {
  return !!account && Number.isSafeInteger(account.id) && account.id > 0 &&
    account.is_active !== false && account.isActive !== false &&
    account.is_verified !== false && account.isVerified !== false &&
    ["user", "premium", "vip", "moderator", "admin"].includes(account.role);
}
let account = null;
export const feedbackAllowed = () => canUseFeedback(account);
export function setFeedbackAccount(value) {
  const previous = account;
  account = value;
  if (previous?.id !== account?.id || !feedbackAllowed()) {
    window.dispatchEvent(new CustomEvent("movly-feedback-revoked"));
  }
  document.querySelectorAll('[href="#feedback"], [data-feedback-entry]').forEach(node => { node.hidden = !feedbackAllowed(); });
}
export function requireFeedback() {
  if (!feedbackAllowed()) throw new Error("Přihlas se aktivním ověřeným Movly účtem.");
}

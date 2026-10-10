let owner = null;
let generation = 0;
export function setPlaybackOwner(account, profile) {
  const next = account?.id > 0 && profile?.id > 0 ? { accountId: account.id, profileId: profile.id } : null;
  if (next?.accountId === owner?.accountId && next?.profileId === owner?.profileId) return;
  generation += 1;
  owner = next ? { ...next, generation } : null;
}
export function playbackOwner() { return owner; }
function key(scope, title, episode) {
  return scope ? `movly.playback-selection.v1.${scope.accountId}.${scope.profileId}.${title}.${episode?.season_number || 0}.${episode?.episode_number || 0}` : null;
}
export function recalledPlayback(title, episode, scope = owner, storage = globalThis.localStorage) {
  const k = key(scope, title, episode);
  if (!k) return null;
  try {
    const value = JSON.parse(storage.getItem(k) || "null");
    if (!value || value.selection?.title_id !== title || !["human", "ai", "resume", "lookup"].includes(value.selection.source)
      || !Number.isSafeInteger(value.audio?.index) || value.audio.index < 0 || typeof value.audio?.key !== "string"
      || !Number.isSafeInteger(value.subtitle?.index) || value.subtitle.index < -1 || typeof value.subtitle?.key !== "string") return null;
    return value;
  } catch { return null; }
}
export function rememberPlayback(title, episode, selection, audio, subtitle, scope = owner, storage = globalThis.localStorage) {
  const k = key(scope, title, episode);
  if (!k || owner?.accountId !== scope.accountId || owner?.profileId !== scope.profileId || owner?.generation !== scope.generation) return;
  const safe = selection.resume_selection || (["human", "ai", "resume", "lookup"].includes(selection.source) ? selection : null);
  if (!safe) return;
  const reference = { title_id: title, source: safe.source,
    ...(safe.source === "resume" ? { ticket: safe.ticket } : safe.source === "lookup"
      ? { provider: safe.provider, name: safe.name, quality: safe.quality, size: safe.size } : { stream_id: safe.stream_id }),
    ...(episode ? { episode_id: episode.id } : {}) };
  try { storage.setItem(k, JSON.stringify({ selection: reference, audio, subtitle })); } catch {}
}
export function samePlaybackSource(a, b) {
  const x = a?.resume_selection || a, y = b?.resume_selection || b;
  return x?.source === y?.source && x?.stream_id === y?.stream_id && x?.ticket === y?.ticket
    && x?.provider === y?.provider && x?.name === y?.name && x?.quality === y?.quality && x?.size === y?.size;
}

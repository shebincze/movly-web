export function waitingForParty(state, now, offset) {
  if (!state?.preparation?.started_at) return false;
  const release = Date.parse(state.preparation.released_at);
  return !Number.isFinite(release) || now + offset < release;
}
export function effectivePartyPosition(state, now, offset) {
  if (!state) return 0;
  const updated = Date.parse(state.position_updated_at);
  if (!Number.isFinite(updated)) throw new Error('Server vrátil neplatný čas pozice party.');
  return state.position_sec + (state.status === 'playing' ? Math.max(0, (now + offset - updated) / 1000) * state.rate : 0);
}

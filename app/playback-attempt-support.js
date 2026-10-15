import { api, apiContextKey } from "./api.js";
import { supportsPlaybackAttempt, cachedPlaybackAttempt } from "./capabilities.js";
// Negotiation never delays playback. A cold/old/failed server uses the existing
// quality contract for this attempt; a confirmed offer can opt in a later one.
export function preparePlaybackAttemptSupport() {
  return supportsPlaybackAttempt(api, undefined, apiContextKey()).catch(()=>false);
}
export function playbackAttemptSupported() {
  const context=apiContextKey();
  void preparePlaybackAttemptSupport();
  return cachedPlaybackAttempt(context);
}

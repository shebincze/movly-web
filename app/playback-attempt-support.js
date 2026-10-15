// Set only from a successful capability negotiation, scoped to the current owner.
let supported = false;
export function playbackAttemptSupported() { return supported; }
export function setPlaybackAttemptSupport(value) { supported = value === true; }

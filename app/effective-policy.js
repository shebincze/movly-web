import { api, apiContextKey, apiContextOwner } from "./api.js";
import { observeEffectivePolicy } from "./offline-store.js";

let generation = 0,
  cached = null,
  pending = null;

export class EffectivePolicyError extends Error {
  constructor(message = "Účinná pravidla profilu nejsou dostupná.") {
    super(message);
    this.name = "EffectivePolicyError";
  }
}

async function setRevision(policy) {
  const hashInput = JSON.stringify([
    policy.schema_version, policy.user_id, policy.profile_id, policy.is_kids,
    policy.age_controls_active, policy.max_age, policy.allow_unrated,
    policy.exclude_adult, policy.catalog_excludes_adult,
  ]);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
  policy.revision = `ep1.${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return policy;
}

export async function adaptEffectiveContentPolicy(value, expected = apiContextOwner()) {
  if (!value || value.schema_version !== 1 ||
      !Number.isSafeInteger(value.user_id) || value.user_id < 1 ||
      !Number.isSafeInteger(value.profile_id) || value.profile_id < 1 ||
      typeof value.revision !== "string" || !/^ep1\.[a-f0-9]{64}$/.test(value.revision) ||
      typeof value.is_kids !== "boolean" ||
      typeof value.age_controls_active !== "boolean" ||
      !(value.max_age === null || (Number.isInteger(value.max_age) && value.max_age >= 0 && value.max_age <= 100)) ||
      typeof value.allow_unrated !== "boolean" ||
      typeof value.exclude_adult !== "boolean" ||
      value.catalog_excludes_adult !== true)
    throw new EffectivePolicyError();
  if (expected && (value.user_id !== expected.accountId || value.profile_id !== expected.profileId))
    throw new EffectivePolicyError("Pravidla patří jinému účtu nebo profilu.");
  if (value.age_controls_active !== value.is_kids ||
      value.exclude_adult !== value.is_kids ||
      (value.is_kids && value.max_age === null) ||
      (!value.is_kids && (value.max_age !== null || value.allow_unrated !== true)))
    throw new EffectivePolicyError();
  const hashed = await setRevision({ ...value });
  if (value.revision !== hashed.revision) throw new EffectivePolicyError();
  return Object.freeze({
    schema_version: 1,
    user_id: value.user_id,
    profile_id: value.profile_id,
    revision: value.revision,
    is_kids: value.is_kids,
    age_controls_active: value.age_controls_active,
    max_age: value.max_age,
    allow_unrated: value.allow_unrated,
    exclude_adult: value.exclude_adult,
    catalog_excludes_adult: true,
  });
}

export async function verifiedLegacyProfilePolicy(profile, expected = apiContextOwner()) {
  if (!expected || !profile || profile.id !== expected.profileId ||
      typeof profile.is_kids !== "boolean" ||
      !Number.isInteger(profile.max_certification) || ![7, 12, 15, 18].includes(profile.max_certification) ||
      typeof profile.allow_unrated !== "boolean")
    throw new EffectivePolicyError("Ověřená pravidla profilu nejsou dostupná.");
  const isKids = profile.is_kids;
  const value = await setRevision({
    schema_version: 1,
    user_id: expected.accountId,
    profile_id: expected.profileId,
    is_kids: isKids,
    age_controls_active: isKids,
    max_age: isKids ? profile.max_certification : null,
    allow_unrated: isKids ? profile.allow_unrated : true,
    exclude_adult: isKids,
    catalog_excludes_adult: true,
  });
  return Object.freeze({ ...value, verification_source: "verified_legacy_profile" });
}

function unsupportedPolicyEndpoint(error) {
  return error?.status === 404 || error?.status === 405;
}

function policyProbeUnavailable(error) {
  if (error?.status === 401 || error?.status === 403) return false;
  return error instanceof TypeError || error?.status === 502 || error?.status === 503 || error?.status === 504;
}

async function loadLegacyPolicy(signal) {
  const expected = apiContextOwner();
  if (!expected) return null;
  try {
    const profiles = await api("profiles", { signal });
    if (!Array.isArray(profiles)) return null;
    return await verifiedLegacyProfilePolicy(profiles.find((profile) => profile?.id === expected.profileId), expected);
  } catch (error) {
    if (error instanceof EffectivePolicyError) return null;
    throw error;
  }
}

export function clearEffectivePolicyCache() {
  generation++;
  cached = null;
  pending = null;
}

export async function effectiveContentPolicy({ signal, refresh = false } = {}) {
  const context = `${location.origin}:${apiContextKey()}`;
  if (!refresh && cached?.context === context) return cached.policy;
  if (pending?.context === context) return pending.promise;
  const requestGeneration = generation;
  const promise = (async () => {
    let policy;
    try {
      policy = await adaptEffectiveContentPolicy(
        await api("profiles/effective-content-policy", { signal }),
      );
    } catch (error) {
      if (unsupportedPolicyEndpoint(error)) {
        // An older server may have changed the stored profile since our last
        // read. Refresh its complete, selected legacy profile before trusting
        // a fallback revision.
        try {
          policy = await loadLegacyPolicy(signal);
        } catch (legacyError) {
          if (!policyProbeUnavailable(legacyError)) throw legacyError;
          if (signal?.aborted || context !== `${location.origin}:${apiContextKey()}` || requestGeneration !== generation)
            throw new DOMException("Profile policy context changed", "AbortError");
          if (cached?.context === context) return cached.policy;
          return null;
        }
      } else if (policyProbeUnavailable(error)) {
        // A transient outage may reuse only this owner's last verified policy.
        if (signal?.aborted || context !== `${location.origin}:${apiContextKey()}` || requestGeneration !== generation)
          throw new DOMException("Profile policy context changed", "AbortError");
        if (cached?.context === context) return cached.policy;
        return null;
      } else {
        throw error;
      }
    }
    if (signal?.aborted || context !== `${location.origin}:${apiContextKey()}` || requestGeneration !== generation)
      throw new DOMException("Profile policy context changed", "AbortError");
    if (!policy) return null;
    // A validated policy revision is mirrored only inside the current signed
    // offline-grant record. Failure to persist this optional marker must not
    // interrupt online catalog/profile use.
    try {
      if (!await observeEffectivePolicy(policy))
        reportOfflineProtectionFailure();
    } catch {
      reportOfflineProtectionFailure();
    }
    const previous = cached?.policy;
    if (previous && previous.revision !== policy.revision) {
      generation++;
      cached = null;
      document.dispatchEvent(new CustomEvent("movly:effective-policy-changed", {
        detail: { previous: previous.revision, current: policy.revision },
      }));
    }
    const verified = Object.freeze({ ...policy, verification_source: policy.verification_source || "server_policy_snapshot" });
    cached = { context, policy: verified };
    return verified;
  })();
  pending = { context, promise };
  try {
    return await promise;
  } finally {
    if (pending?.promise === promise) pending = null;
  }
}

function reportOfflineProtectionFailure() {
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined")
    window.dispatchEvent(new CustomEvent("movly:offline-policy-protection-failed"));
}

export async function assertEffectivePolicyUnchanged(before, { signal } = {}) {
  if (!before) return null;
  const current = await effectiveContentPolicy({ signal, refresh: true });
  if (current.revision !== before.revision || current.profile_id !== before.profile_id || current.user_id !== before.user_id)
    throw new DOMException("Profile policy changed during request", "AbortError");
  return current;
}

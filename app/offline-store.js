import { translateUI } from "./i18n.js";
export const CHUNK_BYTES = 512 * 1024;
export const OFFLINE_CACHE_NAME = "movly-offline-shell-v23-offline-policy-marker";
const OFFLINE_POLICY_MARKER_CACHE_NAME = "movly-offline-policy-markers-v1";
const volatilePolicyBlocks = new Set();
const request = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export function database() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("movly-offline-v1", 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains("files"))
        r.result.createObjectStore("files", { keyPath: "id" });
      if (!r.result.objectStoreNames.contains("chunks"))
        r.result.createObjectStore("chunks", { keyPath: ["id", "index"] });
      if (!r.result.objectStoreNames.contains("settings"))
        r.result.createObjectStore("settings");
      if (!r.result.objectStoreNames.contains("history"))
        r.result.createObjectStore("history", { keyPath: "id" });
      if (!r.result.objectStoreNames.contains("downloads"))
        r.result.createObjectStore("downloads", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function get(store, key) {
  const db = await database();
  try {
    return await request(db.transaction(store).objectStore(store).get(key));
  } finally {
    db.close();
  }
}
export async function allFiles() {
  const db = await database();
  try {
    return await request(db.transaction("files").objectStore("files").getAll());
  } finally {
    db.close();
  }
}
export async function allEntries(store) {
  const db = await database();
  try {
    return await request(db.transaction(store).objectStore(store).getAll());
  } finally {
    db.close();
  }
}
// Keep the media position and its durable sync draft in one transaction.
// The callback is synchronous: awaiting inside an IndexedDB transaction closes it.
export async function updateOfflineHistory(id, change) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["files", "history"], "readwrite");
      const files = tx.objectStore("files"),
        history = tx.objectStore("history");
      const fileRequest = files.get(id),
        historyRequest = history.get(id);
      let fileReady = false,
        historyReady = false,
        result;
      function apply() {
        if (!fileReady || !historyReady) return;
        try {
          result = change(fileRequest.result, historyRequest.result);
          if (!result) return;
          if (result.file) files.put(result.file);
          if (result.entry) history.put(result.entry);
          else history.delete(id);
        } catch (error) {
          tx.abort();
          reject(error);
        }
      }
      fileRequest.onsuccess = () => {
        fileReady = true;
        apply();
      };
      historyRequest.onsuccess = () => {
        historyReady = true;
        apply();
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(
          tx.error || new Error(translateUI("Offline zápis nebyl potvrzen.")),
        );
    });
  } finally {
    db.close();
  }
}
export async function put(store, value, key) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      const r =
        key === undefined
          ? tx.objectStore(store).put(value)
          : tx.objectStore(store).put(value, key);
      r.onerror = () => reject(r.error);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
const policyTuple = (policy) => ({
  schema_version: policy.schema_version,
  user_id: policy.user_id,
  profile_id: policy.profile_id,
  revision: policy.revision,
  is_kids: policy.is_kids,
  age_controls_active: policy.age_controls_active,
  max_age: policy.max_age,
  allow_unrated: policy.allow_unrated,
  exclude_adult: policy.exclude_adult,
  catalog_excludes_adult: policy.catalog_excludes_adult,
});
function validStoredPolicy(value, owner) {
  return value?.schema_version === 1 &&
    value.user_id === owner.accountId && value.profile_id === owner.profileId &&
    typeof value.revision === "string" && /^ep1\.[a-f0-9]{64}$/.test(value.revision);
}
async function receiptDigest(receipt) {
  const value = JSON.stringify({ payload: receipt?.payload, signature: receipt?.signature, publicKey: receipt?.publicKey });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function policyMarkerKey(digest) {
  return new Request(new URL(`/app/offline-policy-markers/${digest}`, self.location.origin));
}
async function writePolicyMarkerFallback(receipt, marker) {
  const digest = await receiptDigest(receipt);
  const bound = { ...marker, reason: marker.reason || "known_policy_change", grant_digest: digest };
  volatilePolicyBlocks.add(digest);
  try {
    if (!globalThis.caches) return false;
    const cache = await caches.open(OFFLINE_POLICY_MARKER_CACHE_NAME);
    await cache.put(policyMarkerKey(digest), new Response(JSON.stringify(bound), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    }));
    return true;
  } catch {
    return false;
  }
}
async function readPolicyMarkerFallback(active, grant) {
  const digest = await receiptDigest(active);
  if (volatilePolicyBlocks.has(digest)) return true;
  try {
    if (!globalThis.caches) return false;
    const cache = await caches.open(OFFLINE_POLICY_MARKER_CACHE_NAME), response = await cache.match(policyMarkerKey(digest));
    if (!response) return false;
    const marker = await response.json();
    return marker.grant_digest === digest && marker.user_id === grant.accountId &&
      marker.profile_id === grant.profileId && (
        (marker.reason === "known_policy_change" && /^ep1\.[a-f0-9]{64}$/.test(marker.current_revision || "")) ||
        marker.reason === "authoritative_server_denial"
      );
  } catch {
    return false;
  }
}
async function clearPolicyMarkerFallback(receipt) {
  try {
    const digest = await receiptDigest(receipt);
    volatilePolicyBlocks.delete(digest);
    if (globalThis.caches) await (await caches.open(OFFLINE_POLICY_MARKER_CACHE_NAME)).delete(policyMarkerKey(digest));
  } catch { /* A different newly issued receipt has a distinct digest. */ }
}
export function effectivePolicySupersedesGrant(previous, policy, grant) {
  if (!policy || policy.user_id !== grant?.accountId || policy.profile_id !== grant?.profileId) return null;
  const sameOwnerKnown = validStoredPolicy(previous, grant);
  const changed = (sameOwnerKnown && previous.revision !== policy.revision) ||
    (!sameOwnerKnown && policy.is_kids === true);
  return changed ? {
    user_id: grant.accountId,
    profile_id: grant.profileId,
    previous_revision: sameOwnerKnown ? previous.revision : null,
    current_revision: policy.revision,
  } : null;
}
async function updateActiveGrant(receipt, change) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("settings", "readwrite"), store = tx.objectStore("settings");
      const request = store.get("active");
      let updated = false;
      request.onsuccess = () => {
        const active = request.result;
        if (active?.payload !== receipt.payload || active?.signature !== receipt.signature) return;
        const next = change(active);
        if (next) { store.put(next, "active"); updated = true; }
      };
      tx.oncomplete = () => resolve(updated);
      tx.onabort = () => reject(tx.error || new Error("Offline oprávnění se nepodařilo aktualizovat."));
    });
  } finally { db.close(); }
}
export async function clearActiveGrantIfMatches(receipt) {
  if (!receipt?.payload || !receipt?.signature) return false;
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("settings", "readwrite"), store = tx.objectStore("settings");
      const request = store.get("active");
      let cleared = false;
      request.onsuccess = () => {
        const active = request.result;
        if (active?.payload === receipt.payload && active?.signature === receipt.signature) {
          store.put(null, "active");
          cleared = true;
        }
      };
      tx.oncomplete = () => resolve(cleared);
      tx.onabort = () => reject(tx.error || new Error("Offline oprávnění se nepodařilo odebrat."));
    });
  } finally { db.close(); }
}
export async function denyOfflineGrant(receipt) {
  if (await clearActiveGrantIfMatches(receipt).catch(() => false)) return true;
  const grant = await verifiedGrant(receipt, Date.now(), { ownershipOnly: true });
  if (!grant) return false;
  return writePolicyMarkerFallback(receipt, {
    user_id: grant.accountId,
    profile_id: grant.profileId,
    reason: "authoritative_server_denial",
  });
}
// Policy metadata is local to the existing grant record; the signed receipt stays byte-for-byte intact.
export async function observeEffectivePolicy(policy) {
  const active = await get("settings", "active"), grant = await verifiedGrant(active, Date.now(), { ownershipOnly: true });
  if (!grant || policy?.user_id !== grant.accountId || policy?.profile_id !== grant.profileId ||
      !/^ep1\.[a-f0-9]{64}$/.test(policy.revision || "")) return false;
  const next = policyTuple(policy);
  const change = current => {
    const previous = current.effectivePolicy;
    const marker = effectivePolicySupersedesGrant(previous, next, grant);
    const oldMarker = current.supersededPolicy;
    const retainedMarker = marker || (oldMarker?.user_id === grant.accountId && oldMarker?.profile_id === grant.profileId
      ? oldMarker : null);
    return {
      ...current,
      effectivePolicy: next,
      ...(retainedMarker ? { supersededPolicy: retainedMarker } : {}),
    };
  };
  try {
    await updateActiveGrant(active, change);
  } catch {
    const marker = effectivePolicySupersedesGrant(active.effectivePolicy, next, grant);
    if (marker) await writePolicyMarkerFallback(active, marker);
  }
  return true;
}
export async function storeFreshOfflineGrant(receipt, policy) {
  const grant = await verifiedGrant(receipt);
  if (!grant) return false;
  const previous = await get("settings", "active"), previousGrant = await verifiedGrant(previous, Date.now(), { ownershipOnly: true });
  const sameOwner = previousGrant?.accountId === grant.accountId && previousGrant?.profileId === grant.profileId;
  const validPolicy = policy?.user_id === grant.accountId && policy?.profile_id === grant.profileId &&
    /^ep1\.[a-f0-9]{64}$/.test(policy.revision || "");
  const matchingPolicy = policy?.user_id === grant.accountId && policy?.profile_id === grant.profileId &&
    policy.is_kids === false && policy.age_controls_active === false && policy.max_age === null &&
    policy.allow_unrated === true && policy.exclude_adult === false && policy.catalog_excludes_adult === true &&
    /^ep1\.[a-f0-9]{64}$/.test(policy.revision || "");
  const superseded = !matchingPolicy && validPolicy
    ? effectivePolicySupersedesGrant(sameOwner ? previous.effectivePolicy : null, policy, grant)
    : null;
  await put("settings", {
    ...receipt,
    ...(validPolicy ? { effectivePolicy: policyTuple(policy) } : sameOwner && previous.effectivePolicy ? { effectivePolicy: previous.effectivePolicy } : {}),
    ...(superseded ? { supersededPolicy: superseded } :
      !matchingPolicy && sameOwner && previous.supersededPolicy ? { supersededPolicy: previous.supersededPolicy } : {}),
  }, "active");
  if (matchingPolicy) await clearPolicyMarkerFallback(receipt);
  return true;
}
export async function removeFile(id) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["files", "chunks", "history"], "readwrite");
      tx.objectStore("files").delete(id);
      // Keep unsynchronized history when the user removes the media file. It is
      // retained with its signed owner until confirmed or explicitly cleared.
      const cursor = tx
        .objectStore("chunks")
        .openCursor(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
      cursor.onsuccess = () => {
        if (cursor.result) {
          cursor.result.delete();
          cursor.result.continue();
        }
      };
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
const unbase64 = (raw) =>
  Uint8Array.from(atob(raw.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
export async function verifiedGrant(
  receipt,
  now = Date.now(),
  { ownershipOnly = false } = {},
) {
  try {
    const bytes = unbase64(receipt.payload);
    const key = await crypto.subtle.importKey(
      "jwk",
      receipt.publicKey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "Ed25519",
        key,
        unbase64(receipt.signature),
        bytes,
      ))
    )
      return null;
    const p = JSON.parse(new TextDecoder().decode(bytes));
    if (
      p.version !== 1 ||
      !Number.isSafeInteger(p.accountId) ||
      !Number.isSafeInteger(p.profileId) ||
      p.accountId <= 0 ||
      p.profileId <= 0 ||
      typeof p.scope !== "string" ||
      !Number.isFinite(p.verifiedAt) ||
      !Number.isFinite(p.expiresAt) ||
      (!ownershipOnly && (now < p.verifiedAt || now >= p.expiresAt)) ||
      p.expiresAt <= p.verifiedAt ||
      p.expiresAt - p.verifiedAt > 7 * 86400000
    )
      return null;
    return p;
  } catch {
    return null;
  }
}
export async function hasSupersededPolicyMarker(active) {
  const grant = await verifiedGrant(active, Date.now(), { ownershipOnly: true });
  if (grant && await readPolicyMarkerFallback(active, grant)) return true;
  const marker = active?.supersededPolicy;
  return Boolean(grant && marker?.user_id === grant.accountId && marker?.profile_id === grant.profileId &&
    /^ep1\.[a-f0-9]{64}$/.test(marker.current_revision || "") &&
    validStoredPolicy(active.effectivePolicy, grant) && active.effectivePolicy.revision === marker.current_revision);
}
export async function mayRead(file, active) {
  if (!file?.complete || !active) return false;
  const selected = await verifiedGrant(active);
  if (await hasSupersededPolicyMarker(active)) return false;
  if (!selected || file.receipt?.publicKey?.x !== active.publicKey?.x)
    return false;
  const grant = await verifiedGrant(file.receipt, Date.now(), {
    ownershipOnly: true,
  });
  return Boolean(
    grant &&
      grant.accountId === selected.accountId &&
      grant.profileId === selected.profileId,
  );
}
export async function clearLibrary({ keepHistory = false } = {}) {
  window.dispatchEvent(new Event("movly-offline-revoked"));
  await put("settings", null, "active");
  for (const file of await allFiles()) await removeFile(file.id);
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["history", "downloads"], "readwrite");
      if (!keepHistory) tx.objectStore("history").clear();
      tx.objectStore("downloads").clear();
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  await put("settings", null, "active");
}

export async function remove(store, key) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function commitDownload(job, file, chunk) {
  const active = await get("settings", "active");
  if (!(await mayRead({ complete: true, receipt: job.receipt }, active)))
    throw new DOMException(
      translateUI("Offline oprávnění skončilo."),
      "AbortError",
    );
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(
        ["downloads", "settings", "files", "chunks"],
        "readwrite",
      );
      const task = tx.objectStore("downloads").get(job.id),
        permission = tx.objectStore("settings").get("active");
      let ready = 0;
      function apply() {
        if (++ready !== 2) return;
        if (
          !task.result ||
          !["queued", "running"].includes(task.result.state) ||
          permission.result?.payload !== active.payload
        ) {
          tx.abort();
          return;
        }
        tx.objectStore("files").put(file);
        if (chunk) tx.objectStore("chunks").put(chunk);
        if (file.complete) tx.objectStore("downloads").delete(job.id);
      }
      task.onsuccess = apply;
      permission.onsuccess = apply;
      tx.oncomplete = resolve;
      tx.onabort = () =>
        reject(
          new DOMException(
            translateUI("Stažení bylo pozastaveno."),
            "AbortError",
          ),
        );
    });
  } finally {
    db.close();
  }
}

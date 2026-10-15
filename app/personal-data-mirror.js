import { api, apiContextKey, apiContextOwner } from "./api.js";
import { effectiveContentPolicy } from "./effective-policy.js";
import {
  getPersonalDataMirror,
  updatePersonalDataMirror,
} from "./offline-store.js";

const MAX_I64 = "9223372036854775807";
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const REVISION = /^ep1\.[a-f0-9]{64}$/;
const TYPES = ["watchlist", "watchlist_item", "rating", "hidden_title"];
const VALUE_KEYS = {
  watchlist: "watchlist",
  watchlist_item: "watchlist_item",
  rating: "rating",
  hidden_title: "hidden_title",
};
const store = { get: getPersonalDataMirror, update: updatePersonalDataMirror };
let activePartition = null;
let syncing = null;
let rerunRequested = false;
let mirrorInvalidated = false;
function publishMirrorChange(expected, previousContext, acceptedContext, resetAccepted) {
  if (typeof document !== "undefined" && typeof CustomEvent !== "undefined")
    document.dispatchEvent(new CustomEvent("movly:personal-data-mirror-changed", {
      detail: { apiContext: expected.apiContext, accountId: expected.userId, profileId: expected.profileId,
        catalogContextChanged: resetAccepted || !sameContext(previousContext, acceptedContext) },
    }));
}

const exactKeys = (value, keys) =>
  value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const positiveInt = (value) => Number.isSafeInteger(value) && value > 0;
const decimal = (value) =>
  typeof value === "string" && /^(0|[1-9]\d*)$/.test(value) &&
  (value.length < MAX_I64.length || (value.length === MAX_I64.length && value <= MAX_I64));
const compareDecimal = (left, right) =>
  left.length === right.length ? (left < right ? -1 : left > right ? 1 : 0) : left.length < right.length ? -1 : 1;
const isoDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

function isValidatedReset(error) {
  const body = error?.body;
  return error?.status === 410 && body?.code === "personal_delta_reset_required" &&
    ["expired", "retention", "policy_changed", "catalog_changed", "environment_changed"].includes(body.reason) &&
    body.reset_required === true && body.preserve_pending_mutations === true &&
    body.snapshot_path === "/sync/v2/profile-data/snapshot";
}

function isUnsupportedRoute(error) {
  const code = error?.code || error?.body?.code || error?.payload?.code;
  return !code && [404, 405, 501].includes(error?.status);
}

function assertCurrent(expected) {
  const owner = expected.getOwner ? expected.getOwner() : apiContextOwner();
  const contextKey = expected.getContextKey ? expected.getContextKey() : apiContextKey();
  const origin = expected.getOrigin ? expected.getOrigin() : location.origin;
  if (
    contextKey !== expected.apiContext ||
    origin !== expected.origin ||
    expected.signal?.aborted ||
    !owner || owner.accountId !== expected.userId || owner.profileId !== expected.profileId
  )
    throw new DOMException("Personal data context changed", "AbortError");
}

function partitionFor(origin, userId, deviceId, profileId) {
  return JSON.stringify([origin, userId, deviceId, profileId]);
}

function validateEntity(entity) {
  const common = ["entity_type", "entity_id", "version", "operation"];
  if (!entity || !TYPES.includes(entity.entity_type) || !positiveInt(entity.entity_id) || !decimal(entity.version))
    throw new Error("Personal data entity identity is invalid.");
  const valueKey = VALUE_KEYS[entity.entity_type];
  if (entity.operation === "delete") {
    if (!exactKeys(entity, common)) throw new Error("Personal data tombstone is malformed.");
    return { ...entity, value: null };
  }
  if (entity.operation !== "upsert" || !exactKeys(entity, [...common, valueKey]))
    throw new Error("Personal data upsert is malformed.");
  const value = entity[valueKey];
  const idMatches = value && value.id === entity.entity_id;
  const validValue = entity.entity_type === "watchlist"
    ? typeof value.name === "string" && typeof value.is_default === "boolean" && typeof value.is_public === "boolean" && isoDate(value.created_at) && isoDate(value.updated_at) && (value.description === null || typeof value.description === "string")
    : entity.entity_type === "watchlist_item"
      ? positiveInt(value.watchlist_id) && positiveInt(value.title_id) && Number.isSafeInteger(value.priority) && isoDate(value.added_at) && (value.notes === null || typeof value.notes === "string")
      : entity.entity_type === "rating"
        ? positiveInt(value.title_id) && typeof value.rating === "number" && Number.isFinite(value.rating) && value.rating >= 0 && value.rating <= 10 && typeof value.is_public === "boolean" && isoDate(value.created_at) && isoDate(value.updated_at)
        : positiveInt(value.title_id) && typeof value.source === "string" && isoDate(value.hidden_at);
  const keys = entity.entity_type === "watchlist"
    ? ["id", "name", "description", "is_default", "is_public", "created_at", "updated_at"]
    : entity.entity_type === "watchlist_item"
      ? ["id", "watchlist_id", "title_id", "notes", "priority", "added_at"]
      : entity.entity_type === "rating"
        ? ["id", "title_id", "rating", "is_public", "created_at", "updated_at"]
        : ["id", "title_id", "source", "hidden_at"];
  if (!idMatches || !exactKeys(value, keys) || !validValue)
    throw new Error("Personal data entity value is invalid.");
  return { ...entity, value };
}

function validatePage(page, expected, mode) {
  if (!exactKeys(page, ["schema_version", "context", "mode", "entities", "has_more", "next_cursor", "highwater", "profile_revision", "expires_at"]) ||
      page.schema_version !== 1 || page.mode !== mode || !Array.isArray(page.entities) || typeof page.has_more !== "boolean" ||
      typeof page.next_cursor !== "string" || !page.next_cursor || page.next_cursor.length > 4096 ||
      !decimal(page.highwater) || !decimal(page.profile_revision) || !isoDate(page.expires_at))
    throw new Error("Personal data page is malformed.");
  const context = page.context;
  if (!exactKeys(context, ["user_id", "profile_id", "device_id", "environment", "instance_id", "policy_revision", "catalog_epoch"]) ||
      context.user_id !== expected.userId || context.profile_id !== expected.profileId || context.device_id !== expected.deviceId ||
      typeof context.environment !== "string" || !context.environment || context.environment.length > 253 ||
      !UUID.test(context.instance_id) || context.policy_revision !== expected.policyRevision || !REVISION.test(context.policy_revision) || !decimal(context.catalog_epoch))
    throw new Error("Personal data context is invalid or belongs to another owner.");
  const entities = page.entities.map(validateEntity);
  if (mode === "snapshot") {
    const ids = new Set();
    for (const entity of entities) {
      const key = `${entity.entity_type}:${entity.entity_id}`;
      if (ids.has(key)) throw new Error("Personal data page contains a duplicate entity.");
      ids.add(key);
    }
  }
  return { ...page, entities };
}

function sameContext(a, b) {
  return Boolean(a && b && a.user_id === b.user_id && a.profile_id === b.profile_id &&
    a.device_id === b.device_id && a.environment === b.environment && a.instance_id === b.instance_id &&
    a.policy_revision === b.policy_revision && a.catalog_epoch === b.catalog_epoch);
}

function applyEntities(previous, entities) {
  const next = { ...(previous || {}) };
  for (const entity of entities) {
    const key = `${entity.entity_type}:${entity.entity_id}`;
    const old = next[key];
    if (old && compareDecimal(entity.version, old.version) < 0) continue;
    if (old && entity.version === old.version) {
      if (old.operation !== entity.operation || JSON.stringify(old.value) !== JSON.stringify(entity.value))
        throw new Error("Personal data replay changed an entity at the same version.");
      continue;
    }
    next[key] = { version: entity.version, operation: entity.operation, value: entity.value };
  }
  return next;
}

function createRecord(partition, identity) {
  return {
    partition,
    identity,
    complete: false,
    context: null,
    cursor: null,
    highwater: null,
    profileRevision: null,
    expiresAt: null,
    entities: {},
    staging: null,
  };
}

function commitSnapshotPage(record, page, expected, cursor) {
  const stage = record.staging;
  if (cursor === null) {
    if (stage) throw new Error("A snapshot is already being staged.");
  } else if (!stage || stage.cursor !== cursor || !sameContext(stage.context, page.context) ||
      stage.highwater !== page.highwater || stage.profileRevision !== page.profile_revision) {
    throw new DOMException("Snapshot stage changed", "AbortError");
  }
  const entities = cursor === null ? applyEntities({}, page.entities) : applyEntities(stage.entities, page.entities);
  const nextStage = {
    context: page.context,
    cursor: page.has_more ? page.next_cursor : null,
    highwater: page.highwater,
    profileRevision: page.profile_revision,
    expiresAt: page.expires_at,
    entities,
  };
  if (page.has_more) return { ...record, complete: false, staging: nextStage };
  return {
    ...record,
    complete: true,
    context: page.context,
    cursor: page.next_cursor,
    highwater: page.highwater,
    profileRevision: page.profile_revision,
    expiresAt: page.expires_at,
    entities,
    staging: null,
  };
}

function commitChangesPage(record, page, expected, cursor) {
  if (!record.complete || record.cursor !== cursor || !sameContext(record.context, page.context))
    throw new DOMException("Changes cursor changed", "AbortError");
  if (record._pageHighwater && (record._pageHighwater !== page.highwater ||
      record._pageRevision !== page.profile_revision || record._pageCatalogEpoch !== page.context.catalog_epoch))
    throw new Error("Changes pages did not share one context and highwater boundary.");
  const next = {
    ...record,
    cursor: page.next_cursor,
    context: page.context,
    highwater: page.highwater,
    profileRevision: page.profile_revision,
    expiresAt: page.expires_at,
    entities: applyEntities(record.entities, page.entities),
    _pageHighwater: page.has_more ? page.highwater : null,
    _pageRevision: page.has_more ? page.profile_revision : null,
    _pageCatalogEpoch: page.has_more ? page.context.catalog_epoch : null,
  };
  if (!page.has_more) {
    delete next._pageHighwater;
    delete next._pageRevision;
    delete next._pageCatalogEpoch;
  }
  return next;
}

async function readPage(request, path, expected) {
  assertCurrent(expected);
  const page = await request(path, { signal: expected.signal, expectedOwner: { accountId: expected.userId, profileId: expected.profileId } });
  assertCurrent(expected);
  return page;
}

async function currentPolicy(getPolicy, expected) {
  const policy = await getPolicy({ refresh: true, signal: expected.signal });
  assertCurrent(expected);
  if (!policy || policy.user_id !== expected.userId || policy.profile_id !== expected.profileId || !REVISION.test(policy.revision))
    return null;
  return policy;
}

function query(path, deviceId, limit, cursor) {
  const params = new URLSearchParams({ device_id: deviceId, limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return `${path}?${params}`;
}

async function commitPage(storage, partition, expected, page, mode, cursor) {
  assertCurrent(expected);
  const validated = validatePage(page, expected, mode);
  const result = await storage.update(partition, (record) => {
    assertCurrent(expected);
    if (mode === "snapshot") return commitSnapshotPage(record, validated, expected, cursor);
    return commitChangesPage(record, validated, expected, cursor);
  });
  assertCurrent(expected);
  if (!result) throw new DOMException("Personal mirror commit was superseded", "AbortError");
  return validated;
}

async function snapshot(request, storage, partition, expected, limit, startCursor = null, onReset = () => {}) {
  let cursor = startCursor;
  for (let pages = 0; pages < 1000; pages++) {
    const path = query("sync/v2/profile-data/snapshot", expected.deviceId, limit, cursor);
    let page;
    try {
      page = await readPage(request, path, expected);
    } catch (error) {
      if (isUnsupportedRoute(error)) { mirrorInvalidated = true; return { status: "unsupported" }; }
      if (error?.status === 410) {
        if (!isValidatedReset(error))
          throw new Error("Personal data reset response did not preserve pending mutations.");
        assertCurrent(expected);
        onReset();
        await storage.update(partition, (record) => {
          assertCurrent(expected);
          return createRecord(partition, record.identity || expected.identity);
        });
        if (cursor === null) throw error;
        cursor = null;
        continue;
      }
      throw error;
    }
    const validated = await commitPage(storage, partition, expected, page, "snapshot", cursor);
    if (!validated.has_more) return { status: "complete", pages: pages + 1 };
    cursor = validated.next_cursor;
  }
  throw new Error("Personal data snapshot exceeded its page limit.");
}

async function changes(request, storage, partition, expected, limit, startCursor) {
  let cursor = startCursor;
  for (let pages = 0; pages < 1000; pages++) {
    const path = query("sync/v2/profile-data/changes", expected.deviceId, limit, cursor);
    let page;
    try { page = await readPage(request, path, expected); }
    catch (error) {
      if (isUnsupportedRoute(error)) { mirrorInvalidated = true; return { status: "unsupported" }; }
      throw error;
    }
    const validated = await commitPage(storage, partition, expected, page, "changes", cursor);
    if (!validated.has_more) return { status: "complete", pages: pages + 1 };
    cursor = validated.next_cursor;
  }
  throw new Error("Personal data changes exceeded its page limit.");
}

export async function syncPersonalDataMirror(
  request = api,
  {
    storage = store,
    getContextKey = apiContextKey,
    getOwner = apiContextOwner,
    getOrigin = () => location.origin,
    getPolicy = effectiveContentPolicy,
    signal,
    limit = 250,
  } = {},
) {
  if (syncing) { rerunRequested = true; return syncing; }
  const run = async () => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("Personal data page size is invalid.");
    const owner = getOwner(), origin = getOrigin();
    if (!owner || !positiveInt(owner.accountId) || !positiveInt(owner.profileId) || typeof origin !== "string")
      return { status: "no-owner" };
    const expected = {
      apiContext: getContextKey(), origin, userId: owner.accountId, profileId: owner.profileId,
      deviceId: null, policyRevision: null, identity: null,
      getContextKey, getOwner, getOrigin, signal,
    };
    assertCurrent(expected);
    const policy = await currentPolicy(getPolicy, expected);
    if (!policy) return { status: "policy-unavailable" };
    const device = await readPage(request, "sync/device", expected);
    if (!device || !UUID.test(device.device_id || "")) throw new Error("Managed device identity is invalid.");
    expected.deviceId = device.device_id.toLowerCase();
    expected.policyRevision = policy.revision;
    expected.identity = { origin, userId: expected.userId, deviceId: expected.deviceId, profileId: expected.profileId };
    const partition = partitionFor(origin, expected.userId, expected.deviceId, expected.profileId);
    assertCurrent(expected);
    let record = await storage.get(partition);
    assertCurrent(expected);
    if (!record || record.identity?.origin !== origin || record.identity?.userId !== expected.userId ||
        record.identity?.deviceId !== expected.deviceId || record.identity?.profileId !== expected.profileId) {
      record = createRecord(partition, expected.identity);
      await storage.update(partition, () => record);
      assertCurrent(expected);
    }
    const previousContext = record.complete ? record.context : null;
    let resetAccepted = false;
    const acceptReset = () => {
      assertCurrent(expected);
      mirrorInvalidated = true;
      resetAccepted = true;
      // Fence catalogue readers before the replacement mirror/storage can fail.
      publishMirrorChange(expected, previousContext, null, true);
    };
    if (record.complete && record.context?.policy_revision !== expected.policyRevision) {
      record = await storage.update(partition, (current) => {
        assertCurrent(expected);
        return createRecord(partition, current.identity || expected.identity);
      }) || createRecord(partition, expected.identity);
    }
    activePartition = { partition, expected: { ...expected } };
    if (record.complete && record.cursor && sameContext(record.context, {
      user_id: expected.userId, profile_id: expected.profileId, device_id: expected.deviceId,
      environment: record.context.environment, instance_id: record.context.instance_id,
      policy_revision: expected.policyRevision, catalog_epoch: record.context.catalog_epoch,
    })) {
      try {
        const result = await changes(request, storage, partition, expected, limit, record.cursor);
        if (result.status === "unsupported") return result;
        if (!rerunRequested) mirrorInvalidated = false;
        const accepted = await storage.get(partition);
        assertCurrent(expected);
        publishMirrorChange(expected, resetAccepted ? accepted?.context : previousContext, accepted?.context, false);
        return result;
      } catch (error) {
        if (error?.status !== 410) throw error;
        if (!isValidatedReset(error))
          throw new Error("Personal data reset response did not preserve pending mutations.");
        acceptReset();
        await storage.update(partition, (current) => {
          assertCurrent(expected);
          return createRecord(partition, expected.identity);
        });
      }
    }
    const current = await storage.get(partition);
    assertCurrent(expected);
    const stage = current?.staging;
    const stageValid = stage && stage.context?.user_id === expected.userId &&
      stage.context?.profile_id === expected.profileId && stage.context?.device_id === expected.deviceId &&
      stage.context?.policy_revision === expected.policyRevision;
    if (stage && !stageValid) {
      await storage.update(partition, (record) => {
        assertCurrent(expected);
        return createRecord(partition, record.identity || expected.identity);
      });
    }
    const result = await snapshot(request, storage, partition, expected, limit, stageValid ? stage.cursor : null, acceptReset);
    if (result.status === "complete") {
      if (!rerunRequested) mirrorInvalidated = false;
      const accepted = await storage.get(partition);
      assertCurrent(expected);
      publishMirrorChange(expected, resetAccepted ? accepted?.context : previousContext, accepted?.context, false);
    }
    return result;
  };
  syncing = run().finally(() => {
    syncing = null;
    if (rerunRequested) {
      rerunRequested = false;
      void syncPersonalDataMirror(request, { storage, getContextKey, getOwner, getOrigin, getPolicy, limit }).catch(() => {});
    }
  });
  return syncing;
}

async function currentMirror(request, options = {}) {
  const {
    storage = store, getPolicy = effectiveContentPolicy, getOwner = apiContextOwner,
    getOrigin = () => location.origin, getContextKey = apiContextKey, limit = 250, signal,
  } = options;
  const owner = getOwner(), origin = getOrigin();
  if (!owner || !positiveInt(owner.accountId) || !positiveInt(owner.profileId) || typeof origin !== "string") return null;
  const policy = await getPolicy({ signal });
  if (!policy || policy.user_id !== owner.accountId || policy.profile_id !== owner.profileId || !REVISION.test(policy.revision)) return null;
  const expected = { apiContext: getContextKey(), origin, userId: owner.accountId, profileId: owner.profileId, policyRevision: policy.revision, getOwner, getOrigin, getContextKey, signal };
  assertCurrent(expected);
  if (mirrorInvalidated) return null;
  let refreshed;
  try {
    refreshed = await syncPersonalDataMirror(request, { storage, getPolicy: async () => policy, getOwner, getOrigin, getContextKey, limit, signal });
  } catch (error) { return null; }
  assertCurrent(expected);
  if (refreshed?.status !== "complete" || mirrorInvalidated) return null;
  let partition = activePartition?.expected?.apiContext === expected.apiContext && activePartition?.expected?.origin === origin ? activePartition.partition : null;
  if (!partition) {
    const device = await readPage(request, "sync/device", expected);
    if (!UUID.test(device?.device_id || "")) return null;
    partition = partitionFor(origin, owner.accountId, device.device_id.toLowerCase(), owner.profileId);
  }
  const record = await storage.get(partition);
  assertCurrent(expected);
  if (!record?.complete || !record.cursor || record.identity?.origin !== origin || record.identity?.userId !== owner.accountId ||
      record.identity?.profileId !== owner.profileId || record.context?.device_id !== record.identity.deviceId ||
      record.context?.policy_revision !== policy.revision || record.context?.user_id !== owner.accountId || record.context?.profile_id !== owner.profileId ||
      !isoDate(record.expiresAt) || Date.parse(record.expiresAt) <= Date.now()) return null;
  activePartition = { partition, expected: { ...expected, deviceId: record.identity.deviceId } };
  return { record, expected };
}

export async function personalDataForTitle(titleId, request = api, options = {}) {
  if (!positiveInt(titleId)) return null;
  const current = await currentMirror(request, options);
  if (!current) return null;
  const { record } = current;
  const hidden = Object.entries(record.entities).some(([key, entity]) => key.startsWith("hidden_title:") && entity.operation === "upsert" &&
    entity.value?.title_id === titleId && entity.value?.source === "continue_watching");
  const ratingEntry = Object.entries(record.entities).find(([key, entity]) => key.startsWith("rating:") && entity.operation === "upsert" && entity.value?.title_id === titleId);
  return {
    hidden,
    mine: ratingEntry ? { has_rated: true, rating: ratingEntry[1].value } : { has_rated: false, rating: null },
    verified: true,
  };
}


export function invalidatePersonalDataMirror() {
  mirrorInvalidated = true;
}

export function markPersonalDataMirrorCurrent() {
  mirrorInvalidated = false;
}

import { translateUI } from "./i18n.js";
import {
  get,
  allEntries,
  updateOfflineHistory,
  verifiedGrant,
} from "./offline-store.js";

const store = {
  getFile: (id) => get("files", id),
  entries: () => allEntries("history"),
  active: () => get("settings", "active"),
  update: updateOfflineHistory,
};

export async function sameOfflineOwner(receipt, active) {
  if (!receipt || !active || receipt.publicKey?.x !== active.publicKey?.x)
    return false;
  const [owner, selected] = await Promise.all([
    verifiedGrant(receipt, Date.now(), { ownershipOnly: true }),
    verifiedGrant(active),
  ]);
  return Boolean(
    owner &&
      selected &&
      owner.accountId === selected.accountId &&
      owner.profileId === selected.profileId,
  );
}

export function offlineWatchValue(
  base,
  identity,
  position,
  duration,
  ended = false,
) {
  if (
    !Number.isSafeInteger(identity?.titleId) ||
    identity.titleId <= 0 ||
    !["movie", "tv"].includes(identity.type)
  )
    throw new Error(
      translateUI(
        "Stažení nemá ověřenou identitu titulu. Stáhni ho znovu pro synchronizaci historie.",
      ),
    );
  if (
    identity.type === "tv" &&
    (!Number.isSafeInteger(identity.season) ||
      identity.season < 0 ||
      !Number.isSafeInteger(identity.episode) ||
      identity.episode <= 0)
  )
    throw new Error(translateUI("Chybí identita epizody."));
  if (
    !Number.isFinite(position) ||
    position < 0 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 2147483647
  )
    throw new Error(
      translateUI("Video nemá platnou délku pro uložení historie."),
    );
  const seconds = Math.min(Math.floor(duration), Math.floor(position));
  return {
    title_id: identity.titleId,
    season_number: identity.type === "tv" ? identity.season : null,
    episode_number: identity.type === "tv" ? identity.episode : null,
    progress_seconds: seconds,
    duration_seconds: Math.floor(duration),
    watch_status:
      ended || seconds >= duration * 0.85 ? "completed" : "watching",
    rating: base?.rating ?? null,
    notes: base?.notes ?? null,
    is_favorite: base?.is_favorite ?? false,
    device_type: "web",
    platform: "web",
    provider_id: base?.provider_id ?? null,
    ident: base?.ident ?? null,
  };
}

export function offlineEntityKey(identity) {
  return `title:${identity.titleId}:season:${identity.type === "tv" ? identity.season : "null"}:episode:${identity.type === "tv" ? identity.episode : "null"}`;
}

export async function captureOfflineBase(
  request,
  identity,
  receipt,
  storage = store,
) {
  offlineWatchValue(null, identity, 0, 1);
  const expectedOwner = await verifiedGrant(receipt, Date.now(), {
    ownershipOnly: true,
  });
  const key = offlineEntityKey(identity);
  let token = null;
  for (let page = 0; page < 1000; page++) {
    if (!(await sameOfflineOwner(receipt, await storage.active())))
      throw new Error(translateUI("Aktivní profil se změnil."));
    const snapshot = await request(
      `sync/v2/snapshot/pages?limit=100${token ? `&page_token=${encodeURIComponent(token)}` : ""}`,
      { expectedOwner },
    );
    if (
      !Array.isArray(snapshot.entities) ||
      !snapshot.coverage?.includes("watch_history")
    )
      throw new Error(translateUI("API nepotvrdilo synchronizační stav."));
    const entity = snapshot.entities.find(
      (e) => e.entity_type === "watch_history" && e.entity_key === key,
    );
    if (entity) {
      if (!Number.isSafeInteger(entity.version) || entity.version < 0)
        throw new Error(translateUI("API vrátilo neplatnou verzi historie."));
      return {
        version: entity.version,
        value: entity.deleted ? null : entity.value,
      };
    }
    if (snapshot.has_more === false) return { version: 0, value: null };
    if (
      typeof snapshot.next_page_token !== "string" ||
      !snapshot.next_page_token ||
      snapshot.next_page_token === token
    )
      throw new Error(translateUI("API nevrátilo pokračování synchronizace."));
    token = snapshot.next_page_token;
  }
  throw new Error(
    translateUI("Historie je příliš rozsáhlá. Zkus stažení znovu později."),
  );
}

export async function recordOfflineProgress(
  id,
  position,
  duration,
  ended = false,
  storage = store,
) {
  const file = await storage.getFile(id),
    active = await storage.active();
  if (!file?.complete || !(await sameOfflineOwner(file.receipt, active)))
    throw new Error(translateUI("Offline oprávnění skončilo."));
  if (!Number.isSafeInteger(file.syncBase?.version))
    throw new Error(
      translateUI("Starší stažení nemá synchronizační stav. Stáhni ho znovu."),
    );
  return storage.update(id, (current, entry) => {
    if (!current?.complete || current.receipt.payload !== file.receipt.payload)
      throw new Error(translateUI("Stažení se změnilo."));
    const value = offlineWatchValue(
      current.syncBase.value,
      current.identity,
      position,
      duration,
      ended,
    );
    const last = entry?.draft || entry?.bound?.value || current.syncBase.value;
    if (last && Object.keys(value).every((key) => value[key] === last[key]))
      return {
        file: {
          ...current,
          position: Math.min(position, duration),
          watched: value.watch_status === "completed",
        },
        entry,
      };
    return {
      file: {
        ...current,
        position: Math.min(position, duration),
        watched: value.watch_status === "completed",
      },
      entry: {
        ...entry,
        id,
        receipt: current.receipt,
        identity: current.identity,
        syncBase: current.syncBase,
        draft: value,
        updatedAt: Date.now(),
      },
    };
  });
}

let flushing = false;
export async function flushOfflineHistory(request, storage = store) {
  if (flushing) return;
  flushing = true;
  try {
    for (const item of await storage.entries()) {
      if (
        !(await sameOfflineOwner(item.receipt, await storage.active())) ||
        item.conflict
      )
        continue;
      const expectedOwner = await verifiedGrant(item.receipt, Date.now(), {
        ownershipOnly: true,
      });
      for (let attempt = 0; attempt < 20; attempt++) {
        if (!(await sameOfflineOwner(item.receipt, await storage.active())))
          break;
        const device = await request("sync/device", { expectedOwner });
        if (!(await sameOfflineOwner(item.receipt, await storage.active())))
          break;
        if (
          !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
            device?.device_id || "",
          )
        )
          throw new Error(translateUI("API nepotvrdilo spravované zařízení."));
        const bound = await storage.update(item.id, (file, entry) => {
          if (!entry || entry.conflict || (!entry.bound && !entry.draft))
            return;
          if (!entry.bound) {
            const base = file?.syncBase || entry.syncBase;
            entry = {
              ...entry,
              draft: null,
              bound: {
                device_id: device.device_id,
                mutation_id: crypto.randomUUID(),
                entity_type: "watch_history",
                entity_key: offlineEntityKey(entry.identity),
                base_version: base.version,
                operation: "upsert",
                value: entry.draft,
              },
            };
            entry.deviceId = entry.bound.device_id;
          }
          return { entry, file };
        });
        if (!bound) break;
        const mutation = bound.entry.bound;
        try {
          if (!(await sameOfflineOwner(item.receipt, await storage.active())))
            break;
          const result = await request("sync/v2/mutations", {
            method: "POST",
            body: mutation,
            expectedOwner,
          });
          if (
            result.mutation_id !== mutation.mutation_id ||
            !["applied", "resolved_local", "resolved_server"].includes(
              result.status,
            ) ||
            result.entity?.entity_key !== mutation.entity_key ||
            !Number.isSafeInteger(result.entity.version)
          )
            throw new Error(translateUI("API nepotvrdilo offline historii."));
          await storage.update(item.id, (file, entry) => {
            if (entry?.bound?.mutation_id !== mutation.mutation_id) return;
            const base = {
              version: result.entity.version,
              value: result.entity.deleted ? null : result.entity.value,
            };
            return {
              file: file ? { ...file, syncBase: base } : null,
              entry: entry.draft
                ? { ...entry, syncBase: base, bound: null, error: null }
                : null,
            };
          });
        } catch (error) {
          if (
            error.status === 403 &&
            error.code === "sync_v2_device_unavailable"
          ) {
            await storage.update(item.id, (file, entry) =>
              entry?.bound?.mutation_id === mutation.mutation_id
                ? {
                    file,
                    entry: {
                      ...entry,
                      draft: entry.draft || mutation.value,
                      bound: null,
                      deviceId: null,
                      error: error.message,
                    },
                  }
                : null,
            );
            break;
          }
          await storage.update(item.id, (file, entry) =>
            entry?.bound?.mutation_id === mutation.mutation_id
              ? {
                  file,
                  entry: {
                    ...entry,
                    error: error.message,
                    ...(error.status === 409 && error.body?.conflict
                      ? { conflict: error.body.conflict }
                      : {}),
                  },
                }
              : null,
          );
          if ([401, 403].includes(error.status)) return;
          break;
        }
      }
    }
  } finally {
    flushing = false;
  }
}

export async function resolveOfflineConflict(
  request,
  id,
  resolution,
  storage = store,
) {
  if (!["local", "server"].includes(resolution))
    throw new Error(translateUI("Neplatná volba synchronizace."));
  const entry = (await storage.entries()).find((e) => e.id === id);
  if (
    !entry?.conflict ||
    !(await sameOfflineOwner(entry.receipt, await storage.active()))
  )
    throw new Error(translateUI("Vyber původní profil."));
  const expectedOwner = await verifiedGrant(entry.receipt, Date.now(), {
    ownershipOnly: true,
  });
  const device = await request("sync/device", { expectedOwner });
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
      device?.device_id || "",
    )
  )
    throw new Error(translateUI("API nepotvrdilo spravované zařízení."));
  if (!(await sameOfflineOwner(entry.receipt, await storage.active())))
    throw new Error(translateUI("Aktivní profil se změnil."));
  const prepared = await storage.update(id, (file, row) => ({
    file,
    entry: {
      ...row,
      resolution: row.resolution || {
        device_id: device.device_id,
        mutation_id: crypto.randomUUID(),
        resolution,
        expected_server_version: row.conflict.server_version,
      },
    },
  }));
  if (prepared.entry.resolution.resolution !== resolution)
    throw new Error(
      translateUI("Nejprve dokonči předchozí volbu synchronizace."),
    );
  let result;
  try {
    result = await request(`sync/v2/conflicts/${entry.conflict.id}/resolve`, {
      method: "POST",
      body: prepared.entry.resolution,
      expectedOwner,
    });
  } catch (error) {
    if (error.status === 403 && error.code === "sync_v2_device_unavailable") {
      await storage.update(id, (file, row) =>
        row?.resolution?.mutation_id === prepared.entry.resolution.mutation_id
          ? { file, entry: { ...row, resolution: null, error: error.message } }
          : null,
      );
    }
    if (error.status === 409 && error.code === "sync_v2_conflict_closed") {
      await storage.update(id, (file, row) =>
        row?.resolution?.mutation_id === prepared.entry.resolution.mutation_id
          ? {
              file,
              entry: {
                ...row,
                resolution: null,
                conflict: null,
                bound: null,
                draft: row.draft || row.bound?.value,
                error: error.message,
              },
            }
          : null,
      );
      await flushOfflineHistory(request, storage);
    }
    if (error.status === 409 && error.code === "sync_v2_conflict_stale") {
      const current = await captureOfflineBase(
        request,
        entry.identity,
        entry.receipt,
        storage,
      );
      await storage.update(id, (file, row) =>
        row?.resolution?.mutation_id === prepared.entry.resolution.mutation_id
          ? {
              file,
              entry: {
                ...row,
                resolution: null,
                conflict: {
                  ...row.conflict,
                  server_version: current.version,
                  server_value: current.value,
                  server_deleted: current.value === null,
                },
                error: error.message,
              },
            }
          : null,
      );
    }
    throw error;
  }
  if (
    result.mutation_id !== prepared.entry.resolution.mutation_id ||
    result.status !== "resolved_" + resolution ||
    result.entity?.entity_key !== offlineEntityKey(entry.identity) ||
    !Number.isSafeInteger(result.entity?.version)
  )
    throw new Error(translateUI("API nepotvrdilo vyřešení historie."));
  await storage.update(id, (file, row) => {
    if (row?.resolution?.mutation_id !== prepared.entry.resolution.mutation_id)
      return;
    const base = {
      version: result.entity.version,
      value: result.entity.deleted ? null : result.entity.value,
    };
    return {
      file: file
        ? {
            ...file,
            syncBase: base,
            ...(resolution === "server"
              ? {
                  position: base.value?.progress_seconds || 0,
                  watched: base.value?.watch_status === "completed",
                }
              : {}),
          }
        : null,
      entry:
        resolution !== "server" && row.draft
          ? {
              ...row,
              syncBase: base,
              bound: null,
              conflict: null,
              resolution: null,
              error: null,
            }
          : null,
    };
  });
  await flushOfflineHistory(request, storage);
}

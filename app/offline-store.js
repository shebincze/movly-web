import { translateUI } from "./i18n.js";
export const CHUNK_BYTES = 512 * 1024;
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
export async function mayRead(file, active) {
  if (!file?.complete || !active) return false;
  const selected = await verifiedGrant(active);
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

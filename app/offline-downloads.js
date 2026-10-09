import { translateUI } from "./i18n.js";
import { api } from "./api.js";
import {
  allFiles,
  allEntries,
  get,
  put,
  remove,
  removeFile,
  verifiedGrant,
  CHUNK_BYTES,
  commitDownload,
} from "./offline-store.js";
import { sameOfflineOwner, captureOfflineBase } from "./offline-history.js";
import { episodeReleaseState } from "./episode-policy.js";
let running = false,
  wake = false,
  controller;
const announce = () =>
  window.dispatchEvent(new Event("movly-downloads-changed"));
window.addEventListener("movly-offline-revoked", () => controller?.abort());
window.addEventListener("offline", () => controller?.abort());
export async function queueOffline(title, episode, selection) {
  if (episode && episodeReleaseState(episode.air_date) === "upcoming")
    throw new Error(translateUI("Epizoda ještě neměla premiéru."));
  const receipt = await api("offline-grant", { method: "POST", body: {} });
  if (!(await verifiedGrant(receipt)))
    throw new Error(translateUI("Server nevydal platné offline oprávnění."));
  await put("settings", receipt, "active");
  const identity = {
    titleId: title.id,
    type: title.type,
    season: episode?.season_number ?? null,
    episode: episode?.episode_number ?? null,
  };
  const previous = (await allEntries("downloads")).find(
    (job) =>
      JSON.stringify(job.identity) === JSON.stringify(identity) &&
      job.receipt.payload === receipt.payload,
  );
  // A renewed receipt can resume the same owner's queue, but never another profile.
  let owned = previous;
  if (!owned)
    for (const job of await allEntries("downloads"))
      if (
        JSON.stringify(job.identity) === JSON.stringify(identity) &&
        (await sameOfflineOwner(job.receipt, receipt))
      ) {
        owned = job;
        break;
      }
  if (owned && ["queued", "running"].includes(owned.state)) return owned.id;
  const job = {
    ...owned,
    id: owned?.id || crypto.randomUUID(),
    title,
    episode,
    identity,
    selection,
    receipt,
    state: "queued",
    error: null,
    createdAt: owned?.createdAt || Date.now(),
  };
  await put("downloads", job);
  announce();
  void runDownloads();
  return job.id;
}
export async function changeDownload(id, action) {
  const job = await get("downloads", id);
  if (
    !job ||
    !(await sameOfflineOwner(job.receipt, await get("settings", "active")))
  )
    throw new Error(translateUI("Vyber původní profil stažení."));
  if (action === "cancel") {
    if (controller?.jobId === id) controller.abort();
    await remove("downloads", id);
    await removeFile(id);
  } else {
    job.state = action === "pause" ? "paused" : "queued";
    job.error = null;
    await put("downloads", job);
    if (action === "pause" && controller?.jobId === id) controller.abort();
  }
  announce();
  if (action === "resume") void runDownloads();
}
async function permitted(job) {
  const current = await get("downloads", job.id);
  if (
    !current ||
    ["paused", "failed"].includes(current.state) ||
    !(await sameOfflineOwner(job.receipt, await get("settings", "active")))
  )
    throw new DOMException(
      translateUI("Stažení bylo pozastaveno."),
      "AbortError",
    );
  controller.signal.throwIfAborted();
}
async function download(job) {
  controller = new AbortController();
  controller.jobId = job.id;
  let session;
  const expectedOwner = await verifiedGrant(job.receipt, Date.now(), {
    ownershipOnly: true,
  });
  const ownedAPI = (path, options = {}) =>
    api(path, { ...options, expectedOwner });
  try {
    await permitted(job);
    const receipt = await ownedAPI("offline-grant", {
      method: "POST",
      body: {},
    });
    if (!(await sameOfflineOwner(job.receipt, receipt)))
      throw new Error(translateUI("Stažení patří k jinému profilu."));
    await put("settings", receipt, "active");
    const base = await captureOfflineBase(api, job.identity, receipt);
    const maxBytes =
      Number(await get("settings", "fileLimit")) || 2 * 1024 ** 3;
    session = await ownedAPI("playback", {
      method: "POST",
      body: {
        ...job.selection,
        offline_export: true,
        offset: 0,
        max_bytes: maxBytes,
      },
      signal: controller.signal,
    });
    let state;
    while (true) {
      await permitted(job);
      state = await ownedAPI("playback/" + session.id + "/status", {
        signal: controller.signal,
      });
      if (state.error) throw new Error(state.error);
      if (state.ready) break;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1000);
        controller.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
    if (
      !Number.isSafeInteger(state.size) ||
      state.size <= 0 ||
      !/^[a-f0-9]{64}$/.test(state.etag || "")
    )
      throw new Error(translateUI("Server nepotvrdil úplnost stažení."));
    let file = await get("files", job.id);
    if (
      file &&
      (file.etag !== state.etag || file.size > state.size || file.complete)
    ) {
      await removeFile(job.id);
      file = null;
    }
    const used = (await allFiles())
      .filter((f) => f.id !== job.id)
      .reduce((n, f) => n + f.size, 0);
    const limit = Number(await get("settings", "limit")) || 4 * 1024 ** 3,
      estimate = await navigator.storage.estimate();
    if (
      used + state.size > limit ||
      (estimate.quota &&
        state.size - (file?.size || 0) > estimate.quota - (estimate.usage || 0))
    )
      throw new Error(
        translateUI(
          "V offline knihovně není dost místa. Zvyš limit nebo odstraň starší stažení.",
        ),
      );
    if (!file) {
      file = {
        id: job.id,
        title: job.title.title,
        episode: job.episode
          ? "S" + job.identity.season + " E" + job.identity.episode
          : null,
        identity: job.identity,
        syncBase: base,
        receipt,
        key: await crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        ),
        etag: state.etag,
        size: 0,
        complete: false,
        position: 0,
        createdAt: Date.now(),
      };
      await permitted(job);
      await commitDownload(job, file);
    }
    // Resume only bytes from the identical, fully hashed export. A new export
    // with different bytes restarts instead of mixing two MP4 files.
    if (file.size === state.size) {
      await permitted(job);
      file.complete = true;
      await commitDownload(job, file);
      return;
    }
    if (file.size % CHUNK_BYTES) {
      file.size -= file.size % CHUNK_BYTES;
      await commitDownload(job, file);
    }
    const response = await fetch(
      "/api/app/playback/" + session.id + "/export.mp4",
      {
        signal: controller.signal,
        credentials: "same-origin",
        headers: file.size
          ? {
              Range: "bytes=" + file.size + "-",
              "If-Range": '"' + file.etag + '"',
            }
          : {},
      },
    );
    if (
      !response.ok ||
      !response.body ||
      response.headers.get("etag") !== '"' + file.etag + '"' ||
      (file.size &&
        (response.status !== 206 ||
          response.headers.get("content-range") !==
            "bytes " + file.size + "-" + (state.size - 1) + "/" + state.size))
    )
      throw new Error(
        translateUI("Server nepotvrdil pokračování stejného souboru."),
      );
    const reader = response.body.getReader();
    let pending = new Uint8Array(),
      index = file.size / CHUNK_BYTES;
    if (!Number.isInteger(index))
      throw new Error(translateUI("Neplatný bod obnovení stažení."));
    async function save(bytes) {
      await permitted(job);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: new TextEncoder().encode(file.id + ":" + index),
        },
        file.key,
        bytes,
      );
      await permitted(job);
      file.size += bytes.length;
      await commitDownload(job, file, {
        id: file.id,
        index: index++,
        iv,
        data,
      });
      announce();
    }
    while (true) {
      await permitted(job);
      const { value, done } = await reader.read();
      if (done) break;
      const joined = new Uint8Array(pending.length + value.length);
      joined.set(pending);
      joined.set(value, pending.length);
      pending = joined;
      while (pending.length >= CHUNK_BYTES) {
        await save(pending.slice(0, CHUNK_BYTES));
        pending = pending.slice(CHUNK_BYTES);
      }
    }
    if (pending.length) await save(pending);
    if (file.size !== state.size)
      throw new Error(translateUI("Stažení není úplné."));
    await permitted(job);
    file.complete = true;
    await commitDownload(job, file);
    await navigator.storage.persist?.();
  } catch (error) {
    const remaining = await get("downloads", job.id);
    if (remaining && remaining.state !== "paused") {
      remaining.state = error.name === "AbortError" ? "queued" : "failed";
      remaining.error = error.name === "AbortError" ? null : error.message;
      await put("downloads", remaining);
    }
  } finally {
    if (session)
      await ownedAPI("playback/" + session.id, { method: "DELETE" }).catch(
        () => {},
      );
    controller = null;
    announce();
  }
}
export async function runDownloads() {
  if (!navigator.onLine || !navigator.locks) return;
  if (running) {
    wake = true;
    return;
  }
  running = true;
  try {
    await navigator.locks.request("movly-offline-downloads", async () => {
      const attempted = new Set();
      while (true) {
        const active = await get("settings", "active");
        let job;
        for (const candidate of (await allEntries("downloads")).sort(
          (a, b) => a.createdAt - b.createdAt,
        )) {
          if (
            !attempted.has(candidate.id) &&
            ["queued", "running"].includes(candidate.state) &&
            (await sameOfflineOwner(candidate.receipt, active))
          ) {
            job = candidate;
            break;
          }
        }
        if (!job) break;
        attempted.add(job.id);
        if (!navigator.onLine) break;
        if (
          !["queued", "running"].includes(job.state) ||
          !(await sameOfflineOwner(
            job.receipt,
            await get("settings", "active"),
          ))
        )
          continue;
        job.state = "running";
        await put("downloads", job);
        announce();
        await download(job);
      }
    });
  } finally {
    running = false;
    if (wake) {
      wake = false;
      void runDownloads();
    }
  }
}
window.addEventListener("online", () => void runDownloads());

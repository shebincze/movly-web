import { translateUI } from "./i18n.js";
import { allEntries, get, put, remove, removeFile } from "./offline-store.js";
import { sameOfflineOwner } from "./offline-history.js";
let running = false,
  wake = false;
const announce = () =>
  window.dispatchEvent(new Event("movly-downloads-changed"));
const APP_ONLY = translateUI("Offline sledování je dostupné v aplikaci Movly.");
export async function queueOffline() {
  throw new Error(APP_ONLY);
}
export async function changeDownload(id, action) {
  const job = await get("downloads", id);
  if (
    !job ||
    !(await sameOfflineOwner(job.receipt, await get("settings", "active")))
  )
    throw new Error(translateUI("Vyber původní profil stažení."));
  if (action === "cancel") {
    await remove("downloads", id);
    await removeFile(id);
  } else {
    job.state = action === "pause" ? "paused" : "queued";
    job.error = null;
    await put("downloads", job);
  }
  announce();
  if (action === "resume") void runDownloads();
}
// Offline kopie vznikala exportem na serveru; video ale přes server nesmí
// jít (#153). Rozpracované stažení skončí s odkazem na aplikaci.
async function download(job) {
  job.state = "failed";
  job.error = APP_ONLY;
  await put("downloads", job);
  announce();
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

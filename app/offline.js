import { translateUI } from "./i18n.js";
import { nextReleasedEpisode, episodeReleaseState } from "./episode-policy.js";
import { api } from "./api.js";
import { el, button, loading, toast } from "./ui.js";
import {
  allFiles,
  allEntries,
  put,
  get,
  removeFile,
  verifiedGrant,
  mayRead,
} from "./offline-store.js";
import {
  sameOfflineOwner,
  recordOfflineProgress,
  flushOfflineHistory,
  resolveOfflineConflict,
} from "./offline-history.js";
export { clearLibrary } from "./offline-store.js";
import {
  queueOffline,
  changeDownload,
  runDownloads,
} from "./offline-downloads.js";
window.addEventListener("movly-offline-revoked", () =>
  put("settings", null, "active").catch(() => {}),
);
export async function revokeOfflineContext() {
  window.dispatchEvent(new Event("movly-offline-revoked"));
  await put("settings", null, "active");
}
export async function registerOffline() {
  if (!isSecureContext || !("serviceWorker" in navigator)) return false;
  await navigator.serviceWorker.register("/app/offline-sw.js", {
    type: "module",
    scope: "/app/",
  });
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(translateUI("Offline knihovna se nepodařila připravit.")),
          ),
        10000,
      ),
    ),
  ]);
  if (!navigator.serviceWorker.controller)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        navigator.serviceWorker.removeEventListener("controllerchange", ready);
        reject(
          new Error(
            translateUI("Offline knihovna zatím není aktivní. Obnov stránku."),
          ),
        );
      }, 5000);
      function ready() {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener("controllerchange", ready);
        resolve();
      }
      navigator.serviceWorker.addEventListener("controllerchange", ready);
      if (navigator.serviceWorker.controller) ready();
    });
  return true;
}
export async function synchronizeOfflineContext() {
  try {
    await put(
      "settings",
      await api("offline-grant", { method: "POST", body: {} }),
      "active",
    );
    await flushOfflineHistory(api);
    void runDownloads();
  } catch (error) {
    if ([401, 403, 409].includes(error.status))
      await put("settings", null, "active");
  }
}
export async function saveOffline(title, episode, selection) {
  if (!(await registerOffline()) || !navigator.locks)
    throw new Error(
      translateUI("Offline knihovna vyžaduje podporovaný prohlížeč a HTTPS."),
    );
  await queueOffline(title, episode, selection);
  toast(
    translateUI(
      "Stažení je ve frontě. Průběh a obnovení najdeš v Offline knihovně.",
    ),
  );
}
const libraryObservers = new WeakMap();
export async function offlineLibrary(
  container,
  onLogin = () => location.reload(),
) {
  libraryObservers.get(container)?.();
  container.replaceChildren(loading());
  const active = await get("settings", "active"),
    grant = active && (await verifiedGrant(active));
  const list = el("div", { class: "dialog-form" });
  const limit = el(
    "select",
    {
      "aria-label": translateUI("Limit offline úložiště"),
      onChange: (event) => put("settings", Number(event.target.value), "limit"),
    },
    ...[1, 2, 4, 8, 16, 32].map((gb) =>
      el("option", { value: gb * 1024 ** 3 }, `${gb} GB`),
    ),
  );
  limit.value = String(Number(await get("settings", "limit")) || 4 * 1024 ** 3);
  const fileLimit = el(
    "select",
    {
      "aria-label": translateUI("Limit offline souboru"),
      onChange: (event) =>
        put("settings", Number(event.target.value), "fileLimit"),
    },
    ...[1, 2, 4, 8].map((gb) =>
      el("option", { value: gb * 1024 ** 3 }, gb + " GB"),
    ),
  );
  fileLimit.value = String(
    Number(await get("settings", "fileLimit")) || 2 * 1024 ** 3,
  );
  const smartKey = grant
    ? "smart:" + grant.accountId + ":" + grant.profileId
    : null;
  const smart = el("input", {
    type: "checkbox",
    checked: smartKey && (await get("settings", smartKey)),
    disabled: !smartKey,
    onChange: (event) =>
      smartKey && put("settings", event.target.checked, smartKey),
  });
  container.replaceChildren(
    el(
      "div",
      { class: "page offline-library" },
      el("h1", {}, translateUI("Offline knihovna")),
      el(
        "p",
        {},
        grant
          ? grant.name
          : translateUI(
              "Offline oprávnění vypršelo. Připoj se a znovu vyber původní profil.",
            ),
      ),
      el(
        "div",
        { class: "offline-settings" },
        formLabel(translateUI("Limit úložiště"), limit),
        formLabel(translateUI("Limit souboru"), fileLimit),
        formLabel(translateUI("Po dokoukání stáhnout další vydaný díl"), smart),
      ),
      list,
      el(
        "div",
        { class: "actions" },
        button(translateUI("Zpět do aplikace"), onLogin),
        button(
          translateUI("Vymazat offline knihovnu"),
          async () => {
            await (await import("./offline-store.js")).clearLibrary();
            await offlineLibrary(container, onLogin);
          },
          "small",
        ),
      ),
    ),
  );
  const jobRows = new Map();
  const jobLabels = {
    queued: translateUI("Čeká ve frontě"),
    running: translateUI("Stahuje se"),
    paused: translateUI("Pozastaveno"),
    failed: translateUI("Stažení se nepodařilo"),
  };
  for (const job of await allEntries("downloads")) {
    if (
      !(await (
        await import("./offline-history.js")
      ).sameOfflineOwner(job.receipt, active))
    )
      continue;
    const file = await get("files", job.id);
    const status = el(
      "p",
      { role: "status" },
      job.error || jobLabels[job.state],
    );
    const progress = el(
      "p",
      {},
      ((file?.size || 0) / 1024 ** 2).toFixed(1) + " MB",
    );
    const toggle = button(
      ["running", "queued"].includes(job.state)
        ? translateUI("Pozastavit")
        : translateUI("Obnovit stažení"),
      async () => {
        // Read current durable state; the job may have finished since render.
        const current = await get("downloads", job.id);
        if (current)
          await changeDownload(
            job.id,
            ["running", "queued"].includes(current.state) ? "pause" : "resume",
          );
        await offlineLibrary(container, onLogin);
      },
      "small",
    );
    const row = el(
      "div",
      { class: "source-row" },
      el("div", {}, el("strong", {}, job.title.title), status, progress),
      toggle,
      button(
        translateUI("Změnit zdroj"),
        async () => {
          await changeDownload(job.id, "pause");
          await (await import("./player.js")).sources(job.title, job.episode);
        },
        "small",
      ),
      button(
        translateUI("Zrušit"),
        async () => {
          await changeDownload(job.id, "cancel");
          await offlineLibrary(container, onLogin);
        },
        "small",
      ),
    );
    jobRows.set(job.id, { status, progress, toggle });
    list.append(row);
  }
  for (const file of await allFiles()) {
    if (!file.complete || !(await sameOfflineOwner(file.receipt, active)))
      continue;
    const allowed = await mayRead(file, active);
    const play = button(translateUI("Přehrát"), async () => {
      const { showDialog } = await import("./ui.js");
      const video = el("video", {
        controls: true,
        playsinline: true,
        src: `/app/offline-media/${file.id}.mp4`,
        class: "offline-video",
      });
      video.addEventListener("loadedmetadata", () => {
        video.currentTime = file.watched ? 0 : file.position || 0;
        video.play().catch(() => {});
      });
      let lastSaved = 0,
        lastSynced = Date.now();
      let saves = Promise.resolve();
      const save = (ended = false, force = false) => {
        if (!force && Date.now() - lastSaved < 1000) return saves;
        lastSaved = Date.now();
        const position = video.currentTime,
          duration = video.duration;
        saves = saves
          .catch(() => {})
          .then(async () => {
            if (!Number.isFinite(duration) || duration <= 0) return;
            if (file.identity && file.syncBase)
              await recordOfflineProgress(file.id, position, duration, ended);
            else {
              file.position = position;
              await put("files", file);
            }
            if (
              navigator.onLine &&
              (force || ended || Date.now() - lastSynced >= 20000)
            ) {
              await flushOfflineHistory(api);
              lastSynced = Date.now();
            }
          });
        return saves;
      };
      video.addEventListener("timeupdate", () => save().catch(() => {}));
      video.addEventListener("ended", () =>
        save(true, true)
          .then(async () => {
            if (
              !navigator.onLine ||
              file.identity?.type !== "tv" ||
              !smartKey ||
              !(await get("settings", smartKey))
            )
              return;
            if (!(await mayRead(file, await get("settings", "active")))) return;
            const title = await api("titles/" + file.identity.titleId);
            const current = { id: null };
            const seasons =
              title.seasons ||
              (await api("titles/" + file.identity.titleId + "/seasons"));
            for (const season of seasons)
              for (const episode of season.episodes || [])
                if (
                  season.season_number === file.identity.season &&
                  episode.episode_number === file.identity.episode
                )
                  current.id = episode.id;
            if (!current.id) return;
            const next = nextReleasedEpisode(seasons, current.id);
            if (
              next &&
              episodeReleaseState(next.air_date) === "released" &&
              (await mayRead(file, await get("settings", "active")))
            )
              await (
                await import("./player.js")
              ).sources(title, next, { autoDownload: true });
          })
          .catch((error) => toast(error.message)),
      );
      video.addEventListener("error", () =>
        toast(
          translateUI(
            "Video se nepodařilo přehrát. Ověř offline oprávnění a úplnost stažení.",
          ),
        ),
      );
      const dialog = showDialog(
        el(
          "div",
          { class: "dialog-body" },
          el("h2", { id: "dialog-title" }, file.title),
          video,
        ),
      );
      let alive = true;
      const permissionTimer = setInterval(async () => {
        let permitted = false;
        try {
          permitted = await mayRead(file, await get("settings", "active"));
        } catch {}
        if (alive && !permitted) {
          video.pause();
          dialog.close();
          toast(
            translateUI(
              "Offline oprávnění skončilo. Připoj se a vyber původní profil.",
            ),
          );
        }
      }, 1000);
      dialog.addEventListener(
        "close",
        () => {
          alive = false;
          clearInterval(permissionTimer);
          video.pause();
          save(video.ended, true).catch((error) => toast(error.message));
          video.removeAttribute("src");
          video.load();
        },
        { once: true },
      );
    });
    play.disabled = !allowed;
    list.append(
      el(
        "div",
        { class: "source-row" },
        el(
          "div",
          {},
          el("strong", {}, file.title),
          el(
            "p",
            {},
            `${file.episode || translateUI("Film")} · ${(file.size / 1024 ** 2).toFixed(1)} MB${allowed ? "" : translateUI(" · oprávnění nedostupné")}`,
          ),
        ),
        !file.identity || !file.syncBase
          ? el(
              "p",
              {},
              translateUI(
                "Starší stažení nesynchronizuje historii. Stáhni titul znovu.",
              ),
            )
          : null,
        play,
        button(
          translateUI("Odstranit"),
          async () => {
            await removeFile(file.id);
            await offlineLibrary(container, onLogin);
          },
          "small",
        ),
      ),
    );
  }
  if (!list.children.length)
    list.append(
      el(
        "p",
        {},
        translateUI(
          "Zatím nemáš žádné video uložené. V nabídce zdrojů zvol Uložit offline.",
        ),
      ),
    );
  for (const entry of await allEntries("history")) {
    const { sameOfflineOwner } = await import("./offline-history.js");
    if (!(await sameOfflineOwner(entry.receipt, active))) continue;
    const message = el(
      "p",
      { role: "status" },
      entry.conflict
        ? translateUI(
            "Historie se změnila na jiném zařízení. Vyber, kterou zachovat.",
          )
        : entry.error || translateUI("Offline historie čeká na synchronizaci."),
    );
    const row = el("div", { class: "source-row" }, message);
    if (entry.conflict)
      for (const [choice, label] of [
        ["local", translateUI("Ponechat offline sledování")],
        ["server", translateUI("Ponechat historii na serveru")],
      ]) {
        row.append(
          button(
            label,
            async (event) => {
              const control = event.currentTarget;
              control.disabled = true;
              try {
                await resolveOfflineConflict(api, entry.id, choice);
                await offlineLibrary(container, onLogin);
              } catch (error) {
                toast(error.message);
                control.disabled = false;
              }
            },
            "small",
          ),
        );
      }
    else
      row.append(
        button(
          translateUI("Zkusit synchronizaci"),
          async () => {
            await synchronizeOfflineContext();
            await offlineLibrary(container, onLogin);
          },
          "small",
        ),
      );
    list.append(row);
  }
  const page = container.firstElementChild;
  let busy = false,
    disposed = false;
  const dispose = () => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener("movly-downloads-changed", refresh);
  };
  const refresh = async () => {
    if (disposed || busy) return;
    if (!page.isConnected || page.parentElement !== container) {
      dispose();
      return;
    }
    busy = true;
    try {
      const jobs = [];
      for (const job of await allEntries("downloads"))
        if (
          await (
            await import("./offline-history.js")
          ).sameOfflineOwner(job.receipt, active)
        )
          jobs.push(job);
      if (
        jobs.length !== jobRows.size ||
        jobs.some((job) => !jobRows.has(job.id))
      ) {
        // Keep the active player/source dialog intact until it closes.
        if (!document.querySelector("#dialog[open]"))
          await offlineLibrary(container, onLogin);
        return;
      }
      for (const job of jobs) {
        const row = jobRows.get(job.id),
          file = await get("files", job.id);
        if (disposed) return;
        row.status.textContent = job.error || jobLabels[job.state];
        row.progress.textContent =
          ((file?.size || 0) / 1024 ** 2).toFixed(1) + " MB";
        row.toggle.textContent = ["running", "queued"].includes(job.state)
          ? translateUI("Pozastavit")
          : translateUI("Obnovit stažení");
      }
    } catch (error) {
      if (!disposed) toast(error.message);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(refresh, 2000);
  window.addEventListener("movly-downloads-changed", refresh);
  libraryObservers.set(container, dispose);
}
function formLabel(label, input) {
  return input.type === "checkbox"
    ? el("label", { class: "offline-toggle" }, input, label)
    : el("label", { class: "field" }, label, input);
}

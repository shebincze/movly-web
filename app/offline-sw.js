import { get, mayRead, CHUNK_BYTES } from "./offline-store.js";
const CACHE = "movly-offline-shell-v6";
const FILES = ["/app/", "/app/styles.css", ...["main", "api", "ui", "catalog", "library", "profiles", "personal", "friends", "admin", "auth", "provider-settings", "tracking-settings", "stream-feedback", "player", "party", "party-clock", "user-state", "episode-policy", "episode-state", "offline", "offline-store", "feedback", "offline-history", "offline-downloads", "premium", "search-history", "i18n", "translations"].map(s => `/app/${s}.js`), "/app/vendor/hls.mjs", ...["thumbs-up", "info", "message-square", "home", "film", "tv", "bookmark", "settings", "smartphone", "monitor", "globe", "search", "plus", "check", "chevron-right", "alert-circle", "arrow-left"].map(name => `/app/vendor/feedback-icons/${name}.svg`)];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("movly-offline-shell-") && k !== CACHE).map(k => caches.delete(k))))])));

async function media(request, id) {
  const file = await get("files", id), active = await get("settings", "active");
  if (!await mayRead(file, active)) return new Response("Offline oprávnění vypršelo. Připoj se a znovu vyber profil.", { status: 403 });
  let start = 0, end = file.size - 1, status = 200;
  const range = request.headers.get("Range");
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
    start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; status = 206;
    if (!Number.isSafeInteger(start) || start < 0 || start > end) return new Response(null, { status: 416 });
  }
  let index = Math.floor(start / CHUNK_BYTES);
  const last = Math.floor(end / CHUNK_BYTES);
  const stream = new ReadableStream({ async pull(controller) {
    try {
      if (index > last) { controller.close(); return; }
      if (!await mayRead(file, await get("settings", "active"))) throw new Error("Offline oprávnění skončilo.");
      const part = await get("chunks", [id, index]);
      if (!part) throw new Error("Stažení není úplné.");
      const clear = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: part.iv,
        additionalData: new TextEncoder().encode(`${id}:${index}`) }, file.key, part.data));
      const offset = index * CHUNK_BYTES;
      controller.enqueue(clear.slice(Math.max(0, start - offset), Math.min(clear.length, end - offset + 1)));
      index++;
    } catch (error) { controller.error(error); }
  } });
  return new Response(stream, { status, headers: { "Content-Type": "video/mp4", "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes", "Cache-Control": "no-store", ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${file.size}` } : {}) } });
}
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  const match = /^\/app\/offline-media\/([a-f0-9-]{36})\.mp4$/.exec(url.pathname);
  if (match) { event.respondWith(media(event.request, match[1])); return; }
  if (FILES.includes(url.pathname) || url.pathname === "/app") event.respondWith(
    fetch(event.request).then(async response => {
      if (response.ok) { const cache = await caches.open(CACHE); await cache.put(event.request, response.clone()); }
      return response;
    }).catch(async () => await caches.match(event.request) || (url.pathname === "/app" ? await caches.match("/app/") : null) || new Response("Offline stránka chybí.", { status: 503 })));
});

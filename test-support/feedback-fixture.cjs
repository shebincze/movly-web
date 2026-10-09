"use strict";
// UI-only synthetic feedback. PostgreSQL behavior is covered by Go integration tests.
function createFeedbackFixture() {
  const date = "2026-10-09T12:00:00Z";
  let next = 300;
  const received = "2026-10-06T12:00:00Z", working = "2026-10-07T12:00:00Z";
  const items = [
    { id: 1, kind: "idea", title: "Automaticky přeskočit úvod", description: "Přeskoč úvod seriálu jedním tlačítkem. Volitelně i automaticky.", status: "in_progress", platforms: ["ios", "android", "tvos"], votes: 128, supported: false, mine: false },
    { id: 2, kind: "idea", title: "Vlastní vzhled titulků", description: "Uprav si písmo, velikost a barvy titulků.", status: "planned", platforms: ["macos", "windows"], votes: 86, supported: true, mine: false },
    { id: 3, kind: "idea", title: "Sdílené seznamy s přáteli", description: "Plánujte společně, na co se podíváte.", status: "reviewing", platforms: ["ios", "android"], votes: 54, supported: false, mine: false },
    { id: 4, kind: "idea", title: "Widget Pokračovat ve sledování", description: "Vrať se k rozkoukanému příběhu přímo z plochy.", status: "new", platforms: ["ios"], votes: 31, supported: false, mine: false },
    { id: 214, kind: "bug", title: "Titulky se po pauze posunou", description: "Po pozastavení a opětovném spuštění nejsou titulky synchronní se zvukem.", status: "ready_for_release", platforms: ["macos"], votes: 0, supported: false, mine: true },
    { id: 173, kind: "bug", title: "Přehrávání se po návratu zastaví", description: "Po návratu do aplikace se přehrávání neobnoví.", status: "reviewing", platforms: ["ios"], votes: 0, supported: false, mine: true },
    { id: 98, kind: "bug", title: "Historie se neobnoví", description: "Historie sledování se po přihlášení nenačte.", status: "released", platforms: ["android"], votes: 0, supported: false, mine: true },
  ].map((item) => ({ ...item, visible: true, releases: item.status === "released" ? [{ platform: "android", version: "1.4.2", released_at: date }] : [], created_at: received, updated_at: date }));
  const events = new Map(items.map((item) => [item.id, [
    { id: 1, team: false, status: "new", message: "", created_at: received },
    ...(["in_progress", "ready_for_release", "released"].includes(item.status) ? [{ id: 2, team: true, status: "in_progress", message: "", created_at: working }] : []),
    { id: 3, team: true, status: item.status, message: item.status === "ready_for_release" ? "Díky za hlášení. Opravu jsme ověřili, bude součástí příští aktualizace pro macOS." : "Díky za podnět. Tady můžeš sledovat další postup.", created_at: date }
  ]]));
  const attachments = new Map(); const created = new Map(); const handoffs = new Map();
  return function feedback(path, method, body) {
    const u = new URL(path, "http://fixture/"); const p = u.pathname.replace(/^\/v1\/(?:admin\/)?/, "");
    if (!p.startsWith("feedback/")) return undefined;
    const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
    const detail = (item) => ({ payload: { item, events: events.get(item.id) || [], attachments: [...attachments.values()].filter((a) => a.item === item.id).map(({ id, media_type, size_bytes }) => ({ id, media_type, size_bytes })) } });
    if (p === "feedback/items" && method === "GET") {
      let rows = items.filter((i) => (!u.searchParams.get("kind") || i.kind === u.searchParams.get("kind")) && (u.searchParams.get("mine") !== "true" || i.mine) && (!u.searchParams.get("status") || i.status === u.searchParams.get("status")) && (!u.searchParams.get("q") || i.title.toLowerCase().includes(u.searchParams.get("q").toLowerCase())));
      if (u.searchParams.get("sort") === "votes") rows.sort((a, b) => b.votes - a.votes);
      const offset = Number(u.searchParams.get("offset") || 0); return { payload: { items: rows.slice(offset, offset + 25), total: rows.length, offset, limit: 25, can_manage: process.env.MOVLY_FIXTURE_FEEDBACK_ADMIN === "1" } };
    }
    if (p === "feedback/items" && method === "POST") {
      if (created.has(body.request_id)) return detail(created.get(body.request_id));
      const item = { ...body, id: next++, status: "new", visible: true, mine: true, supported: false, votes: 0, releases: [], created_at: date, updated_at: date };
      items.push(item); created.set(body.request_id, item); events.set(item.id, [{ id: 1, team: false, status: "new", message: "", created_at: date }]); return detail(item);
    }
    const match = p.match(/^feedback\/items\/(\d+)(?:\/(vote|messages|merge|attachments))?$/);
    if (match) {
      const item = items.find((i) => i.id === Number(match[1])); if (!item) fail(404, "Položka nebyla nalezena.");
      if (method === "DELETE" && !match[2]) {
        items.splice(items.indexOf(item), 1); events.delete(item.id);
        for (const [id, attachment] of attachments) if (attachment.item === item.id) attachments.delete(id);
        for (const remaining of items) if (remaining.duplicate_of === item.id) remaining.duplicate_of = null;
        return { payload: null };
      }
      if (match[2] === "vote") { const support = method === "PUT"; if (item.supported !== support) item.votes += support ? 1 : -1; item.supported = support; }
      if (match[2] === "messages") { events.get(item.id).push({ id: events.get(item.id).length + 1, team: path.includes("admin/"), status: item.status, message: body.message, created_at: date }); }
      if (match[2] === "attachments") attachments.set(body.id, { id: body.id, item: item.id, media_type: "image/png", size_bytes: Buffer.from(body.data, "base64").length, data: body.data });
      if (method === "PATCH") { Object.assign(item, { status: body.status, visible: body.visible, releases: body.releases.map((r) => ({ ...r, released_at: date })) }); events.get(item.id).push({ id: events.get(item.id).length + 1, team: true, status: body.status, message: body.message, created_at: date }); }
      if (match[2] === "merge") { item.status = "duplicate"; item.duplicate_of = body.target_id; }
      return detail(item);
    }
    const attachment = p.match(/^feedback\/attachments\/([a-f0-9-]+)$/); if (attachment) { const image = attachments.get(attachment[1]); if (!image) fail(404, "Screenshot nebyl nalezen."); return { payload: { id: image.id, data: image.data } }; }
    if (p === "feedback/handoffs" && method === "POST") { const token = "fixture-handoff"; handoffs.set(token, body); return { payload: { token, url: `http://localhost:8086/app/#feedback?handoff=${token}`, expires_at: "2026-10-09T12:10:00Z" } }; }
    if (p === "feedback/handoffs/consume") { if (!handoffs.has(body.token)) fail(404, "Odkaz vypršel."); const data = handoffs.get(body.token); handoffs.delete(body.token); return { payload: { ...data, token: "", url: "", expires_at: date } }; }
    fail(404, "Testovací feedback nezná tuto cestu.");
  };
}
module.exports = { createFeedbackFixture };

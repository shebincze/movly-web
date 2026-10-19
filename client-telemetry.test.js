"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
async function render(app, event, diagnostics) {
  const source = (await fs.readFile("app/client-telemetry.js", "utf8"))
    .replace('import { api } from "./api.js";', 'const api = async () => globalThis.__terminationLabelData;')
    .replace('import { el } from "./ui.js";', 'const el = globalThis.__terminationLabelEl;');
  const day = "2026-10-19";
  globalThis.__terminationLabelData = {client_app: app, day, rows: [{event, outcome: "failure", provider: "none", count: 1, duration_count: 0, duration_ms_total: 0}], ...(diagnostics === undefined ? {} : {diagnostics})};
  globalThis.__terminationLabelEl = (tag, attrs, ...children) => ({tag, attrs, children, append(...nodes) {this.children.push(...nodes);}});
  try {
    const {clientTelemetry} = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
    return await clientTelemetry(new URLSearchParams({client_app: app, day}));
  } finally {
    delete globalThis.__terminationLabelData;
    delete globalThis.__terminationLabelEl;
  }
}
const text = node => Array.isArray(node) ? node.map(text).join(" ") : node && typeof node === "object" ? node.children.map(text).join(" ") : String(node);
test("Windows table labels unexpected termination and explains its uncertainty", async () => {
  const page = await render("movly-windows", "unexpected_termination");
  const rendered = text(page);
  assert.match(rendered, /Nečisté ukončení předchozího procesu \(unexpected_termination\)/);
  assert.match(rendered, /nerozlišuje pád aplikace, vynucené ukončení procesu ani restart systému/);
});
test("other client dashboards retain unknown event fallback and no Windows explanation", async () => {
  const rendered = text(await render("movly-web", "unknown_event"));
  assert.match(rendered, /unknown_event \(unknown_event\)/);
  assert.doesNotMatch(rendered, /předchozí běh řádně neukončil/);
});

test("Windows diagnostics show bounded kind/version and reject raw or oversized details", async () => {
 const row={event_id:"a".repeat(32),event:"fatal_ui",kind:"memory",client_version:"1.2.3.4",occurred_at:"2026-10-19T10:00:00Z",received_at:"2026-10-19T11:00:00Z"};
 const rendered=text(await render("movly-windows","fatal_ui",[row]));
 assert.match(rendered,/Diagnostické záznamy Windows/);assert.match(rendered,/Paměť/);assert.match(rendered,/1\.2\.3\.4/);assert.match(rendered,/2026-10-19T10:00:00Z/);
 await assert.rejects(render("movly-windows","fatal_ui",[{...row,kind:"private exception path"}]),/neplatnou diagnostiku/);
 await assert.rejects(render("movly-windows","fatal_ui",Array(101).fill(row)),/neplatnou diagnostiku/);
 await assert.rejects(render("movly-windows","fatal_ui",[{...row,client_version:"1.2.preview.4"}]),/neplatnou diagnostiku/);
});

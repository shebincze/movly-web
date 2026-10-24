import { api } from "./api.js";
import { el } from "./ui.js";
import { translateUI as t } from "./i18n.js";
import { playbackQualityVersions } from "./playback-quality-state.js";

const apps = [
  { app: "movly-web", platform: "web", label: "Web" },
  { app: "movly-ios", platform: "ios", label: "iOS" },
  { app: "movly-macos", platform: "macos", label: "macOS" },
  { app: "movly-tvos", platform: "tvos", label: "Apple TV" },
  { app: "movly-android", platform: "android", label: "Android" },
  { app: "movly-android", platform: "android_tv", label: "Android TV" },
  { app: "movly-windows", platform: "windows", label: "Windows" },
];
function table(headers, rows) {
  return el("div", { class: "playback-quality-table" }, el("table", { class: "data-table" },
    el("thead", {}, el("tr", {}, headers.map(text => el("th", { scope: "col" }, text)))),
    el("tbody", {}, rows.map(row => el("tr", {}, row.map(value => el("td", {}, String(value))))))));
}
export async function playbackQuality(params, signal) {
  const selected = apps.find(value => value.app === params.get("client_app") && value.platform === params.get("platform"))
    || apps.find(value => value.app === params.get("client_app")) || apps[0];
  const { app, platform } = selected;
  const hours = [1, 24, 168].includes(Number(params.get("hours"))) ? Number(params.get("hours")) : 24;
  const page = el("div", { class: "page admin-page" }, el("h1", {}, t("Start přehrávání")),
    el("a", { href: "#admin", class: "button secondary" }, t("Zpět na nahlášení")));
  let data;
  try {
    data = await api(`admin/telemetry/playback-attempts?${new URLSearchParams({ client_app: app, platform, hours })}`, { signal });
  } catch (error) { if (![404, 405].includes(error.status)) throw error; }
  if (!data) {
    page.append(el("p", {}, t("Tento server zatím přehled startu přehrávání nepodporuje.")));
    return page;
  }
  const versions = playbackQualityVersions(data);
  page.append(el("select", { "aria-label": t("Platforma"), onChange: event => {
    const target = apps.find(value => value.platform === event.target.value);
    location.hash = `#admin?view=playback&client_app=${target.app}&platform=${target.platform}&hours=${hours}`;
  } }, apps.map(value => el("option", { value: value.platform, selected: value.platform === platform }, value.label))),
  el("nav", { class: "playback-quality-controls" }, [1, 24, 168].map(value => el("a", {
    href: `#admin?view=playback&client_app=${app}&platform=${platform}&hours=${value}`,
    class: value === hours ? "button accent" : "button secondary",
  }, `${value} h`))),
  el("p", {}, t("Vzorek 10 % pokusů, nejvýše osm verzí. První pozorovaný snímek předaný kompozitoru není důkaz fyzického zobrazení. Playing je slabší fallback a nevstupuje do latence snímku. Nedokončené pokusy zůstávají v počtech.")),
  el("p", {}, t("Okno vybírá pokusy s událostí ve zvoleném období; přehled zahrnuje jejich uchovaný kontext až sedm dnů.")),
  el("p", {}, t("p50/p95 jsou horní hranice pevných histogramových intervalů. Časy měření jsou omezené na jednu hodinu. Etapy měří klientem pozorované trvání API a přehrávače, nikoli serverové interní trace. Chybějící data mohou znamenat výpadek sběru.")));
  if (!versions.length) page.append(el("p", {}, t("V tomto období zatím nejsou data.")));
  else page.append(table([t("Verze"), t("Pokusy"), t("Snímek"), t("Pokrytí snímkem"), t("Playing bez snímku"), t("Chyba"), t("Timeout"), t("Zrušeno"), t("Změna zdroje"), t("Nedokončeno"), t("p50 snímku"), t("p95 snímku")],
    versions.map(v => [v.version + (v.buildUnknown ? t(" (build neznámý)") : ""), v.attempts, v.first_frame,
      `${v.attempts ? Math.round(1000 * v.first_frame / v.attempts) / 10 : 0} %`, v.playing, v.failure, v.timeout, v.cancelled,
      v.source_switch + v.switches_after_start, v.incomplete, v.p50 ? `≤ ${v.p50} ms` : "—", v.p95 ? `≤ ${v.p95} ms` : "—"])));
  for (const v of versions) {
    if (!v.stages.length && !v.errorClasses.size) continue;
    const section = el("section", {}, el("h2", {}, t("Chyby a etapy · {0}", v.version)));
    if (v.errorClasses.size) section.append(el("p", {}, [...v.errorClasses].map(([name, count]) => `${name}: ${count}`).join(" · ")));
    if (v.stages.length) section.append(table([t("Etapa"), t("Výsledek"), t("Chyba"), t("Počet"), "p50", "p95"],
      v.stages.map(r => [r.stage, r.outcome, r.error_class, r.count, `≤ ${r.p50_upper_ms} ms`, `≤ ${r.p95_upper_ms} ms`])));
    page.append(section);
  }
  return page;
}

import { api } from "./api.js";
import { el } from "./ui.js";
const apps = [["movly-web","Web"],["movly-ios","iOS"],["movly-macos","macOS"],["movly-tvos","Apple TV"],["movly-android","Android a Android TV"],["movly-windows","Windows"]];
const events = {unexpected_termination:"Nečisté ukončení předchozího procesu",detail_load:"Načtení detailu",detail_background_refresh:"Obnovení detailu",stream_resolve:"Příprava zdroje",fatal_startup:"Fatální chyba při spuštění",fatal_ui:"Fatální chyba rozhraní",fatal_managed:"Fatální chyba spravovaného běhu",source_switch:"Změna zdroje",first_frame:"První snímek",media_opened:"Otevření média",playing:"Přehrávání",buffering:"Načítání do vyrovnávací paměti",tracks_available:"Dostupné stopy"};
const outcomes = {success:"Úspěch",failure:"Chyba",timeout:"Vypršel čas",missing:"Chybí",cancelled:"Zrušeno"};
export async function clientTelemetry(params, signal) {
  const app = apps.some(([id]) => id === params.get("client_app")) ? params.get("client_app") : "movly-web";
  const today = new Date().toISOString().slice(0,10);
  const minimum = new Date(Date.parse(today) - 89*86400000).toISOString().slice(0,10);
  const day = params.get("day") || today;
  const page = el("div", {class:"page admin-page"}, el("h1", {}, "Události klientů"), el("a", {href:"#admin",class:"button secondary"}, "Zpět na nahlášení"));
  const navigate = (application, date) => { location.hash = `#admin?${new URLSearchParams({view:"client-quality",client_app:application,day:date})}`; };
  page.append(el("label", {}, "Aplikace", el("select", {"aria-label":"Aplikace",onChange:e=>navigate(e.target.value,day)}, apps.map(([id,label])=>el("option",{value:id,selected:id===app},label)))),
    el("label", {}, "Den (UTC)", el("input",{type:"date",value:day,min:minimum,max:today,"aria-label":"Den (UTC)",onChange:e=>{if(e.target.value) navigate(app,e.target.value);}})),
    el("p", {}, "Uložené součty událostí za jeden den UTC, uchované nejvýše 90 dnů. Nejde o počet unikátních uživatelů ani míru pádů nebo úspěšnost pokusů. Opakované odeslání může zvýšit počet; sběr a vzorkování se mezi klienty liší. Android a Android TV sdílejí jeden údaj. Verze ani surové chybové zprávy se v těchto datech neukládají."));
  if (app === "movly-windows") page.append(el("p", {}, "Nečisté ukončení předchozího procesu znamená, že se předchozí běh řádně neukončil. Tato událost nerozlišuje pád aplikace, vynucené ukončení procesu ani restart systému."));
  let data;
  try { data = await api(`admin/telemetry/client?${new URLSearchParams({client_app:app,day})}`,{signal}); }
  catch(error) {
    if(signal?.aborted) throw error;
    if([404,405].includes(error.status)) page.append(el("p",{role:"status"},"Tento server přehled událostí klientů zatím nepodporuje."));
    else if(error.status===400) page.append(el("p",{role:"alert"},"Vyber platný den v posledních 90 dnech UTC."));
    else if([401,403].includes(error.status)) throw error;
    else page.append(el("p",{role:"alert"},"Přehled teď není dostupný. Zkus ho načíst znovu."));
    return page;
  }
  if(!data || !Array.isArray(data.rows) || data.rows.length>600 || data.client_app!==app || data.day!==day) throw new Error("Server vrátil neplatný přehled událostí.");
  if(!data.rows.length) page.append(el("p",{role:"status"},"Pro tuto aplikaci a den nejsou uložené události."));
  else page.append(el("div",{class:"playback-quality-table"},el("table",{class:"data-table"},
    el("caption",{},`${apps.find(([id])=>id===app)[1]} · ${day} UTC`),
    el("thead",{},el("tr",{},["Událost","Výsledek","Provider","Počet","Měřených trvání","Průměr trvání"].map(text=>el("th",{scope:"col"},text)))),
    el("tbody",{},data.rows.map(row=>el("tr",{},[`${events[row.event] || row.event} (${row.event})`,outcomes[row.outcome] || row.outcome,row.provider,row.count,row.duration_count,row.duration_count>0?`${Math.round(row.duration_ms_total/row.duration_count)} ms`:"—"].map(value=>el("td",{},String(value)))))))));
  return page;
}

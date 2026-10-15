import { api } from "./api.js";
import { el } from "./ui.js";
import { playbackQualityVersions } from "./playback-quality-state.js";
export async function playbackQuality(params,signal) {
  const apps=[{app:"movly-web",platform:"web",label:"Web"},{app:"movly-ios",platform:"ios",label:"iOS"},{app:"movly-macos",platform:"macos",label:"macOS"},{app:"movly-tvos",platform:"tvos",label:"Apple TV"},{app:"movly-android",platform:"android",label:"Android"},{app:"movly-android",platform:"android_tv",label:"Android TV"},{app:"movly-windows",platform:"windows",label:"Windows"}];
  const selected=apps.find(value=>value.app===params.get("client_app")&&value.platform===params.get("platform"))||apps.find(value=>value.app===params.get("client_app"))||apps[0];
  const {app,platform}=selected;
  const hours=[1,24,168].includes(Number(params.get("hours")))?Number(params.get("hours")):24;
  const data=await api(`admin/telemetry/playback-attempts?${new URLSearchParams({client_app:app,platform,hours})}`,{signal});
  const versions=playbackQualityVersions(data);
  const selector=el("select",{"aria-label":"Platforma",onChange:event=>{const target=apps.find(value=>value.platform===event.target.value);location.hash=`#admin?view=playback&client_app=${target.app}&platform=${target.platform}&hours=${hours}`;}},apps.map(value=>el("option",{value:value.platform,selected:value.platform===platform},value.label)));
  const ranges=el("nav",{class:"playback-quality-controls"},[1,24,168].map(value=>el("a",{href:`#admin?view=playback&client_app=${app}&platform=${platform}&hours=${value}`,class:value===hours?"button primary":"button secondary"},`${value} h`)));
  const cell=value=>el("td",{},String(value));
  const table=el("table",{class:"data-table"},el("thead",{},el("tr",{},["Verze","Pokusy","Snímek","Pokrytí snímkem","Playing bez snímku","Chyba","Timeout","Zrušeno","Změna zdroje","Nedokončeno","p50 snímku","p95 snímku"].map(text=>el("th",{scope:"col"},text)))),el("tbody",{},versions.map(v=>el("tr",{},[v.version+(v.buildUnknown?" (build neznámý)":""),v.attempts,v.first_frame,`${v.attempts?Math.round(1000*v.first_frame/v.attempts)/10:0} %`,v.playing,v.failure,v.timeout,v.cancelled,v.source_switch+v.switches_after_start,v.incomplete,v.p50?`≤ ${v.p50} ms`:"—",v.p95?`≤ ${v.p95} ms`:"—"].map(cell)))));
  return el("div",{class:"page admin-page"},el("h1",{},"Start přehrávání"),el("a",{href:"#admin",class:"button secondary"},"Zpět na nahlášení"),selector,ranges,
    el("p",{},"Vzorek 10 % pokusů, nejvýše osm verzí. První pozorovaný snímek předaný kompozitoru není důkaz fyzického zobrazení. Playing je slabší fallback a nevstupuje do latence snímku. Nedokončené pokusy zůstávají v počtech."),
    el("p",{},"p50/p95 jsou horní hranice pevných histogramových intervalů. Časy měření jsou omezené na jednu hodinu. Etapy měří klientem pozorované trvání API a přehrávače, nikoli serverové interní trace. Chybějící data mohou znamenat výpadek sběru."),versions.length?el("div",{class:"playback-quality-table"},table):el("p",{},"V tomto období zatím nejsou data."),
    ...versions.filter(v=>v.stages.length||v.errorClasses.size).map(v=>el("section",{},el("h2",{},`Etapy · ${v.version}`),el("p",{},[...v.errorClasses].map(([name,count])=>`${name}: ${count}`).join(" · ")),el("table",{class:"data-table playback-quality-table"},el("thead",{},el("tr",{},["Etapa","Výsledek","Chyba","Počet","p50","p95"].map(text=>el("th",{scope:"col"},text)))),el("tbody",{},v.stages.map(r=>el("tr",{},[r.stage,r.outcome,r.error_class||"none",r.count,`≤ ${r.p50_upper_ms} ms`,`≤ ${r.p95_upper_ms} ms`].map(cell))))))));
}

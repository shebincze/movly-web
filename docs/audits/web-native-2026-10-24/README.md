# Audit nativnosti webu — 24. 10. 2026

Tento audit navazuje na audit designové konzistence (#223, PR #224) a na audit nativnosti Apple platforem podle HIG (`docs/audits/apple-hig-2026-10-22/` v hlavním repozitáři). Neměří soulad s `DESIGN.md`. Měří **nativnost vůči konvencím moderního webu**:

- sémantické HTML a nativní prvky (`<a>`, `<button>`, `<dialog>`, `<details>`, `<input type=search>`, `<select>`),
- klávesnice a fokus,
- WCAG 2.2 AA,
- responzivita od 320 px po desktop,
- `prefers-reduced-motion` a `color-scheme`,
- systémové posuvníky,
- URL a historie (Zpět, sdílitelné odkazy),
- rychlost načítání.

Brand patří jen do obsahu. Záložka Žánry je záměrně skrytá, takže to není nález.

| Část | Nativnost před opravou | P1 | P2 | P3 |
|---|---|---|---|---|
| Webová aplikace `/app/` | 6/10 | 2 | 9 | 10 |
| Kořenové stránky (`/`, `/en/`, soukromí, smazání účtu, aktivace, zařízení) | 4/10 | 1 | 2 | 3 |

## Metoda

- **Revize.** Všechny odkazy `soubor:řádek` v tabulkách ukazují na `origin/main` `2393d5c` (stav před opravou).
- **Statická analýza.** Prošel jsem:
  - `app/*.js`, `app/styles.css` a `app/css/*`,
  - kořenové HTML a `server.js`.
  
  Hledal jsem nesémantické klikací prvky, `outline: none`, `aria-*`, dialogy, směrování a `history`, posuvníky, `color-scheme`, animace a závislosti na CDN.
- **Průchod v prohlížeči.** Lokální fixture `test-support/app-fixture.cjs` s účtem test, žádná produkce. Kontroloval jsem:
  - šířky 360, 768, 1024, 1280 a 1920 px,
  - klávesnici (Tab, Shift+Tab, Enter, Esc, šipky),
  - `prefers-reduced-motion`,
  - accessibility tree (`read_page`),
  - Zpět a Vpřed a deep linky,
  - vlastní měřicí skript: cíle kliknutí, názvy prvků, přetečení a nadpisy.
- **Kontrast** jsem spočítal vzorcem WCAG 2.x.
- **Světlý a tmavý režim.** Web je stejně jako nativní klienti jen tmavý (DESIGN §10, HIG-MAC-08). Nativní chování proto znamená deklarovat `color-scheme: dark`, aby systémové posuvníky, formulářové prvky a plátno před načtením CSS byly tmavé. Nálezem je, kde to chybí.

## Co už bylo nativní

- **Dialogy** používají `<dialog>` + `showModal()`. Mají fokus v dialogu, Esc i návrat fokusu.
- **Skip link** na obsah, `aria-current="page"` v navigaci a knihovně.
- **Vyhledávání** je `<form role="search">` s `type="search"` a skrytým `<label>`. Combobox s `aria-activedescendant` se ovládá šipkami.
- **Přihlášení** používá `autocomplete="username/current-password"`, PIN má `inputmode="numeric"`.
- **Přehrávač** má klávesové zkratky (mezerník/K, J/L, šipky, M, F, P), Fullscreen API a obraz v obraze. Ovládací prvky mají názvy, které se mění podle stavu.
- **Globálně:** `:focus-visible` a `prefers-reduced-motion`. Filtry používají nativní `<select multiple>`, `fieldset` a `legend`.

## P1 — rozbíjí základní očekávání webu

| ID | Kde | Nález | Řešení | Stav |
|---|---|---|---|---|
| WEB-N01 | `app/library.js:68-71`, `app/ui.js:174-188`, `app/main.js:741-743` | **Detail titulu nemá adresu.** Detail je `<dialog>` bez změny URL. Zpět v prohlížeči proto opustí celou stránku: na #movies vede na předchozí stránku, ne na zavření detailu. Detail nejde sdílet ani obnovit a karta je `<button>`, takže nefunguje Cmd/Ctrl+klik, prostřední tlačítko ani Kopírovat odkaz. `document.title` zůstane na stránce. | Detail jako modální vrstva s adresou `#stránka?title=ID` (stejně jako Netflix `?jbv=`), modul `app/detail-route.js`. Karta je `<a href>` a běžný klik detail otevře bez načtení stránky. Otevření zavolá `history.pushState`. Zpět/Vpřed porovná klíč stránky: změna jen `title` stránku nepřekreslí a jen synchronizuje dialog. Deep link otevře detail po vykreslení stránky. Zavřít vrátí historii o přidané detaily (`history.go(-n)`). `document.title` je název titulu. Hlídání akcí katalogu porovnává klíč stránky, ne celý hash. | Opraveno #225 |
| WEB-N02 | `app/styles.css:1824-1827`, `app/index.html:33-35` | **Odkaz Hledat nemá při šířce ≤ 1240 px přístupný název.** Text `<span>Hledat</span>` je `display: none` a čtečka hlásí jen „odkaz“. Týká se notebooků, tabletů i telefonů. | Text skrýt jen vizuálně (`clip`, 1 px), aby dál pojmenovával odkaz. | Opraveno #225 |
| WEB-N03 | `index.html:13`, `privacy.html:11`, `delete-account.html:11`, `support.js`, `index.html:486-508, 710-727` | **Kořenové stránky závisí na Reactu z unpkg.com.** Úvodní stránka, zásady soukromí i smazání účtu se vykreslují až v prohlížeči přes dc-runtime z návrhového nástroje (`support.js` stahuje React a ReactDOM z unpkg.com bez SRI a CSP, ~300–800 ms navíc, s rezervou na Babel standalone). Když je unpkg.com nedostupné (blokátor, firemní síť, výpadek), zůstane se zapnutým JavaScriptem stránka prázdná a ukáže jen hlášku „Interaktivní část stránky se nepodařila načíst“ (doloženo snímkem `before-1280-landing-cdn-blocked.jpg`). Nefunguje pak ani přihlášení a stažení instalaček. Stránku pro Google Play (smazání účtu) a zásady soukromí to dělá křehkou a kód z cizího CDN běží na stránce s přihlašovacím formulářem. Stránky dokumentů nemají `<main>`. FAQ je klikací `<div>`: z klávesnice nejde otevřít a čtečka ho nepozná. | Převod na statické HTML: styly do `<head>`, `style-hover` na CSS `:hover`, logika jako obyčejný skript, `support.js` odstraněn. FAQ přes nativní `<details name="faq">` + `<summary>` (výlučný akordeon bez JavaScriptu). | Opraveno #225 |

## P2 — nativní chování nebo WCAG AA chybí

| ID | Kde | Nález | Řešení | Stav |
|---|---|---|---|---|
| WEB-N04 | `app/styles.css:1643-1656` | **Stránka pod modálním dialogem se posouvá.** Na mobilu se při posunu detailu (přes celou obrazovku) posune i stránka pod ním (scroll chaining, změřeno `scrollY` 114 px). | `html:has(body > dialog[open]) { overflow: hidden }`, `dialog { overscroll-behavior: contain }`, `scrollbar-gutter: stable` proti poskočení. | Opraveno #225 |
| WEB-N05 | `app/ui.js:301-310`, `app/main.js:111-114` | **Klepnutí na pozadí dialog nezavře.** Nativní `<dialog>` to sám nedělá a web neměl ani `closedby` náhradu. | Klik mimo rámeček dialogu (pointerdown i click na `::backdrop`) vyšle zrušitelnou událost `cancel`, takže dialogy, které zakazují zavření (`closable: false`, čekající PIN), zůstanou otevřené. | Opraveno #225 |
| WEB-N06 | `app/index.html:43, 55`, `app/main.js:700-716` | **Panely Účet a Upozornění slibují ARIA menu, ale nejsou.** Mají `aria-haspopup="menu"/"true"`, obsahují ale odkazy a tlačítka bez `role="menuitem"` a nereagují na šipky. Čtečka ohlásí menu a uživatel čeká šipky. Panel zůstane otevřený i po odchodu fokusu klávesnicí. | Vzor disclosure: odstranit `aria-haspopup`, ponechat `aria-expanded/controls`. Panel se zavře při `focusin` mimo něj. | Opraveno #225 |
| WEB-N07 | `app/main.js:546-549` | **Po navigaci zůstane fokus na `body` nebo na odstraněném prvku.** Čtečka nic neohlásí a další Tab začíná od začátku dokumentu. | Po navigaci uživatelem se fokus přesune na H1 nové stránky (`tabindex=-1`, `preventScroll`). Při překreslení téže stránky (např. změna filtru) se vrátí na prvek se stejným `id`/`name`. Při startu aplikace se nemění. | Opraveno #225 |
| WEB-N08 | `app/catalog.js:1003-1157` | **Přechod na Hledání nedá fokus do pole.** Pole se zaměří jen zkratkou „/“ a jen tehdy, když už je uživatel na Hledání. | Při navigaci na #search jde fokus na `#search-q`. | Opraveno #225 |
| WEB-N09 | `app/catalog.js:693-699` | **Pole „do“ rozsahů nemá přístupný název.** `<label>` obaluje dvojici polí od–do, takže pojmenuje jen první pole. Druhé má jako název jen placeholder (WCAG 1.3.1, 3.3.2). | `role="group"` s názvem rozsahu a vlastní `aria-label` od/do pro každé pole, oddělovač „–“ skrytý. | Opraveno #225 |
| WEB-N10 | `app/catalog.js:37-62`, `app/styles.css:1172-1191, 1886-1888` | **Tečky karuselu mají malý cíl kliknutí.** Cíl má 20 × 44 px (WCAG 2.5.8 vyžaduje 24 px). Na mobilu s mezerou 5 px se cíle sousedních teček překrývají. `aria-label` je na `<div>` bez role, takže se ignoruje. | Mezera 12 px a pseudo-cíl 24 × 44 px bez překryvu, `role="group"`. | Opraveno #225 |
| WEB-N11 | `app/player-controls.js:97-285`, `app/player.js:1314` | **Chybí Media Session API.** Titul není v systémovém „Právě hraje“ (Ovládací centrum na macOS a iOS, přehrávač Windows, notifikace Androidu) a mediální klávesy ani tlačítka sluchátek přehrávač neovládají. | `navigator.mediaSession`: metadata (titul, epizoda, plakát), `play/pause/seekbackward/seekforward/stop` a `playbackState`. Při zavření přehrávače se vše uklidí. Ve Watch Party jde přes stejný přepínač místnosti. | Opraveno #225 (ruční akceptace #227) |
| WEB-N12 | `index.html:61-70`, `privacy.html`, `delete-account.html`, `en/*.html`, `assets/tokens.css` | **Kořenové stránky nemají `color-scheme: dark`.** Bez něj jsou posuvníky, formulářové prvky a plátno před načtením CSS světlé. Úvodní stránka a stránky dokumentů navíc kreslí vlastní `::-webkit-scrollbar`. | `color-scheme: dark` v `tokens.css`, `<meta name="color-scheme">` ve všech hlavičkách, vlastní posuvníky odstraněné. | Opraveno #225 |
| WEB-N13 | `index.html:453-458, 120, 150, 385-403, 415`, `en/index.html:24, 73, 82` | **Formulář úvodní stránky není propojený a kontrast nestačí.** `<label>` bez `for`, takže kliknutí na popisek pole nezaměří a čtečka pole nepojmenuje. Tlačítko Přihlásit je `type="button"` s ručním hlídáním Enter. Bílý text je na brand gradientu: `#EC4899` dává 3,5:1, `#A78BFA` v EN verzi 2,7:1. Šedý text `#6C6C7E` má 3,8:1. | `for="mvUser/mvPass"`, `type="submit"` + `submit` formuláře. Bílý text jen na control gradientu (≥ 5,7:1, DESIGN §10) a `#9494A8` (6,6:1). | Opraveno #225 |
| WEB-N14 | `app/main.js:115-120` | **Zavření kroku nad detailem zavře i detail.** Po zavření výběru zdroje, přehrávače, hodnocení nebo osoby otevřených z detailu zmizí i detail. Nativní klienti mají tyto kroky jako list nad detailem. | Zavření kroku nad detailem vrátí na detail (data z paměti). Zavření detailu vrátí stránku. | Opraveno #225 |

## P3 — detaily

| ID | Kde | Nález | Řešení | Stav |
|---|---|---|---|---|
| WEB-N15 | `app/main.js:146-260, 286-300` | Přihlášení a výběr profilu nemají vlastní `document.title` (zůstane „Objevuj svůj další příběh“). | Titulky „Přihlášení“ a „Kdo se dívá?“. | Opraveno #225 |
| WEB-N16 | `app/library.js:68` | Otevřený detail nemění `document.title`. Historie prohlížeče a záložky ukazují stránku. | Součást WEB-N01. | Opraveno #225 |
| WEB-N17 | `app/styles.css:95-98` | Zakázané tlačítko má kurzor `wait`, i když se nic nenačítá. | `cursor: default`, čekání přes `[aria-busy=true]`. | Opraveno #225 |
| WEB-N18 | `app/library.js:64` | Navigace sekcí detailu volá `scrollIntoView({behavior:"smooth"})`. Explicitní JS volba přebije CSS `prefers-reduced-motion`. | `behavior` podle `matchMedia`. | Opraveno #225 |
| WEB-N19 | `app/feedback.js:215`, `app/ui.js:301` | Náhled screenshotu je dialog bez `#dialog-title`, takže `aria-labelledby` ukazuje na neexistující prvek. | `showDialog` doplní `aria-label` z nadpisu nebo `alt`. | Opraveno #225 |
| WEB-N20 | `app/index.html:1-17` | Chybí `<meta name="color-scheme">`, takže před načtením CSS hrozí bílý záblesk. | Doplněno. | Opraveno #225 |
| WEB-N21 | `privacy.html:83-138`, `delete-account.html:83-139`, `index.html` | Stránky dokumentů a úvodní stránka nemají `<main>` a úvodní stránka nemá odkaz na přeskočení obsahu (EN verze také). | `<main id="obsah">` a skip link. | Opraveno #225 |
| WEB-N22 | `app/styles.css:1849-1870` | Na 360–390 px se hlavička zalomí do tří řádků (značka, akce, navigace) a zabere ~150 px. | Do 600 px se zobrazí jen znak a název nese `aria-label`. Značka a akce se vejdou do jednoho řádku. | Opraveno #225 |
| WEB-N23 | `index.html:415-416, 926-928` | Přepínač náhledů nehlásí vybraný stav. Přihlášení odesílá ručním hlídáním Enter. | `aria-pressed`, odeslání formuláře nativně. | Opraveno #225 |
| WEB-N24 | `app/styles.css:62` | `:root { font-size: 16px }` ignoruje uživatelskou velikost písma prohlížeče (zoom funguje). | `100 %` a kontrola rozvržení. | Opraveno #226 |
| WEB-N25 | `app/styles.css:678` | Řady plakátů nemají pro myš bez vodorovného kolečka tlačítka stránkování (Netflix a Disney+ je mají na hover). | Šipky jen pro `pointer: fine`, mimo pořadí Tab. | Opraveno #226 |
| WEB-N26 | `app/catalog.js:37-84` | Karusel nemá `aria-roledescription` ani ohlášení změny snímku. | Vzor APG Carousel. | Opraveno #226 |
| WEB-N27 | `index.html:84`, `en/index.html:84` | Úvodní stránka pod 900 px skryje navigaci a nic ji nenahradí. | `<details>` nabídka nebo kotvy. | Opraveno #226 |
| WEB-N28 | `index.html:196, 230, 704-707` | Běžící pás plakátů se zastaví jen hoverem nebo s `prefers-reduced-motion` (WCAG 2.2.2). | Tlačítko Pozastavit. | Opraveno #226 |
| WEB-N29 | `app/css/catalog.css:78-80` | Fokus pole hledání ukáže jen změnu barvy 1px rámečku. | Obrys rámečku při `:focus-visible` pole. | Opraveno #225 |
| WEB-N30 | `server.js:2038-2040` | Kořenové stránky nemají CSP (aplikace `/app` ji má). Po převodu na statické HTML ji jde doplnit. | CSP se `script-src 'self'` po přesunu inline skriptů. | Opraveno #226 |

## Zbytek po #223 / #224

PR #224 uzavřel #223 a výslovně ponechal P3 nálezy WEB-16, 17, 25, 30, 32 a 35 z `docs/audits/design-consistency-2026-10-22/web.md` hlavního repozitáře. Žádné issue je nesledovalo, proto se přidaly do #226 a tam jsou opravené:

| ID | Oprava v #226 |
| --- | --- |
| WEB-16 | Radiusy podle rolí DESIGN §4: `--radius-s/m/l/xl` = 10/14/20/28. PosterCard má `m`. Literály v CSS aplikace i v `activate.css` nahradily tokeny. Zůstaly jen drobné proužky 1–4 px, `0` a kruh. |
| WEB-17 | Typografická škála DESIGN §3 jako tokeny (`--font-display`, `--font-title1`, `--font-title2`, `--font-headline`, `--font-caption`, `--font-micro`) v `rem`. H1 všech stránek používají `display`, H2 všech dialogů `title2`. Hero a titul detailu mají jeden společný `--font-hero`. |
| WEB-25 | Souhrn použitých kritérií vykresluje štítky `.criteria-tag` ve skupině „Použitá kritéria“. Nepoužívá vybraný styl chipu. |
| WEB-30 | Oranžovou a `#1a1024` odstranil už PR #224. Záložní gradient hero teď míchá jen `var(--pink)` a `var(--accent)`. |
| WEB-32 | `activate.css` nemá vlastní tokeny ani hex literály. Chybějící odvozené tóny a radiusy přibyly do sdíleného `assets/tokens.css` se stejnými hodnotami jako aplikace. |
| WEB-35 | Moderace, Start přehrávání a Události klientů jdou přes `translateUI` se SK/EN klíči. Štítek „auto“ je teď „Automaticky“. |

Při ověření jsem neviděl regresi tohoto PR:

- navigace Moje seznamy s rodiči,
- vybrané stavy na control gradientu,
- hodnocení „92 %“,
- jedna `empty()`,
- spodní panel dialogů na mobilu.

## Ověření oprav

Přesné příkazy a výsledky jsou v [`docs/qa/web-native-2026-10-24/README.md`](../../qa/web-native-2026-10-24/README.md) (#225) a v [`docs/qa/web-native-p3-2026-10-24/README.md`](../../qa/web-native-p3-2026-10-24/README.md) (#226).

Ruční akceptaci v Safari, Firefoxu, na telefonech a se skutečným účtem sleduje #227.

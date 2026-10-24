# QA: nativní chování webu (audit 2026-10-24, issue #225)

Tady jsou důkazy k opravám z [`docs/audits/web-native-2026-10-24/README.md`](../../audits/web-native-2026-10-24/README.md). Všechno pochází z lokálního fixture serveru (`test-support/app-fixture.cjs`, účet test), ne z produkce.

**Prostředí:**
- macOS, Node 24.18.0 (`/opt/homebrew/opt/node@24`),
- headless Chromium 151 z `playwright-core` 1.62.1.

**Revize:**
- *Před:* export `origin/main` `2393d5c` (`git archive`),
- *Po:* větev `fix/web-native-2026-10-24`.

## Automatické kontroly

```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run check
```
```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm test
```
```bash
PLAYWRIGHT_CORE=/cesta/k/node_modules/playwright-core \
  PATH=/opt/homebrew/opt/node@24/bin:$PATH node test-support/web-native-e2e.cjs --shots docs/qa/web-native-2026-10-24
```
```bash
PLAYWRIGHT_CORE=/cesta/k/node_modules/playwright-core \
  PATH=/opt/homebrew/opt/node@24/bin:$PATH node test-support/web-native-e2e.cjs --root /tmp/export-origin-main --port 8396 --prefix before
```

| Kontrola | Před (`2393d5c`) | Po |
| --- | --- | --- |
| `npm run check` | — | prošlo |
| `npm test` | 666/666 (bez nových testů) | **674/674** |
| `web-native.test.js` (7 testů) | 0/7, všechny selžou | 7/7 |
| `catalog-action-context.test.js`, nový test detailu nad stránkou | selže (na `catalog.js` z `2393d5c` s novým `detail-route.js`) | prošlo |
| `test-support/web-native-e2e.cjs` (24 kontrol) | 4 prošly / 20 selhalo ([`e2e-before.json`](e2e-before.json)) | **24/24** ve třech po sobě jdoucích bězích ([`e2e-after.json`](e2e-after.json)) |

**Kontroly, které prošly už před opravou:**
- `prefers-reduced-motion`,
- bez vodorovného posunu na 360, 768 a 1920 px.

Některá selhání „před“ jsou následná: detail se neotevřel, takže další krok nenašel prvek.

## Co prohlížečový průchod ověřuje

- **N01** Detail titulu:
  - karta je `<a href="#movies?title=2">`,
  - otevření zapíše adresu a `document.title`,
  - Zpět detail zavře, stránka zůstane a fokus se vrátí na kartu,
  - Vpřed detail znovu otevře,
  - sdílený odkaz otevře detail nad stránkou.
- **N14** Esc ve výběru zdroje a v profilu osoby vrátí na detail, Esc v detailu vrátí stránku Filmy.
- **N02** Odkaz Hledat má název i v kompaktní hlavičce (1024 px).
- **N04** Otevřený dialog nastaví `overflow: hidden` na `html`. Kolečko nad detailem na 360 px nehne stránkou (`scrollY` zůstane 0).
- **N05** Klik na pozadí zavře Nastavení.
- **N06** Panel účtu bez `aria-haspopup`. Tab z panelu ven ho zavře.
- **N07** Po kliknutí na Seriály je fokus na H1.
- **N08** Hledat dá fokus do `#search-q`.
- **N09** Skupina „Rok vydání“ má pole od a do.
- **N10** Tečka karuselu má cíl 24 × 44 px bez překryvu a `role="group"`.
- **N03, N12, N13** Kořenové stránky:
  - úvodní stránka nenačte skript z cizí domény,
  - funguje i při zablokovaném unpkg.com,
  - FAQ se otevře klávesou Enter,
  - popisky jsou propojené s poli,
  - `color-scheme: dark` na `/`, `/privacy.html`, `/delete-account.html`, `/en/index.html`, `/en/privacy.html`, `/activate` a `/devices`,
  - zásady soukromí a smazání účtu mají `<main>` + H1 i bez JavaScriptu.

## Snímky

| Soubor | Co ukazuje |
| --- | --- |
| `before-1280-landing-cdn-blocked.jpg`, `before-360-landing-cdn-blocked.jpg` | Úvodní stránka před opravou při nedostupném unpkg.com: jen chybová hláška. |
| `after-360-landing-cdn-blocked.jpg`, `after-1280-landing-nojs.jpg` | Po opravě: statická stránka se zobrazí bez CDN i bez JavaScriptu. |
| `after-1280-landing-faq.jpg` | FAQ jako `<details>` otevřené z klávesnice. |
| `before-360-home.jpg` → `after-360-home.jpg` | Hlavička na telefonu: tři řádky → dva (znak a akce v jednom řádku). |
| `after-1024-header.jpg` | Kompaktní hlavička s ikonou Hledat (přístupný název zůstává). |
| `after-1280-detail.jpg`, `after-360-detail.jpg` | Detail otevřený přes adresu `#movies?title=…`. Na mobilu přes celou obrazovku, stránka pod ním stojí. |
| `before/after-768-home.jpg`, `before/after-1280-home.jpg`, `before/after-1920-home.jpg` | Domů na tabletu a desktopu beze změny vzhledu (kontrola regresí). |

## Ruční kontrola v prohlížeči (panel prohlížeče, 360–1920 px)

Při auditu jsem prošel:
- přihlášení, výběr profilu, Domů, Filmy, Hledání a Moje seznamy,
- detail, výběr zdroje, menu účtu, upozornění a úvodní stránku,
- zásady soukromí.

Kontroloval jsem accessibility tree, klávesnici, Zpět a Vpřed a měření cílů.

Po opravě jsem v panelu ručně ověřil:
- Hodnotit → Zavřít vrátí detail,
- profil osoby → Zavřít vrátí detail,
- vnořený detail z „Podobné“ → Zavřít vrátí stránku `#movies` jedním krokem (`history.go(-n)`),
- deep link → Zavřít nahradí adresu stránkou.

## Známá omezení

Následující nebylo ověřeno a sleduje to #227:
- Safari (macOS a iOS), Firefox a Chrome na Androidu,
- skutečná čtečka (VoiceOver, NVDA),
- skutečný účet a produkce.

Media Session (N11) je ověřená unit testem s náhradním `navigator.mediaSession`. Fixture nemá přehratelný stream, takže systémové „Právě hraje“ ve skutečném prohlížeči zatím ověřené není (#227).

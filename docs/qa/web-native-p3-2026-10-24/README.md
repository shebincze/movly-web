# QA: zbytek P3 nativního auditu a auditu #223 (issue #226)

Tady jsou důkazy k opravám WEB-N24–N28, WEB-N30 z [`docs/audits/web-native-2026-10-24/README.md`](../../audits/web-native-2026-10-24/README.md) a WEB-16, 17, 25, 30, 32, 35 z auditu designové konzistence #223. Všechno pochází z lokálního fixture serveru (`test-support/app-fixture.cjs`, účet test), ne z produkce.

**Prostředí:**
- macOS, Node 24.18.0 (`/opt/homebrew/opt/node@24`),
- headless Chromium z `playwright-core` 1.62.1.

**Revize:**
- *Před:* export `origin/main` `2585a73` (`git archive`) s novými testy nakopírovanými navrch,
- *Po:* větev `fix/web-native-p3-226`.

## Automatické kontroly

```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run check
```
```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm test
```
```bash
PLAYWRIGHT_CORE=/cesta/k/node_modules/playwright-core \
  PATH=/opt/homebrew/opt/node@24/bin:$PATH node test-support/web-native-e2e.cjs --shots docs/qa/web-native-p3-2026-10-24
```
```bash
PLAYWRIGHT_CORE=/cesta/k/node_modules/playwright-core \
  PATH=/opt/homebrew/opt/node@24/bin:$PATH node test-support/web-native-e2e.cjs --root /tmp/export-origin-main --port 8396 --prefix before
```

| Kontrola | Před (`2585a73`) | Po |
| --- | --- | --- |
| `npm run check` (syntaxe, ES5, překlady) | — | prošlo |
| `npm test` | 674/674 (bez nových testů) | **686/686** |
| `web-native-p3.test.js` (11 testů) | 0/11, všechny selžou | 11/11 |
| `server.test.js` › WEB-N30 CSP kořenových stránek | selže („skripty jen ze souborů“, CSP chybí) | prošlo |
| `client-telemetry.test.js` (upravený kvůli `translateUI`) | — | 3/3 |
| `test-support/web-native-e2e.cjs` (32 kontrol) | 25 prošlo / 7 selhalo ([`e2e-before.json`](e2e-before.json)) | **32/32** ve třech po sobě jdoucích bězích ([`e2e-after.json`](e2e-after.json)) |

**Proč nové jednotkové testy selhaly před opravou:**

| Test | Selhání na `2585a73` |
| --- | --- |
| WEB-N24 | `:root` má `font-size: 16px` |
| WEB-17 | token `--font-display` neexistuje |
| WEB-16 | tokeny `--radius-s/m/l/xl` neexistují |
| WEB-N25 | `railPaging` neexistuje |
| WEB-N26 | karusel nemá `aria-roledescription` |
| WEB-25 | `criteriaTags` neexistuje |
| WEB-30 | pozadí hero obsahuje `rgba()` literály |
| WEB-32 | `activate.css` definuje vlastní tokeny |
| WEB-35 | `client-telemetry.js` má český text bez SK/EN klíče |
| WEB-N27/N28 | úvodní stránka nemá `mv-desktop-nav` ani mobilní nabídku |
| WEB-N30 | `index.html` obsahuje inline skript |

**Nové kontroly E2E, které před opravou selhaly:**
- WEB-N24: písmo prohlížeče 20 px (`Page.setFontSizes`). Před opravou zůstal kořen na 16 px. Po opravě má kořen 20 px na 1280 i 360 px a stránka nepřetéká.
- WEB-N25: stránkování řady myší. Tlačítko „Další“ je na začátku vidět a „Zpět“ ne, obě mají `tabindex=-1`. Kliknutí posune řadu o 90 % šířky, na konci tlačítko Další zmizí. Na dotykovém zařízení mají tlačítka `display: none`.
- WEB-N26: karusel hlásí `karusel` a „Doporučené tituly“, snímek má `group`/`snímek`. Pořadí se mění z „1 z 4“ na „2 z 4“ a ohlašuje přes `aria-live="polite"`.
- WEB-N27: na 360 px je vidět nabídka „Nabídka“ (cs) a „Menu“ (en). Otevírá se klávesou Enter a zavírá klávesou Escape i po výběru odkazu. Stránka nepřetéká a na 1280 px nabídka není.
- WEB-N28: tlačítko „Pozastavit animace“ zastaví oba pásy plakátů (`animation-play-state: paused`). Změní se na „Spustit animace“ a volba vydrží obnovení stránky.
- WEB-N30: `/`, `/privacy.html`, `/delete-account.html`, `/en/index.html`, `/activate`, `/devices` a `/party/ABCDEF` mají hlavičku CSP se `script-src 'self'`. Nenastala žádná událost `securitypolicyviolation` a konzole nehlásí žádné „Refused to…“. Skript pozvánky party vypíše kód.

**Kontroly, které prošly už před opravou:**
- WEB-N30 „přihlášení a instalačky (cs i en) fungují pod CSP“. Před opravou CSP chyběla, takže inline skript běžel. Kontrola hlídá, že přesun skriptů do `/landing.js` a `/en/landing.js` přihlášení, výpis instalaček ani stažení nerozbil.
- Původních 24 kontrol z #225.

## Snímky

| Soubor | Co ukazuje |
| --- | --- |
| `after-360-landing-menu.jpg` | WEB-N27: mobilní nabídka české úvodní stránky |
| `after-360-en-landing-menu.jpg` | WEB-N27: mobilní nabídka anglické úvodní stránky s odkazem na češtinu |
| `before-360-landing-cdn-blocked.jpg` | Hlavička před opravou: bez navigace na telefonu |
| `after-1280-landing-motion-paused.jpg` | WEB-N28: zastavené pásy a tlačítko „Spustit animace“ |
| `after-1280-landing-login-csp.jpg` | WEB-N30: přihlášení a výpis instalaček pod CSP |
| `after-720-rail-paging.jpg` | WEB-N25: tlačítko Další na řadě při najetí myší |
| `after-1280-font20-movies.jpg`, `after-360-font20-movies.jpg` | WEB-N24: písmo prohlížeče 20 px bez přetečení |
| `before-1280-home.jpg`, `after-1280-home.jpg`, `before-360-home.jpg`, `after-360-home.jpg` | WEB-16/17: Domů před opravou a po ní (hero, nadpisy, radiusy karet) |
| `before-1280-detail.jpg`, `after-1280-detail.jpg` | WEB-17: titul detailu (`--font-hero`) a radiusy |

## Omezení

- **Řady ve fixture jsou krátké.** Fixture má v řadě 3–4 karty, které se na 1280 px vejdou. Stránkování proto ověřuje okno 720 px se stejnou myší (`hover: hover`, `pointer: fine`). Pravidla CSS na šířce nezávisí.
- **Přihlášení na úvodní stránce má podvržené API.** Fixture účet nesplňuje serverovou kontrolu účtu pro `/api/auth/*` (chybí `email`, `coins`, `premium_until`). Kontrola proto podvrhuje odpovědi `/api/auth/login`, `/api/downloads` a `/link` ve stejném originu. Stránku, CSP i skript servíruje skutečný `server.js`.
- **Velikost písma prohlížeče jen v Chromiu.** Nastavení emuluje CDP `Page.setFontSizes`. Safari a Firefox zůstávají v ruční akceptaci #227.
- **CSP v produkci není ověřená.** Hlavičku posílá `server.js`, nic se nenasazovalo. Pokud produkční proxy hlavičky přepisuje, je třeba to po nasazení ověřit, například `curl -sI https://movly.sheri.cz/ | grep -i content-security-policy`.
- **Opravený balicí skript.** `scripts/deploy-web-release.sh` už neuvádí `support.js`, který #225 smazal (`tar` by na něm selhal), a balí nové `landing.js` a `party.js`. Test WEB-N30 hlídá, že balení obsahuje všechny soubory z allowlistu `server.js`. Skutečné balení ani nasazení se nespouštělo.

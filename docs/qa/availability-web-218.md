# DB dostupnost na webu a TV (#218)

21. 10. 2026, základ `0d6a0ff`. Schválená parita iOS z shebincze/Movly#1465. Bez nasazení a bez vydání klientů.

## Rozsah a pravidla

Film a epizody mají černou kapsli `8x | FHD | CZ / EN`. Nejvyšší naměřená kvalita a zvuk patří stejným dostupným DB záznamům. Potvrzená nula a neznámá dostupnost mají samostatné popisy. UI a přístupové popisky jsou česky, slovensky a anglicky.

Úplný `/streaming/titles/{id}/inventory` se načítá jednou na titul. Webová přístupová vrstva vynucuje účet/profil/Premium a filtruje pouze podporované providery podle připojení v aktuální šifrované relaci; Webshare/Fastshare/Sosáč/Stremio bez připojení nepřispívají metadaty. Žádné URL ani přihlašovací údaje nejsou součástí inventáře. Čtení je `private, no-store`. Starý účet/profil, neúplné/degradované odpovědi a chyba sítě se nestanou nulou.

Připojení/odpojení v nastavení okamžitě obnoví přehled běžného detailu. Zrušený dialog i změna routy zruší jeho požadavek. Přepnutí řady používá již načtenou mapu, žádné dotazy po epizodách. TV lite sdílí ES5 helper, podporuje původní ovladač a nezískává nový fokus. Po návratu do již otevřeného TV detailu je třeba zohlednit změněné připojení (ověřeno v implementaci `onShow`).

## Ověření

- Node 26.7.0: `npm run check` PASS, včetně ES5 parseru pro staré TV. Nový helper je přímo v ES5 kontrolované složce.
- `npm test`: 654 testů PASS, bez přeskočení. Nové modelové a přístupové testy: nepřipojený Webshare, nejvyšší kvalita/zvuk, prázdné/chybné/degradované údaje, jiný titul, scope účtu/profilu, provider connect/disconnect v syntetické relaci a nezveřejnění credentials. Existující test offline manifestu ověřuje i nový import.
- Browser plugin/skill není v této relaci dostupný; pravidelný Playwright použil bundled Chromium v headless režimu proti explicitní loopback fixture. Žádný produkční účet.
- `test-support/database-inventory-browser.cjs`: desktop 1440×1000, mobil 390×844, TV 1920×1080. Skutečný filmový detail `2x | FHD | CZ` místo globálních21; epizoda8/FHD/CZ+EN a potvrzená chybějící epizoda bez streamu. Jedno úvodní čtení inventáře na titul. HTTP503 zůstane neznámé, opakování obnoví původní hodnoty. TV klávesové šipky zachovají fokus tlačítek. Anglický a slovenský přístupový popisek PASS. Žádná JS výjimka.
- Screenshoty desktop/mobil/TV zkontrolovány: kapsle je čitelná, uvnitř šířky a na TV vodorovná; oddělené CSS pravidlo zabraňuje zdědění blokových spanů epizody.
- Logy, JSON a screenshoty: `/Users/shebin/MovlyEvidence/availability-parity-20261021/web-browser-final`. Testovací artefakty se necommitují.

Příkazy pro opakování (různé terminály; QA účty/heslo jsou výhradně součást veřejné lokální fixture):

```sh
MOVLY_FIXTURE_FEEDBACK_ADMIN=1 MOVLY_FIXTURE_PORT=18086 MOVLY_FIXTURE_UPSTREAM_PORT=18087 node test-support/app-fixture.cjs
MOVLY_INVENTORY_QA_BASE=http://127.0.0.1:18086 MOVLY_INVENTORY_QA_EVIDENCE=/absolute/evidence/path NODE_PATH=/path/to/playwright/node_modules node test-support/database-inventory-browser.cjs
```

Fyzická TV, přihlášená produkční data a systémová čtečka obrazovky nebyly ověřeny; zůstávají v shebincze/Movly#1465. Zdrojový merge neznamená nasazení webu.

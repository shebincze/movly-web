# Movly webová aplikace — první fáze

Implementace je v `app/`, serverová brána v `app-server.js`, obojí obsluhuje stávající `server.js`. Cílová cesta je `https://movly.sheri.cz/app`. Produkční aplikace je dostupná a byla ověřena 5. 9. 2026. Aktivní vydání `web-20260905T103417Z-4b6cf53cc564` na PX / LXC 214 se shoduje s lokálním balíčkem (32 porovnaných souborů). Nasazení mezitím provedla souběžná práce; tato kontrola jej znovu nepřepisovala. Přihlášení skutečným účtem zatím nebylo ověřeno.

## Funkce

- Přihlášení stávajícím Movly účtem, odhlášení a obnovení relace.
- Výběr existujícího profilu, PIN a explicitní profilové oprávnění.
- Objevovat: skutečné řady z `/v1/main/`, včetně osobních řad, které API vrátí.
- Filmy a seriály: žánr, rok, minimální hodnocení, řazení a stránkování.
- Hledání s počtem výsledků, stránkováním a upozorněním na částečná data.
- Detail: popis, dostupná metadata, obsazení, řady seriálu a podobné tituly.
- Soukromé seznamy: vytvořit, přejmenovat, smazat, přidat a odebrat titul.
- Responzivní desktop/mobil, ovládání klávesnicí, nativní dialogy, loading/error/empty stavy.

Přehrávání a jeho API nejsou v této fázi implementovány. Zakládání či editace profilů, hodnocení titulů a další pokročilé nativní funkce nejsou součástí první fáze. Souběžně přidanou administraci nahlášení vlastní samostatná práce; její soubory a testy byly zachovány.

## Napojení a přihlášení

Používá se stávající `MOVLY_API_BASE` a serverový `MOVLY_API_KEY`. Aplikace nepoužívá lokální databázi katalogu ani testovací data při běžném `npm start`. Každá katalogová operace nejprve ověří aktuální účet přes `/v1/auth/me`, i když upstream katalog nabízí čtení pomocí API klíče. Oprávnění profilu a vlastnictví seznamů ověřuje také core API.

Přihlašovací token a profilový grant jsou šifrované AES-256-GCM v HttpOnly/SameSite=Strict cookie; produkce používá `__Host-` a Secure. Klíč se odděleně odvozuje přes HKDF ze stávajícího `DOWNLOAD_TOKEN_SECRET`. Rotace tohoto secretu zneplatní webové relace. Cookie má absolutní dobu 12 hodin; API může účet nebo relaci zneplatnit dříve. Autorizační token se nevrací JavaScriptu ani neukládá do localStorage. Stávající download/zařízení stránky mají svůj původní přihlašovací mechanismus; nejde o sjednocené webové SSO.

Mutace vyžadují přesný Origin vůči Host a vlastní hlavičku. Brána má uzavřený seznam cest a parametrů; cílové URL, uživatelské ID, token ani profilové hlavičky z prohlížeče nepřebírá. Stránka je veřejný přihlašovací shell, nikoliv veřejný katalog. Testy, serverový modul a designové podklady nejsou přes statický server dostupné.

## Lokální ověření

```sh
cd /Users/shebin/Projekty/Movly/web
npm run check
npm test
npm run preview:app
```

Poslední příkaz spustí **výhradně testovací náhled** na loopback portech 8086/8087, s odděleným API a dočasnými daty v paměti. Účet `test` / `movly-test`, PIN chráněného profilu `1234`. Testovací filmová ID a metadata nejsou produkční. Restart zahodí testovací seznamy. Náhled není přepínač ani fallback produkční aplikace.

Ověřeno v Codex IAB: přihlášení, výběr profilu, správný/nesprávný PIN, katalog, detail, uložení do seznamu a jeho obsah, hledání, filtr s prázdným výsledkem, desktop 1536×1024 a mobil 390×844. Automatické testy pokrývají ochranu cookie, CSRF, revokaci, izolaci profilu, uzavřené cesty, mutace seznamů, neúplná data i regresi stávajícího webu.

## Nasazení

Nasazuje se stávající Node web včetně nového `app-server.js` a celého `app/`; nepotřebuje frontend build ani nové npm runtime balíčky. Zachovány jsou původní serverové HTML/JS konvence, frontend používá samostatné ES moduly. `design/`, `test-support/` a testy nejsou nutné v runtime balíčku.

Před skutečným cutoverem je třeba ověřit aktuální webový checkout/revizi a cílový proces, origin `movly.sheri.cz`, předávání Host přes HTTPS proxy a existující trusted proxy konfiguraci, oprávnění API klíče pro katalog i zápis seznamů a živý účet včetně PINu. Žádné credentials se nevkládají do klientského JavaScriptu. API volání musí procházet Node procesem; statický hosting tuto funkci neposkytuje. Plakáty jsou povoleny z `image.tmdb.org`; neznámé zdroje se nezobrazují jako důvěryhodné obrázky.

## Produkční ověření 2026-09-05 10:41 UTC

- Aktivní cesta `/srv/movly/.movly-web-releases/web-20260905T103417Z-4b6cf53cc564`, služba `movly-web` active/running, Node 18.20.4.
- SHA-256 `server.js`: `4b6cf53cc564186d3c201872afa9c41182d09875f985927c78c4104bcccbda62`.
- SHA-256 `app-server.js`: `a4aa8a8ace58ca311ded2e20605ec160faf7a5e5891718dae5c176ba47642862`.
- HTTP 200: `/`, `/app`, `/app/`, ES moduly/CSS aplikace, `/devices`, `/activate`, `/api/updates/windows`.
- HTTP 401 bez přihlášení: `/api/app/session`, `/api/app/main`, `/api/app/admin/reports`.
- HTTP 404: serverový modul a testovací API; validace přihlášení ze stejného originu 400 při prázdném těle, cizí Origin odmítnut 403.
- Přes stávající serverový klíč skutečné API vrátilo readiness 200, 28 žánrů a 10 titulů z testovaného katalogového dotazu. Klíč nebyl vypsán ani přenesen do klienta.
- IAB načetl živou přihlašovací obrazovku na `https://movly.sheri.cz/app`.
- Lokální syntaxe a všech 45 testů prošly.
- Zbývá uživatelský end-to-end test reálného přihlášení, PINu a zápisu seznamu v produkci. Přehrávání je nadále mimo první fázi.

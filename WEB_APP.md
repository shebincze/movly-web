# Movly webová aplikace

Implementace je v `app/`, serverová brána v `app-server.js`, obojí obsluhuje stávající `server.js`. Cílová cesta je `https://movly.sheri.cz/app`. Produkční přihlášení skutečným uživatelským účtem zatím nebylo ověřeno; podrobnosti posledního nasazení jsou níže.

## Funkce

- Přihlášení stávajícím Movly účtem, odhlášení a obnovení relace.
- Výběr existujícího profilu, PIN a explicitní profilové oprávnění.
- Home: karusel `top-home`, kolekce s bannery, Nejsledovanější, Populární streamy a Tipy z ČSFD ze stejných themed-listů jako macOS.
- Filmy a seriály: pojmenované řady z `/v1/main/` pro příslušný typ, rozšíření celé řady a samostatné filtrování katalogu.
- Hledání s počtem výsledků, stránkováním a upozorněním na částečná data.
- Detail: popis, hodnocení, trailer, filmová kolekce, obsazení s biografií a filmografií, řady a epizody s přehráním a označením Viděno, podobné tituly.
- Soukromé seznamy: vytvořit, přejmenovat, smazat, přidat a odebrat titul.
- Responzivní desktop/mobil, ovládání klávesnicí, nativní dialogy, loading/error/empty stavy.

Přehrávání, správa profilů s avatary, hodnocení, historie a správa sdílení seznamů jsou implementovány; limity přehrávače jsou popsány níže. Souběžně přidanou administraci nahlášení vlastní samostatná práce; její soubory a testy byly zachovány.

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

## Web parity update — 2026-09-05

Implemented: actual profile avatars (including restored sessions and a validated avatar picker), profile creation/editing and deletion, watchlist poster rails from the bounded overview contract, title membership toggles, create-and-add, shared watchlists, sharing by username, public-link creation/revocation and leaving shared lists. Title details now expose seasons/episodes, ratings, watch status and stream selection; account navigation includes history, yearly statistics, friends/privacy and Webshare connection.

Playback (#153, 17. 10. 2026): **no video bytes pass through the Movly web server** — no FFmpeg transcode or remux, no HLS/segment proxy, no download proxy, no server-side ffprobe. The server only searches and resolves the source (provider credentials stay in the encrypted HttpOnly session) and `POST /api/app/playback` returns the provider's direct link `{direct, url, kind: "file"|"hls"}`. The browser plays it itself: progressive files through `<video src>`, HLS natively or through the bundled hls.js 1.7.2 (`app/vendor`). Source links are still resolved only from canonical title/episode stream IDs or signed tickets, and every playback request revalidates the selected profile grant.

A link the browser cannot open itself is answered with `422 app_required` and the web offers the native app (`movly://title/{id}`) or the app download: non-HTTPS links, links that need headers a browser cannot send (Referer, Cookie…) and providers whose links bind to the resolving server's IP (VOE, Streamtape, ČT; measured 17. 10. 2026). The player also offers the app when the browser rejects the format, when the audio track is silently dropped (e.g. AC-3/E-AC-3/DTS), or when the provider stops sending the file; a new link is only requested when the viewer presses "Zkusit znovu". Track selection uses only what the browser exposes (`audioTracks`, `textTracks`). Offline saving and adding a source to the database (audio verification would read the video) are app-only on the web. CSP allows `media-src https:` for provider media; `connect-src` is `'self'` plus `https://api.theintrodb.org` (below).

Skip segments (#166, contract `shebincze/Movly/contracts/playback-segments`): the browser loads `/v1/playback/segments` (IntroDB.app) through the BFF and, at the same time, calls TheIntroDB v4 **directly** (`app/theintrodb.js`, anonymous `fetch` with `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `cache: "no-store"` and no own headers, so no CORS preflight); TheIntroDB is never proxied by `server.js`/`app-server.js`. Both answers are merged per the contract and kept only in page memory (max 1 h / 50 entries); the former `localStorage` keys `movly.intro.segments.v1`/`v2` are removed at start-up. As of 18. 10. 2026 `api.theintrodb.org` sends `Access-Control-Allow-Origin` only for `https://theintrodb.org`, so the browser blocks the answer: after that first network error the page does not retry TheIntroDB and uses only server segments (never automatic). It starts working on the next page load once TheIntroDB allows the Movly origin. Attribution is shown in the skip-intro setting.

Runtime requirements: Node >=18 and the provider resolver. FFmpeg is no longer used by the web server. Because the server no longer produces video, the former single-browser limit is gone and Watch Party can have any number of web members.

Final subtitle release: `/srv/movly/.movly-web-releases/web-20260905T113600Z-076f79211244`, activated 2026-09-05 11:36:14 UTC. Runtime syntax and service smoke checks passed.


## Rozšíření katalogu a živých zdrojů — 5. 9. 2026

Home a katalogy byly porovnány s `Apple/Movly/Services/RemoteCatalog.swift` a živými produkčními odpověďmi. Detail a samostatný endpoint podobných titulů mají odlišné DTO: podobné tituly používají `similar_title_id` pro identitu a `title`/`type` pro popis. Filmografie je pole `PersonCredit` s `title_id`.

Zdroje nyní agregují obě databáze a živé Webshare/Hellspy hledání (až 12 variant českého a původního názvu, 200 výsledků na dotaz). Výsledky přicházejí po jednotlivých poskytovatelích, mají filtr poskytovatele/kvality/textu, řazení a deduplikaci. Chyba nebo nepřipojený účet se zobrazují odděleně od prázdných výsledků. Webshare vyžaduje připojený účet v aktuální webové relaci. Hellspy používá skutečné pole `fileHash`; živý dotaz vrátil 200 parsovatelných výsledků. Ověřené mediální přesměrování vede na `sixseven.onecdn1.net`, jedinou dodatečně povolenou CDN doménu. Každé přesměrování nadále ověřuje doménu a veřejnou DNS adresu.

Živý výsledek má serverem podepsaný výběr vázaný na přihlášení, zařízení, profil, grant, titul a epizodu. Prohlížeč nemůže dodat vlastní mediální URL. Hledání kontroluje grant a epizodu proti katalogu. Hledání opakované v minutě sdílí výsledek; nejvýše 100 současných cache záznamů. Přehrávání ověřuje účet a grant znovu.

Tato změna nepřidává ostatní nativní poskytovatele (Sosáč, FastShare, Česká Wiki, Stremio doplňky, Bombuj, ČT, Přehraj.to). Není to úplná shoda všech nativních funkcí. Reálné Webshare přihlášení ani kompletní reálný Hellspy film nebyly přehrány; hledání a mediální redirect Hellspy byly ověřeny živě, samotná pipeline generovaným MKV.

Nasazení tohoto rozšíření: `web-20260905T121316Z-076f79211244`, aktivováno 5. 9. 2026 v 12:13:37 UTC. Závěrečná sada: 67/67 testů, syntaxe bez chyb. Veřejné JS/CSS soubory se shodují s lokálními SHA-256; anonymní katalogové/zdrojové/přehrávací API vrací 401 a interní moduly/testovací fixture 404. V prohlížeči ověřeny Home, Filmy, Seriály, detail, filmografie, rozbalení epizod a filtrování poskytovatele. Podepsaný živý výsledek v izolované fixture přehrál generovaný 45sekundový HEVC MKV do konce (640×360, readyState 4, žádné chyby konzole).

## Movly TV lite pro staré prohlížeče TV (issue #64)

Omezená verze pro vestavěné prohlížeče starších chytrých TV (cíl: LG NetCast, jádro Chrome 34). Kód je ES5 bez modulů a bez `fetch`, CSS bez proměnných, gridu a `position: sticky`; CSP (`script-src 'self'; style-src 'self'`) zůstává beze změny.

- **Vstup:** `app/legacy.js` při nepodporovaném prohlížeči (bez `noModule` nebo CSS proměnných) načte `/app/tv/tv.css` a `/app/tv/tv.js`. Když se nenačte ani TV lite, zobrazí se původní hláška o nepodporovaném prohlížeči. Přímý vstup: `/app/tv/` (server mapuje na `app/tv/index.html`), z plné aplikace také `/app/?tv=1` nebo `/app/#tv` (přesměrování na `/app/tv/`). Moderní prohlížeč na `/app/` dostane plnou aplikaci beze změny. Pokud se modulový start zasekne na více než 20 s, zobrazí se jen záložní hláška, aby později dokončený modul nesoutěžil s druhou aplikací.
- **Funkce:** přihlášení, výběr profilu včetně PINu (číselná klávesnice na obrazovce i číslice ovladače), řady Domů a kolekce, hledání, detail filmu a seriálu s řadami a epizodami, výběr zdroje (nebo automaticky doporučený podle stejných pravidel jako plná aplikace) a přehrávání na celou obrazovku s pokračováním od uložené pozice a ukládáním pozice každých 20 s a při ukončení. Bez administrace, přátel, party, nastavení, offline, Premium a zpětné vazby; účty poskytovatelů (Webshare apod.) se připojují v plné aplikaci.
- **Ovládání:** šipky přesouvají fokus podle polohy prvků, OK potvrzuje, Zpět (kód 461, Backspace mimo textové pole, Esc) vrací o obrazovku. V přehrávači OK = přehrát/pozastavit, vlevo/vpravo = posun o 10 s (mimo připravený úsek se relace otevře znovu od cílové pozice), Zpět = ukončit.
- **Přehrávání:** nejprve nativní HLS (`canPlayType("application/vnd.apple.mpegurl")`); když nativní přehrávání nic nepřehraje a existuje Media Source Extensions, použije se ES5 build hls.js 0.14.17 (`app/vendor/hls-0.14.17.light.min.js`, Apache-2.0, integrita ověřena proti npm registru). Bez obojího se zobrazí česká chyba. Od #153 televizor přehrává přímý odkaz poskytovatele (soubor přes `video.src`, HLS nativně nebo přes hls.js); co neumí, nabídne jiný zdroj nebo aplikaci Movly.
- **BFF:** pouze existující cesty (`session`, `login`, `logout`, `profiles`, `profile`, `home`, `search`, `titles/{id}`, `titles/{id}/seasons`, `providers/*` GET, `streaming(2)/titles/{id}/streams`, `sources/{id}/{webshare|hellspy|native}`, `watch-history/position/{id}`, `watch-history`, `playback`, `playback/{id}/status|index.m3u8|…`, `DELETE playback/{id}`).
- **Offline shell:** soubory TV lite nejsou v seznamu service workeru; staré prohlížeče service worker nemají a TV lite funguje jen online.
- **Kontroly:** `npm run check` spouští i `scripts/check-es5.js` (povinný parser Acorn 8.15.0 s `ecmaVersion: 5`, včetně vendorovaného hls.js, a stráž proti ES2015+ API v aplikačních skriptech; bez npm instalace); testy v `tv-lite.test.js` a `server.test.js`. Skutečné jádro Chrome 34 ani fyzická LG TV zatím ověřeny nebyly.

Ověření opravy #64: lokální BFF fixture pokrývá přihlášení, odmítnutý i správný PIN, domů, hledání a detail filmu/seriálu. Deterministická mediální fixture v moderním Chromium ověřila dekódování H.264/AAC přes nativní HLS i skutečný vendorovaný hls.js/MSE, obnovení pozice, ukládání filmu i epizody a návrat ovladačem při 720p/1080p. Tato simulace chybějících schopností není důkaz běhu v Chrome 34; konkrétní kodeky, TLS a chování LG NetCast musí potvrdit skutečné zařízení. Ruční zpětná vazba není součástí TV lite. BFF allowlist a CSP se nemění.

Diagnostika TV (#100) používá sdílenou ES5 politiku `app/tv/diagnostics.js` na klientovi i před serverovým logem. Přenáší pouze uzavřené události, omezené číselné hodnoty, booleany a předem dané enumy. Události při editaci vstupů/formulářů ani tisknutelné klávesy se nezaznamenávají; zprávy, URL, tokeny, UA a klientská korelační ID se neukládají. Backend znovu filtruje i payload starého klienta.

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

## Web parity update — 2026-09-05

Implemented: actual profile avatars (including restored sessions and a validated avatar picker), profile creation/editing and deletion, watchlist poster rails from the bounded overview contract, title membership toggles, create-and-add, shared watchlists, sharing by username, public-link creation/revocation and leaving shared lists. Title details now expose seasons/episodes, ratings, watch status and stream selection; account navigation includes history, yearly statistics, friends/privacy and Webshare connection.

Playback uses a locally hosted hls.js 1.7.2 bundle (license in `app/vendor`). Provider credentials are used only for authentication; the Webshare token remains inside the encrypted HttpOnly session. Source links are resolved from canonical title/episode stream IDs, never supplied by the browser. Every playback request revalidates the selected profile grant. A loopback source proxy pins public IPv4 DNS results for HTTPS Webshare hosts and revalidates redirects. FFmpeg receives only a random loopback URL and a bounded format/protocol allowlist.

Runtime requirements: Node >=18, FFmpeg/ffprobe. The current 2-core, 2-GB LXC allows one active web playback session. H.264 is remuxed; H.265 is converted to H.264 up to 720p, AAC stereo. HLS files use a bounded rolling window and idle sessions expire after three minutes. Seeking and audio-track changes reopen the source at the requested position. Progress saves to the canonical profile watch history.

Validation: 55 tests passed locally, including real H.264/HEVC MKV input -> inspected H.264/AAC HLS segments. The five codec/security tests (including embedded text subtitles) also passed on LXC214 with Debian FFmpeg 5.1.9. Provider login/file resolution with an actual Webshare account remains unverified until the user connects their account. This is not full native parity: other external provider adapters, image-based subtitles, Watch Party, offline downloads, native HDR/Dolby Vision and lossless/multichannel audio remain outside this web implementation. Do not claim them supported.

Browser playback QA: an isolated provider fixture streamed a generated 45-second HEVC/AC3 MKV through the real source proxy, FFmpeg and HLS BFF. Chromium reported readyState=4, 640x360 decoded frames and advancing currentTime, with no console errors. This verifies the pipeline, not real Webshare credentials or provider availability.

Deployed release: `/srv/movly/.movly-web-releases/web-20260905T111951Z-076f79211244`, activated 2026-09-05 11:20:31 UTC. Public HTTPS app/player/profiles/HLS bundle returned 200 and matched local hashes; anonymous session/provider/playback returned 401; server modules and QA fixture paths returned 404. Browser HEVC playback also successfully restarted at zero after a seek.

Embedded text subtitles (SRT/ASS/WebVTT/mov_text) are converted into an authenticated HLS WebVTT rendition in the same FFmpeg process. Selecting a subtitle track restarts at the current position. Image subtitles are explicitly disabled. The optional `sname` map field is omitted for Debian FFmpeg 5 compatibility; all five media tests pass there.

Browser subtitle QA: the generated HEVC MKV displayed the Czech sentence from its embedded SRT track in the video after enabling subtitles and restarting at zero. HLS subtitle activation follows SUBTITLE_TRACKS_UPDATED and native addtrack; video and text were inspected visually.

Final subtitle release: `/srv/movly/.movly-web-releases/web-20260905T113600Z-076f79211244`, activated 2026-09-05 11:36:14 UTC. Runtime syntax and service smoke checks passed.

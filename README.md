# Movly — web

Landing page aplikace **Movly** + serverově chráněné ruční stažení instalaček pro Movly Premium/VIP účty. Windows auto-update je oddělený: bezpečnostní a kompatibilitní aktualizace jsou dostupné každému přihlášenému uživateli.

GitHub Pages může sloužit jen jako vizuální reference. Pro reálné stažení instalaček musí web běžet přes `server.js`, protože statický hosting neumí bezpečně chránit soubory před nepřihlášenými uživateli.

## Soubory

- `index.html` — hlavní stránka
- `privacy.html` — zásady ochrany soukromí
- `delete-account.html` — smazání účtu
- `server.js` — Node server pro Movly login, premium kontrolu a chráněný download
- `assets/` — loga a reálné screenshoty aplikace

## Očekávané instalačky

Server čte soubory přes `DOWNLOAD_ROOT`. Pro Windows release musí být tato cesta symlink
do jednoho regulárního adresáře pod sousedním `.movly-download-releases/`; publisher jej
přepíná atomicky. Přímý web upload je zrušený a endpoint vrací explicitní `410`.

Postup pro nahrání nových buildů je v [INSTALLER_UPLOAD.md](INSTALLER_UPLOAD.md).

Očekávané názvy:

- `MovlySetup-x64.exe`
- `MovlySetup-arm64.exe`
- `MovlySetup-x86.exe`
- `Movly-macOS-universal-devsigned.zip`

Pokud některý soubor chybí, web kartu nezamaskuje. Zobrazí přesný chybějící název souboru.

## Lokální spuštění

```bash
cd /Users/shebin/Projekty/Movly/web
mkdir -p downloads-local/.movly-download-releases/dev
ln -s "$PWD/downloads-local/.movly-download-releases/dev" downloads-local/downloads
MOVLY_API_KEY="..." \
DOWNLOAD_TOKEN_SECRET="$(openssl rand -hex 32)" \
DOWNLOAD_ROOT="$PWD/downloads-local/downloads" \
NODE_ENV=development \
node server.js
```

Pak otevři `http://localhost:8080`.

## Produkční LXC

Minimální prostředí:

- Node.js 18+
- reverzní proxy (např. nginx) na port `8080`
- `/srv/movly/downloads` jako symlink do `/srv/movly/.movly-download-releases/<release-id>`

Proměnné:

```bash
MOVLY_WEB_PORT=8080
MOVLY_API_BASE=https://api-go.shebin.eu
MOVLY_API_KEY=...
DOWNLOAD_ROOT=/srv/movly/downloads
DOWNLOAD_TOKEN_SECRET=nahodny-dlouhy-secret
DOWNLOAD_TOKEN_TTL_SECONDS=300
# Přesné socket IP nginxu; v production je neprázdný allowlist povinný:
MOVLY_TRUSTED_PROXY_IPS=127.0.0.1,::1
# Volitelný pouze při koordinované rotaci; musí sedět s UpdateService.PublicKeyBase64:
MOVLY_WINDOWS_UPDATE_PUBLIC_KEY_BASE64=UXLKA+aihjFniVXysbc99gmWNummKaD7koXxfwbZ9RI=
NODE_ENV=production
```

Nginx musí klientskou adresu přepsat do dedikované hlavičky; nepoužívej hodnotu
přijatou od klienta ani appendované `X-Forwarded-For`:

```nginx
proxy_set_header X-Movly-Client-IP $remote_addr;
proxy_pass http://127.0.0.1:8080;
```

Server hlavičku přijme jen ze socket IP uvedené v `MOVLY_TRUSTED_PROXY_IPS`.
Hlavička z jiné adresy, chybějící hlavička důvěryhodné proxy nebo prázdný produkční
allowlist skončí explicitní chybou; IP rate limit se nikdy tiše nesdílí přes proxy.

Flow stažení:

1. Web pošle login na `/api/auth/login`.
2. Server ověří účet přes Movly API.
3. `/api/downloads` vrátí instalačky jen pokud má účet aktivní Premium nebo roli VIP/moderator/admin.
4. Windows download navíc vyžaduje platný Ed25519 manifest, shodu SHA-256 a odkaz
   připnutý ke konkrétnímu verzovanému release; přepnutí symlinku jej nezmění.
5. Klik na stažení vytvoří krátkodobý podepsaný odkaz `/secure-download/...`.
6. Bez platného odkazu soubor nejde stáhnout přímo.

Windows klient používá samostatný flow:

1. Veřejný `GET`/`HEAD /api/updates/windows` vrátí pouze offline podepsaný manifest,
   aby bezpečnostní aktualizace šlo zjistit i před přihlášením.
2. `POST /api/updates/windows/downloads/{id}/link` vyžaduje platný Movly bearer token
   a vydá krátkodobý odkaz na update instalačku; Premium není podmínka.
3. Ruční endpointy `/api/downloads` a `/api/downloads/{id}/link` zůstávají Premium/VIP+.
4. Web ověří Ed25519 podpis i SHA-256 ještě před vydáním release-bound odkazu.
5. Klient vše ověří znovu: Ed25519, SHA-256, Authenticode trust a přesný fingerprint
   vydavatelského certifikátu. Při chybě aktualizaci explicitně odmítne; na jiný endpoint nepřepíná.

Dočasná kompatibilita je explicitní: historický přesně rozpoznaný `legacy-v1` manifest
bez Authenticode metadat je povolen pouze pro ruční Premium stažení. Odpověď odkazu jej
označí jako `legacy-v1-manual-only` a web zobrazí upozornění. Auto-update endpoint jej
vždy odmítne; chybějící `security` se nikdy tiše nevykládá jako `false`.

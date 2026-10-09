# Nahrání nových instalaček na movly.sheri.cz

Web běží na Proxmoxu `192.168.1.138` v LXC `214` (`movly-web-lxc`).

Veřejná URL:

```text
https://movly.sheri.cz
```

Aktivní release je v LXC dostupný tady:

```text
/srv/movly/downloads -> /srv/movly/.movly-download-releases/<release-id>
```

Download server očekává přesné názvy souborů:

```text
MovlySetup-x64.exe
MovlySetup-arm64.exe
MovlySetup-x86.exe
Movly-macOS-universal-devsigned.zip
windows-manifest.json
windows-build-metadata.json
```

Pokud některý soubor chybí nebo má jiný název, web to nezamaskuje. Premium uživatel uvidí, že konkrétní instalačka není nahraná.

`windows-manifest.json` je **podepsaný** manifest pro auto-update Windows appky.
`GET`/`HEAD /api/updates/windows` je veřejný a vrací pouze podepsaná metadata.
`POST /api/updates/windows/downloads/{id}/link` vyžaduje přihlášení, ale záměrně
ne Premium: bezpečnostní aktualizace musí dostat každý přihlášený klient. Ruční
webové download endpointy zůstávají Premium/VIP+. Appka ověří Ed25519 podpis,
zahrnutou velikost instalačky, SHA-256, Windows Authenticode trust a přesný
SHA-256 fingerprint signing certifikátu z podepsaného manifestu.

`windows-build-metadata.json` vzniká ve Windows buildu až po ověření všech tří
Authenticode podpisů. Obsahuje assembly verzi, fingerprint certifikátu a hashe
artefaktů; offline publisher jej porovná s reálnými EXE a bez shody nic nepodepíše.

## Před nahráním: podepiš Windows update manifest

Jednorázově vygeneruj klíč (privátní zůstane offline na Macu, veřejný vlož do `Windows/Movly/Services/UpdateService.cs`):

```bash
node web/scripts/setup-windows-update-key.mjs
```

Po každém novém buildu Windows instalaček (a po bumpu verze) používej kanonický
signer pod `Windows/scripts`. Vyžaduje všechny tři EXE, metadata a cert fingerprint;
verze + build musí sedět s `Windows/Movly/Movly.csproj`:

```bash
MOVLY_AUTHENTICODE_CERT_SHA256='<64 lowercase hex>' \
node Windows/scripts/build-windows-manifest.mjs \
  --version 0.1.2 --build 3 \
  --security false \
  --notes "Co je nového v této verzi" \
  --installers ~/Downloads \
  --from-meta ~/Downloads/windows-build-metadata.json \
  --authenticode-cert-sha256 "$MOVLY_AUTHENTICODE_CERT_SHA256" \
  --out ~/Downloads/windows-manifest.json
```

Skript spočítá SHA-256 každé instalačky, podepíše manifest a zapíše `windows-manifest.json` k instalačkám, takže putuje stejnou cestou jako `.exe` níže.

## Povinné atomické vydání z Macu

Použij publisher, který ověří metadata, sestaví manifest, vytvoří verzovaný staging
v LXC a aktivuje jej jedním přepnutím symlinku pod lockem. Selhání post-deploy kontroly
vyvolá explicitní rollback. Mac musí mít `osslsigncode`; bez jeho nezávislého ověření
Authenticode trustu, timestampu a leaf fingerprintu publisher skončí chybou:

`--metadata` i `--security true|false` jsou povinné; publisher záměrně neodvozuje
metadata ani bezpečnostní klasifikaci z implicitního defaultu.

```bash
MOVLY_AUTHENTICODE_CERT_SHA256='<64 lowercase hex>' \
MOVLY_WINDOWS_HEALTH_BEARER_TOKEN='<platná session běžného uživatele>' \
bash Windows/scripts/publish-windows-release.sh \
  --version 0.1.2 --build 3 \
  --notes "Co je nového" --security false \
  --installers ~/Downloads \
  --metadata ~/Downloads/windows-build-metadata.json
```

`MOVLY_WINDOWS_HEALTH_BEARER_TOKEN` je povinný pro ostrý deploy. Publisher po aktivaci
ověří přihlášený update feed a vytvoření odkazu pro všechny tři architektury; jakákoli
chyba vyvolá rollback na předchozí release. Token se nesmí zapisovat do repozitáře ani
do příkazové historie. Publisher jej předá curlu jen přes dočasný config s oprávněním
`0600` v privátním snapshotu a po health checku jej explicitně odstraní; token není
součástí argv. Explicitně prázdné `MOVLY_WINDOWS_UPDATE_KEY` nebo `MOVLY_SSH_KEY`
jsou chyba — default se použije pouze tehdy, když proměnná vůbec není nastavená.

Ruční kopírování taru nebo jednotlivého EXE do aktivního adresáře je zakázané: obchází
immutable snapshot, podpisové kontroly, atomickou aktivaci i rollback. Pro diagnostiku
použij `--dry-run`; přímý HTTP upload endpoint `/api/upload/...` je záměrně vyřazený a
vrací explicitní `410 Gone`.

## Restart není potřeba

`movly-web.service` čte release přes aktivní symlink, takže po úspěšné atomické aktivaci
není potřeba restartovat server.

Když chceš službu přesto zkontrolovat:

```bash
ssh -p 12211 root@192.168.191.10
pct exec 214 -- systemctl status movly-web --no-pager
```

## Ověření po nahrání

Veřejná stránka musí vrátit `200`:

```bash
curl -I https://movly.sheri.cz/
```

API bez přihlášení musí vrátit `401`. To je správně, protože instalačky nejsou veřejné:

```bash
curl -I https://movly.sheri.cz/api/downloads
```

Windows update manifest musí být dostupný i bez přihlášení a podporovat `HEAD`:

```bash
curl -I https://movly.sheri.cz/api/updates/windows
```

Očekávaný stav je `200`. Samotný download link zůstává autentizovaný.

Logy serveru:

```bash
ssh -p 12211 root@192.168.191.10
pct exec 214 -- journalctl -u movly-web -n 80 --no-pager
```

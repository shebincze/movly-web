# QA — sjednocení designu webu (audit 2026-10-22, issue #223)

Snímky před a po opravě nálezů z `docs/audits/design-consistency-2026-10-22/web.md`
hlavního repozitáře Movly. Všechny jsou z lokálního fixture serveru, ne z produkce.

- **Před:** `before-*.jpg`, revize `b18e176` (`origin/main` před změnou; export přes `git archive`).
- **Po:** `after-*.jpg`, větev `claude/design-consistency-web-66b981`.
- Prostředí: macOS, Node 24.18.0, Chromium z `playwright-core` (headless), fixture
  `test-support/app-fixture.cjs` s účtem `test`.
- Jazyk se přepíná přes `/app/?lang=cs|sk|en`.

## Název souboru

`{před|po}-{jazyk}-{šířka}-{obrazovka}.jpg`

| Šířka | Viewport |
| --- | --- |
| `desktop` | 1280 × 800 |
| `w680` | 680 × 900, přechod kolem breakpointu 600/900 |
| `mobile` | 390 × 844 |
| `tv-*` | TV lite (`/tv/`), 1280 × 720 |

Obrazovky: `02-profiles` výběr profilu, `03-home` Domů, `04-movies` Filmy,
`05-detail` detail filmu, `06-picker` výběr zdroje, `07-account-menu` účet,
`08-settings` Nastavení, `09-inbox` upozornění, `11-history` Historie (zvýrazněné
„Moje seznamy“), `12-feedback` Vylepšit Movly.

`after-cs-*-12-feedback-*-admin.jpg` jsou z fixture s `MOVLY_FIXTURE_FEEDBACK_ADMIN=1`.
Účet bez Premium vidí `*-premium-gate.jpg`. Před opravou se u něj trvale točilo „Načítám…“.

## Co zkontrolovat

- Navigace „Moje seznamy“. Podstránky Historie, Skryté a Offline zvýrazní rodiče.
- Vybrané chipy, pilulky a segmenty jsou na `--gradient-control` s bílým textem.
- Hodnocení „92 %“ a kvalita 4K/HD/HDR.
- Prázdné stavy sdílí jednu komponentu.
- Na mobilu se dialogy otevírají jako spodní panel.
- SK/EN bez českých zbytků z klienta. Názvy řádků Domů dodává server, ve fixture jsou česky.
- TV lite v paletě značky a přeložené.

## Automatické kontroly

```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run check
```
```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm test
```

| Kontrola | Výsledek |
| --- | --- |
| `npm run check` | prošlo |
| `npm test` | 666/666 prošlo |
| `check-translations` na `b18e176` | 25 textů bez klíče, kontrola selže |
| `check-translations` po opravě | prošlo |

## Známá omezení

- Bez skutečné TV (LG / Chrome 34), bez Safari a Firefoxu, bez produkce.
- Resolver providerů ve fixture neběží, takže výběr zdroje ukazuje jen data fixture.

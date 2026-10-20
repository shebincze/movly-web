# Rozlišení obrázků v kartách — 20. 10. 2026

Issue #212, hlavní projekt shebincze/Movly#1341. Základ `d5f471cbe89e312a7f4709c987e17c79da9c768d`.

Běžné karty a pozdě doplněné artworky požadují w342; detail zůstává w500 a hero w1280. Široká pokračovací karta používá backdrop w780, případně poster w500. Moderní web i ES5 TV bezpečně zmenší také absolutní TMDB URL; menší zdroje, SVG, podpisy/query/fragmenty a Cloudinary zůstávají zachované. Povolené hosty se nerozšiřují. TV detail zachovává svůj dosavadní explicitní rozměr.

- Nový `image-size.test.js` selhal před opravou na absolutní URL, po opravě PASS.
- `npm test`: 637 PASS, 0 failures/skips, včetně ES5 TV a existujících home/state testů.
- Headless Chromium desktop 1440×1000 a mobil 390×844 při 2×: fixture login → profil → běžná karta (`naturalWidth=342`) → detail (`src w500`). Bez JS pageerror; skutečné URL požadavků a snímky uložené. Prohlížeč použil skutečné TMDB obrázky a izolovaný lokální server, nikoliv produkční účet.
- Čtyři veřejné postery: součet 360507 B (w500) → 200164 B (w342), úspora 44,5 % tohoto vzorku, nikoliv celého katalogu.

Důkazy a reprodukční skript: `/Users/shebin/.codex/visualizations/2026/10/20/movly-poster-resolution/`, zejména `web-red.log`, `web-full-tests.log`, `web-browser.cjs`, `web-browser.json`, `web-*.png`, `sample-bytes.json`. Browser plugin nebyl dostupný; použit již instalovaný Playwright. Žádné nasazení webu/serveru, žádná změna verze.

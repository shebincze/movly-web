# Design a vizuální ověření — 5. 9. 2026

Koncept: `catalog-concept.png`, vytvořen vestavěným Image Gen před implementací.
Render: `catalog-desktop.png` (1536×1024), `catalog-mobile.png` (390×844), screenshoty z Codex IAB. Koncept i oba rendery byly otevřeny přes view_image a přímo porovnány. Nejde o screenshoty živé produkce; obsah dodalo izolované testovací API.

## Designový systém

Pozadí #0c0d12, povrch #17181f, text #f6f6f8, sekundární text #a9a9b5, akcent #a78bfa, primární tlačítko #9166ed. Systémový sans-serif (Inter, Apple, Segoe UI), desktopový nadpis 56 px, sekční 23 px, ovládání 15 px. Okraj obsahu 104 px na 1536px desktopu / 22 px na mobilu. Řady plakátů, otevřená plocha katalogu, 7–8px zaoblení ovládání a plakátů, nativní dialogy. Pozadí hlavního titulu má černý okrajový přechod, žádný barevný filtr.

Aplikace respektuje stávající Node/HTML/JS web bez nového bundleru. Kód je rozdělen do API, UI komponent, katalogu, knihovny a řízení aplikace. Obsah, obrázky, názvy řad a metadata poskytuje skutečný API kontrakt; render neobsahuje natvrdo vložené produkční filmy.

## Porovnání a opravy

| Oblast | Koncept / render | Výsledek |
| --- | --- | --- |
| Navigace | Movly, Objevovat, Filmy, Seriály, Moje seznamy, hledání, profil | Zachována struktura a fialové podtržení; skutečná značka repozitáře místo generované varianty. |
| Kompozice | Levý titulek a popis, obrázek vpravo, řady níže | Zachováno. Délka názvu i obsah řad jsou datové; připouštějí změnu výšky a pořadí. |
| Typografie | Velký nadpis, klidný sekundární text, kompaktní metadata | Kontrolováno na desktopu i mobilu. Délka sjednocena na hodiny/minuty, české počty skloňovány. |
| Paleta | Tmavé pozadí, světlý text, fialové CTA | Zachováno bez dodatečného barevného tónování obrázků. |
| Obrázky | Generovaný koncept versus skutečné TMDB podklady | Záměrná odchylka: používají se skutečné obrázky vrácené API. Opraveny neplatné cesty v testovacích datech; finální desktop měl všech 15 obrázků načtených. |
| Akce | Detail filmu, Do seznamu | Zachovány; šipka upravena za text. Akce otevírají skutečné dialogy a ukládají přes server. |
| Mobil | Stejná hierarchie, dvouřádková navigace, posuvné plakáty | 390px viewport i šířka dokumentu 390 px. Žádné přetékání stránky. |
| Stavy | Přihlášení, výběr profilu, detail, formulář, prázdný výsledek | Funkční, klávesnicí dostupné, chyby se nezaměňují za prázdná data. |

Kontrola viditelného textu: navigace a CTA souhlasí. Odchylky jsou skutečné filmové podklady, jejich pořadí, profilové iniciály místo generované fotografie a dynamické názvy řad / metadata. Nad hlavním titulkem nejsou přidané dekorativní štítky. Přesná shoda filmového artworku s generovanou ilustrací není cílem; návrh se používá pro kompozici a komponenty. Samostatná souběžná administrace není součástí této vizuální reference.

Opravené funkční detaily: následné otevření výběru seznamu po vytvoření seznamu už nezneplatní opožděná událost zavření dialogu; aplikace a ES moduly používají revalidaci cache. V prohlížeči potvrzeno vytvoření „Sci-fi večer“ z detailu a následné uložení titulu.

## Generační brief

Vestavěný Image Gen; žádný CLI/API fallback. Brief: full primary Czech movie catalog desktop screen 1536×1024, dark #0c0d12, violet #a78bfa, system sans, Movly nav Objevovat / Filmy / Seriály / Moje seznamy, search and profile, featured Duna: Část druhá with metadata 2024 · Sci-fi · 2 h 47 min, synopsis, Detail filmu and Do seznamu, cinematic right backdrop with edge fade, six poster row Populární filmy, next row Seriály, které stojí za pozornost; no playback controls or decorative eyebrow badges; implementable code-native UI; extend the same system to filters, search, detail, watchlists and login.

Produkční integrace zůstává neověřená: živý účet, skutečné role API klíče, profilové granty proti nasazené verzi a HTTPS reverse proxy. Viz ../WEB_APP.md.

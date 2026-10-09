# Movly — projektová pravidla

## Opravy, issues a pull requesty

- Každou opravu nebo nalezený nedostatek eviduj v GitHub issue příslušného repozitáře. Issue musí popsat konkrétní problém, rozsah, očekávaný výsledek a ověření. Již rozepsané opravy doplň zpětně.
- Opravy ukládej do Gitu přes samostatnou větev a pull request. PR propojuj s issue; hotové opravy slouč do `main` a jejich issues řádně uzavři. Neoznačuj neimplementované nebo neověřené požadavky za dokončené. Zbývající platformy, fyzickou akceptaci nebo vydání sleduj v samostatných otevřených issues.
- Před mergem proveď relevantní kontroly lokálně nebo na vlastním autorizovaném CI. Do PR napiš, co skutečně prošlo, a známá omezení. Merge zdrojů neznamená nasazení ani vydání klientů.
- **Nepoužívej GitHub Actions:** nemáme dostupné limity. Nespouštěj ani znovu nezapínej workflow. Commity označ `[skip ci]`; ověř i nastavení Actions, protože samotný tag nemusí pokrýt všechny události.
- Zachovej cizí a souběžné změny. Pracuj s izolovaným checkoutem a explicitním seznamem souborů; nikdy nepoužívej plošné `git add .` nad sdíleným pracovním stromem. Necommituj hesla, tokeny, privátní konfigurace, databázové dumpy, cache, `bin/obj`, `node_modules` nebo buildové artefakty.
- `web/` je samostatný Git repozitář. Jeho PR a `main` musí být řešené samostatně. Při chybějících oprávněních připrav konkrétní commit/PR a jasně uveď blokující repozitář.

Pravidlo zadané uživatelem 9. 10. 2026. Platí pro další práci v tomto projektu.

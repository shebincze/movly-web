# Movly — projektová pravidla

## Opravy, issues a pull requesty

- Každou opravu nebo nalezený nedostatek eviduj v GitHub issue příslušného repozitáře. Issue musí popsat konkrétní problém, rozsah, očekávaný výsledek a ověření. Již rozepsané opravy doplň zpětně.
- Opravy ukládej do Gitu přes samostatnou větev a pull request. PR propojuj s issue; hotové opravy slouč do `main` a jejich issues řádně uzavři. Neoznačuj neimplementované nebo neověřené požadavky za dokončené. Zbývající platformy a fyzickou akceptaci sleduj v samostatných otevřených issues; samotné vydání se řídí pravidlem níže.
- Před mergem proveď relevantní kontroly lokálně nebo na vlastním autorizovaném CI. Do PR napiš, co skutečně prošlo, a známá omezení. Merge zdrojů neznamená nasazení ani vydání klientů.
- **Nepoužívej GitHub Actions:** nemáme dostupné limity. Nespouštěj ani znovu nezapínej workflow. Commity označ `[skip ci]`; ověř i nastavení Actions, protože samotný tag nemusí pokrýt všechny události.
- Zachovej cizí a souběžné změny. Pracuj s izolovaným checkoutem a explicitním seznamem souborů; nikdy nepoužívej plošné `git add .` nad sdíleným pracovním stromem. Necommituj hesla, tokeny, privátní konfigurace, databázové dumpy, cache, `bin/obj`, `node_modules` nebo buildové artefakty.
- `web/` je samostatný Git repozitář. Jeho PR a `main` musí být řešené samostatně. Při chybějících oprávněních připrav konkrétní commit/PR a jasně uveď blokující repozitář.

Pravidlo zadané uživatelem 9. 10. 2026. Platí pro další práci v tomto projektu.

## Vydání — rozhoduje výhradně uživatel

- Nezakládej GitHub issues o vydání, publikaci nebo distribuci klientů. Toto pravidlo platí pro hlavní repozitář i samostatný `web/` repozitář.
- O vydání rozhoduje vždy a pouze uživatel. Bez jeho výslovného pokynu nic nevydávej ani nepublikuj; uzavření issues, merge do `main` ani úspěšné ověření nejsou souhlas s vydáním.
- Uživatel si vydání provede sám po uzavření všech issues. Samotné čekání na vydání není důvod držet implementovanou a ověřenou opravu otevřenou. Skutečně neimplementované nebo neověřené funkční požadavky zůstávají otevřené.

Pravidlo zadané uživatelem 11. 10. 2026. Nahrazuje dřívější požadavek evidovat vydání v samostatných issues.


## Lokální worktree a dočasné buildy — povinný úklid

- Worktree je dočasný pracovní prostor. Nejprve zkontroluj `git worktree list` hlavního i `web/` repozitáře a používej existující vhodný prostor místo další kopie. Izolaci a cizí změny zachovej.
- Po dokončení ověření a mergi PR odstraň svůj neaktivní worktree v témže úkolu. Před odstraněním zkontroluj čerstvý stav Gitu, ignorované soubory, otevřené soubory (`lsof`) a argumenty běžících procesů (`ps`); čistý Git stav sám nestačí. Aktivní práci jiného chatu neodstraňuj ani nepřesouvej.
- U worktree spravovaných Codexem použij `archive_worktree`, pokud je dostupný pro dané připojení; archiv uchová obnovitelný Git snapshot. Při ručním úklidu ponech větev nebo vytvoř recovery ref pro detached HEAD a zachovej nesloučené změny, netrackované zdroje, privátní konfiguraci a důkazy mimo rušený checkout. Ověř obsah zálohy před `git worktree remove`. Žádný plošný `rm -rf` nad worktree rootem. Nesloučenou či neověřenou opravu nikdy nemerguj jen kvůli úklidu.
- Při lokálním buildu zaznamenej přesnou cestu výstupu. Po ověření odstraň vlastní regenerovatelné buildy a cache (`DerivedData` build/index/module/package cache, Gradle build, .NET bin/obj), včetně výstupů v `/private/tmp`. Důkazy testů, logy, podepsané release archivy, provisioning a instalované aplikace zachovej; jejich uchování nevyžaduje uchovat celý build.
- Dočasné buildy nesmí zůstávat po dokončení úkolu. Je-li práce přerušená, před dalším buildem projdi její dosavadní výstupy a odstraň neaktivní regenerovatelné kopie starší než 24 hodin. Při neúspěšném `lsof`/`ps`, nejasném vlastnictví nebo neznámém obsahu nic automaticky nemaž. V `/private/tmp` pracuj pouze s konkrétními ověřenými cestami Movly, nikdy s celým adresářem nebo samotným globem.
- V závěru úkolu uveď, že vlastní worktree a buildy byly uklizeny, nebo přesnou ponechanou cestu a důvod. Ponechání aktivní práce je výjimka pouze do jejího dokončení; po dokončení se úklid provede ve stejném úkolu.

Pravidlo úklidu zadané uživatelem 11. 10. 2026.

## Postup pro všechny změny a testování

- Platí pro celý projekt: všechny aplikace, web, API, backendové služby, workery, databázi, infrastrukturu, konfiguraci, testy i dokumentaci. API a celý backend v komunikaci s uživateli nazývej **server**; technické názvy komponent lze uvést v issue a PR pro přesné vymezení rozsahu.
- Každá změna musí mít GitHub issue v příslušném repozitáři, samostatnou větev, commit a propojený PR. Před založením hledej existující issue; stejné zadání zbytečně neduplikuj. Související změny mohou sdílet issue a PR. Výjimkou zůstává zákaz zakládat issues o samotném vydání, publikaci a distribuci.
- Issue popisuje problém nebo cíl, dotčené platformy a komponenty, očekávaný výsledek, akceptační kritéria a plán ověření. Použij [šablonu změny](.github/ISSUE_TEMPLATE/change.md).
- Ke každé změně naplánuj a proveď ověření, které může odhalit regresi. Při změně chování přidej nebo uprav automatické testy. U opravy přidej regresní test reprodukující původní chybu a pokud lze, ověř jeho selhání před opravou a úspěch po ní. Test musí ověřovat výsledek chování, ne pouze kopírovat implementaci.
- Podle dopadu použij jednotkové, integrační, API/kontraktní a UI/E2E testy. U změny serveru prověř dotčené klientské kontrakty; u databáze migraci a integritu dat; u UI skutečný průchod a relevantní velikosti obrazovek či ovládání. Sdílenou změnu ověř na všech dotčených platformách. Samotný build není funkční test.
- U dokumentace a změn bez běhového chování proveď odpovídající kontrolu obsahu, odkazů, syntaxe či konfigurace; automatický test aplikace nevytvářej jen formálně. Pokud potřebný test nelze spustit nebo automatizovat, zapiš konkrétní důvod, náhradní ruční ověření a zbývající mezeru do issue a PR. Neověřený funkční požadavek nesmí být označen jako dokončený.
- Před mergem spusť relevantní existující testy a nové testy lokálně nebo na vlastním autorizovaném CI. Do [PR šablony](.github/pull_request_template.md) vyplň příkazy, skutečné výsledky, revizi/prostředí a omezení; rozlišuj automatické testy, ruční kontrolu, simulátor, fyzické zařízení a produkci. GitHub Actions zůstávají zakázané.
- Commit i merge/squash commit musí obsahovat `[skip ci]`. Do PR patří odkaz na issue a uzavírací klauzule jen pro skutečně dokončený rozsah. Po kontrolách slouč do `main`, ověř merge a uzavření hotového issue. Zbývající funkční rozsah přenes s konkrétními kritérii do propojeného otevřeného issue.

## Podklady pro oznámení novinek

- Při každém uživatelem schváleném vydání aplikace i nasazení serveru připrav uživateli hotový český text ke zkopírování na Discord podle [šablon oznámení](docs/DISCORD_ANNOUNCEMENTS.md). Na Discord jej sám neposílej bez výslovného pokynu.
- Před vydáním lze připravit pouze jasně označený návrh. Text „vydáno“ nebo „nasazeno“ použij až po ověření skutečné dostupnosti konkrétní verze na uvedené platformě či prostředí. Merge do `main`, uzavřené issue ani úspěšné testy samy nestačí.
- Rozsah odvoď ze změn mezi předchozí a aktuální skutečně vydanou verzí, propojených PR/issues a důkazů o vydání. Uveď jen změny obsažené v daném vydání, jejich přínos, opravy, případný nutný krok a známá omezení. Nevymýšlej novinky, čísla verzí ani dostupnost na dalších platformách.
- Aplikace oznamuj s platformou a verzí/buildem. API a backend oznamuj jako **Movly server** s datem a identifikací nasazení; připiš kompatibilitu a nutnou aktualizaci aplikace, jen když je doložená. Při vydání více aplikací jejich verze a dostupnost rozliš.

Pravidla rozšířená uživatelem 19. 10. 2026. Povinnost ověření platí pro každou změnu; rozhodnutí o vydání zůstává výhradně na uživateli.

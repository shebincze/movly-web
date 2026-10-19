# Oznámení novinek na Discord

Při uživatelem schváleném vydání připrav vyplněný text ke zkopírování. API, workery a celý backend se v oznámeních jmenují **server**. Tyto šablony samy nejsou oznámením vydání ani souhlasem s publikací.

Piš krátce, česky a srozumitelně: co je nového, co se opravilo a co to znamená pro uživatele. Změny seskup podle uživatelského přínosu, nepřepisuj jen názvy commitů. Prázdné sekce a nepoužité zástupné údaje odstraň. Neuváděj tokeny, interní adresy ani podrobnosti využitelné ke zneužití bezpečnostních chyb.

## Aplikace

```text
📱 Movly — {platforma} {verze} ({build})

✨ Co je nového
• {Novinka a co uživateli umožní.}

🔧 Co jsme opravili
• {Opravený problém a jak se teď aplikace chová.}

📥 Dostupnost
{Ověřená dostupnost: platforma, distribuční kanál a případně odkaz.}

ℹ️ Co potřebujete vědět
• {Nutný krok, požadavky nebo známé omezení — jen pokud existuje.}
```

U více platforem uveď konkrétní verzi/build a dostupnost každé zvlášť. Změnu z jiné platformy nezahrnuj automaticky. Při postupném schvalování napiš, kde už verze je dostupná a kde ještě čeká.

## Server

```text
🖥️ Movly server — aktualizace {datum}
Verze nasazení: {verze / krátký commit nebo jiný identifikátor}

✨ Co je nového
• {Nová možnost serveru a přínos pro uživatele.}

🔧 Co jsme opravili
• {Oprava a její pozorovatelný dopad.}

✅ Dostupnost
{Kde a od kdy je aktualizace ověřeně nasazená.}

ℹ️ Dopad na aplikace
{Zda je nutná aktualizace aplikace nebo jiný krok; pouze doložené informace.}
{Případné známé omezení.}
```

## Příprava a ověření textu

1. Urči předchozí a aktuální vydanou verzi pro každou dotčenou aplikaci nebo server. Zaznamenej revize a skutečný distribuční kanál/prostředí.
2. Projdi rozdíl verzí a související issues/PR. Zahrň pouze obsažené a ověřené změny; plánované nebo pouze mergnuté změny vynech.
3. Ověř dostupnost a případné nároky na kompatibilitu. Pokud dostupnost ještě není potvrzená, označ celý text **NÁVRH — dosud nevydáno/nenasazeno** a věty o dostupnosti nech jako nepotvrzené.
4. Připrav vyplněný text pro uživatele. Připoj mimo text oznámení stručný podklad: odkazy na PR/issues, výchozí/cílovou revizi a důkaz dostupnosti. Oznámení na Discord sám neodesílej bez výslovného pokynu.

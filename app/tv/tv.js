/* Movly TV lite — omezená verze webové aplikace pro staré prohlížeče chytrých TV
   (např. LG NetCast, jádro Chrome 34). Záměrně ES5 bez modulů, bez fetch,
   bez inline stylů/skriptů (CSP). Ovládá se dálkovým ovladačem: šipky přesouvají
   fokus podle polohy prvků, OK (Enter) potvrzuje, Zpět (461/Backspace/Esc) vrací.
   Používá výhradně existující cesty BFF /api/app/. */
(function () {
  "use strict";
  // Texty TV lite podle jazyka rozhraní (movly.uiLanguage, stejně jako plná aplikace).
  // Klíč je český text, hodnota [slovensky, anglicky]; chybějící klíč zůstane česky.
  var TEXT = {
    " (kódy oddělené čárkou)": [" (kódy oddelené čiarkou)", " (comma-separated codes)"],
    " titulů": [" titulov", " titles"],
    " vybraných": [" vybraných", " selected"],
    " výsledků": [" výsledkov", " results"],
    "). Zkus jiný zdroj.": ["). Skús iný zdroj.", "). Try another source."],
    ": hledám…": [": hľadám…", ": searching…"],
    "API vrátilo neplatný titul.": ["API vrátilo neplatný titul.", "The API returned an invalid title."],
    "Ano": ["Áno", "Yes"],
    "Audio": ["Zvuk", "Audio"],
    "Byl(a) jsi odhlášen(a).": ["Bol(a) si odhlásený(á).", "You have been signed out."],
    "Chráněno PINem": ["Chránené PINom", "Protected by PIN"],
    "Další": ["Ďalšie", "Next"],
    "Další poskytovatelé a doplňky": ["Ďalší poskytovatelia a doplnky", "Other providers and add-ons"],
    "Další stránka": ["Ďalšia stránka", "Next page"],
    "Další výsledky": ["Ďalšie výsledky", "More results"],
    "Databáze": ["Databáza", "Database"],
    "Databáze AI": ["Databáza AI", "AI database"],
    "Dolní mez nesmí být vyšší než horní.": ["Dolná hranica nesmie byť vyššia ako horná.", "The lower bound must not exceed the upper bound."],
    "Domů zatím nemá žádné řady.": ["Domov zatiaľ nemá žiadne rady.", "Home has no rows yet."],
    "Dostupné zdroje": ["Dostupné zdroje", "Available sources"],
    "Délka": ["Dĺžka", "Duration"],
    "Délka do (min)": ["Dĺžka do (min)", "Duration to (min)"],
    "Délka od (min)": ["Dĺžka od (min)", "Duration from (min)"],
    "Film": ["Film", "Movie"],
    "Filmy": ["Filmy", "Movies"],
    "Filtr byl smazán.": ["Filter bol zmazaný.", "Filter deleted."],
    "Filtr byl uložen.": ["Filter bol uložený.", "Filter saved."],
    "Filtry a uložené filtry": ["Filtre a uložené filtre", "Filters and saved filters"],
    "Filtry hledání": ["Filtre hľadania", "Search filters"],
    "Hellspy · živé hledání": ["Hellspy · živé hľadanie", "Hellspy · live search"],
    "Heslo": ["Heslo", "Password"],
    "Hledat": ["Hľadať", "Search"],
    "Hledat název nebo výraz": ["Hľadať názov alebo výraz", "Search a title or phrase"],
    "Hledám nejlepší zdroj…": ["Hľadám najlepší zdroj…", "Finding the best source…"],
    "Hledám zdroje…": ["Hľadám zdroje…", "Searching sources…"],
    "Hledám…": ["Hľadám…", "Searching…"],
    "Hodnocení": ["Hodnotenie", "Rating"],
    "Hodnocení do": ["Hodnotenie do", "Rating to"],
    "Hodnocení do (0–10)": ["Hodnotenie do (0–10)", "Rating to (0–10)"],
    "Hodnocení od": ["Hodnotenie od", "Rating from"],
    "Hodnocení od (0–10)": ["Hodnotenie od (0–10)", "Rating from (0–10)"],
    "Jen dostupné": ["Len dostupné", "Available only"],
    "Kdo se dívá?": ["Kto sa pozerá?", "Who's watching?"],
    "Kolekce je prázdná.": ["Kolekcia je prázdna.", "The collection is empty."],
    "Konec videa. Stiskni Zpět.": ["Koniec videa. Stlač Späť.", "End of video. Press Back."],
    "Kvalita": ["Kvalita", "Quality"],
    "Libovolná": ["Ľubovoľná", "Any"],
    "Libovolné": ["Ľubovoľné", "Any"],
    "Libovolný": ["Ľubovoľný", "Any"],
    "Na této stránce zatím nejsou žádné řady.": ["Na tejto stránke zatiaľ nie sú žiadne rady.", "This page has no rows yet."],
    "Nabídka jazyků: zkusit znovu": ["Ponuka jazykov: skúsiť znova", "Languages: try again"],
    "Nalezeno zdrojů: ": ["Nájdené zdroje: ", "Sources found: "],
    "Napiš název a potvrď Hledat.": ["Napíš názov a potvrď Hľadať.", "Type a title and confirm Search."],
    "Napiš název nebo nastav filtry.": ["Napíš názov alebo nastav filtre.", "Type a title or set filters."],
    "Načítám Domů…": ["Načítavam Domov…", "Loading Home…"],
    "Načítám detail…": ["Načítavam detail…", "Loading details…"],
    "Načítám profily…": ["Načítavam profily…", "Loading profiles…"],
    "Načítám přehrávač…": ["Načítavam prehrávač…", "Loading player…"],
    "Načítám video…": ["Načítavam video…", "Loading video…"],
    "Načítám…": ["Načítavam…", "Loading…"],
    "Nedostupné": ["Nedostupné", "Unavailable"],
    "Nejdřív vyber uložený filtr.": ["Najprv vyber uložený filter.", "Select a saved filter first."],
    "Nejčastěji vybírané tituly": ["Najčastejšie vyberané tituly", "Most picked titles"],
    "Nepodařilo se spojit se serverem Movly. Zkontroluj připojení a zkus to znovu.": ["Nepodarilo sa spojiť so serverom Movly. Skontroluj pripojenie a skús to znova.", "Couldn't connect to the Movly server. Check your connection and try again."],
    "Nesprávný PIN. Zkus to znovu.": ["Nesprávny PIN. Skús to znova.", "Wrong PIN. Try again."],
    "Nic jsme nenašli.": ["Nič sme nenašli.", "Nothing found."],
    "Návrhy hledání": ["Návrhy hľadania", "Search suggestions"],
    "Název": ["Názov", "Title"],
    "Název filmu, seriálu nebo popis": ["Názov filmu, seriálu alebo popis", "Movie or series title, or a description"],
    "Název uloženého filtru": ["Názov uloženého filtra", "Saved filter name"],
    "Některé zdroje výsledků nejsou dostupné. Výsledky mohou být neúplné.": ["Niektoré zdroje výsledkov nie sú dostupné. Výsledky môžu byť neúplné.", "Some result sources are unavailable. Results may be incomplete."],
    "OK přehrát/pozastavit · ◀ ▶ posun o 10 s · Zpět ukončit": ["OK prehrať/pozastaviť · ◀ ▶ posun o 10 s · Späť ukončiť", "OK play/pause · ◀ ▶ skip 10 s · Back to exit"],
    "Obnovit pravidla a návrhy": ["Obnoviť pravidlá a návrhy", "Refresh rules and suggestions"],
    "Odhlásit se": ["Odhlásiť sa", "Sign out"],
    "Otevírám profil ": ["Otváram profil ", "Opening profile "],
    "Ověřuji PIN…": ["Overujem PIN…", "Checking PIN…"],
    "PIN musí mít 4 až 8 číslic.": ["PIN musí mať 4 až 8 číslic.", "The PIN must have 4 to 8 digits."],
    "Pojmenuj filtr (nejvýše 60 znaků).": ["Pomenuj filter (najviac 60 znakov).", "Name the filter (up to 60 characters)."],
    "Popularita": ["Popularita", "Popularity"],
    "Populární hledání": ["Populárne hľadania", "Popular searches"],
    "Populární hledání: zkusit znovu": ["Populárne hľadania: skúsiť znova", "Popular searches: try again"],
    "Populární tituly: zkusit znovu": ["Populárne tituly: skúsiť znova", "Popular titles: try again"],
    "Poskytovatel nedovoluje přehrát tento stream v prohlížeči televizoru. Zkus jiný zdroj nebo aplikaci Movly.": ["Poskytovateľ nedovoľuje prehrať tento stream v prehliadači televízora. Skús iný zdroj alebo aplikáciu Movly.", "The provider doesn't allow this stream in the TV browser. Try another source or the Movly app."],
    "Poslední hledání": ["Posledné hľadania", "Recent searches"],
    "Posunout doleva": ["Posunúť doľava", "Scroll left"],
    "Posunout doprava": ["Posunúť doprava", "Scroll right"],
    "Potvrď Hledat nebo vyber návrh.": ["Potvrď Hľadať alebo vyber návrh.", "Confirm Search or pick a suggestion."],
    "Potvrď Hledat pro obnovení výsledků.": ["Potvrď Hľadať na obnovenie výsledkov.", "Confirm Search to refresh the results."],
    "Použij platné kódy jazyků a zemí.": ["Použi platné kódy jazykov a krajín.", "Use valid language and country codes."],
    "Použité filtry: ": ["Použité filtre: ", "Applied filters: "],
    "Použít filtry": ["Použiť filtre", "Apply filters"],
    "Pozastavit": ["Pozastaviť", "Pause"],
    "Pozice se neuložila: ": ["Pozícia sa neuložila: ", "Position not saved: "],
    "Počet hodnocení": ["Počet hodnotení", "Number of ratings"],
    "Požadavek selhal (": ["Požiadavka zlyhala (", "Request failed ("],
    "Pravidla profilu nejsou ověřena.": ["Pravidlá profilu nie sú overené.", "Profile rules are not verified."],
    "Pravidla profilu se změnila. Načti stránku znovu.": ["Pravidlá profilu sa zmenili. Načítaj stránku znova.", "Profile rules changed. Reload the page."],
    "Premiéra ": ["Premiéra ", "Premiere "],
    "Předchozí": ["Predchádzajúce", "Previous"],
    "Předchozí stránka": ["Predchádzajúca stránka", "Previous page"],
    "Přehrát": ["Prehrať", "Play"],
    "Přehrát doporučený zdroj": ["Prehrať odporúčaný zdroj", "Play recommended source"],
    "Přehrávání selhalo": ["Prehrávanie zlyhalo", "Playback failed"],
    "Přesná shoda názvu": ["Presná zhoda názvu", "Exact title match"],
    "Přihlas se svým účtem Movly. Text zadáš klávesnicí televizoru po stisku OK.": ["Prihlás sa svojím účtom Movly. Text zadáš klávesnicou televízora po stlačení OK.", "Sign in with your Movly account. Press OK to type with the TV keyboard."],
    "Přihlašuji…": ["Prihlasujem…", "Signing in…"],
    "Přihlásit se": ["Prihlásiť sa", "Sign in"],
    "Přihlášení se nepodařilo: ": ["Prihlásenie sa nepodarilo: ", "Sign-in failed: "],
    "Přihlášení se nepodařilo: nesprávné uživatelské jméno nebo heslo.": ["Prihlásenie sa nepodarilo: nesprávne používateľské meno alebo heslo.", "Sign-in failed: wrong username or password."],
    "Přihlášení vypršelo. Přihlas se znovu.": ["Prihlásenie vypršalo. Prihlás sa znova.", "Your session expired. Sign in again."],
    "Připravuji video…": ["Pripravujem video…", "Preparing video…"],
    "Připravuji video… ": ["Pripravujem video… ", "Preparing video… "],
    "Původní jazyk": ["Pôvodný jazyk", "Original language"],
    "Rok": ["Rok", "Year"],
    "Rok do": ["Rok do", "Year to"],
    "Rok od": ["Rok od", "Year from"],
    "Rozkoukáno ": ["Rozpozerané ", "In progress "],
    "Rozpoznané filtry: ": ["Rozpoznané filtre: ", "Detected filters: "],
    "Rozpoznat filtry z textu": ["Rozpoznať filtre z textu", "Detect filters from text"],
    "Seriál": ["Seriál", "Series"],
    "Seriál zatím nemá žádné epizody.": ["Seriál zatiaľ nemá žiadne epizódy.", "The series has no episodes yet."],
    "Seriály": ["Seriály", "Series"],
    "Server vrátil neplatný zdroj přehrávání.": ["Server vrátil neplatný zdroj prehrávania.", "The server returned an invalid playback source."],
    "Server vrátil nečitelnou odpověď.": ["Server vrátil nečitateľnú odpoveď.", "The server returned an unreadable response."],
    "Sestupně": ["Zostupne", "Descending"],
    "Shoda žánrů": ["Zhoda žánrov", "Genre match"],
    "Směr": ["Smer", "Order"],
    "Stiskni OK pro přehrání.": ["Stlač OK na prehratie.", "Press OK to play."],
    "TV lite: omezená verze pro starší televizory.": ["TV lite: obmedzená verzia pre staršie televízory.", "TV lite: a limited version for older TVs."],
    "Televizor nedokáže toto video dekódovat. Zkus jiný zdroj.": ["Televízor nedokáže toto video dekódovať. Skús iný zdroj.", "The TV can't decode this video. Try another source."],
    "Televizor nemůže video přehrát (kód ": ["Televízor nemôže video prehrať (kód ", "The TV can't play the video (code "],
    "Televizor tento zdroj neotevřel. Zkus jiný zdroj, nebo ho otevři v aplikaci Movly.": ["Televízor tento zdroj neotvoril. Skús iný zdroj alebo ho otvor v aplikácii Movly.", "The TV didn't open this source. Try another source or open it in the Movly app."],
    "Tento televizor neumí přehrát video ve formátu HLS (chybí nativní HLS i Media Source Extensions).": ["Tento televízor nevie prehrať video vo formáte HLS (chýba natívne HLS aj Media Source Extensions).", "This TV can't play HLS video (no native HLS or Media Source Extensions)."],
    "Tento televizor neumí přehrát video ve formátu HLS (hls.js zde není podporováno).": ["Tento televízor nevie prehrať video vo formáte HLS (hls.js tu nie je podporované).", "This TV can't play HLS video (hls.js is not supported here)."],
    "Tento zdroj nejde na televizoru přehrát přímo. Otevři ho v aplikaci Movly, nebo zkus jiný zdroj.": ["Tento zdroj sa nedá na televízore prehrať priamo. Otvor ho v aplikácii Movly alebo skús iný zdroj.", "This source can't play directly on the TV. Open it in the Movly app or try another source."],
    "Titulky": ["Titulky", "Subtitles"],
    "Typ": ["Typ", "Type"],
    "Uložené filtry": ["Uložené filtre", "Saved filters"],
    "Uložené filtry: zkusit znovu": ["Uložené filtre: skúsiť znova", "Saved filters: try again"],
    "Uložit jako nový filtr": ["Uložiť ako nový filter", "Save as new filter"],
    "Upravit vybraný filtr": ["Upraviť vybraný filter", "Edit selected filter"],
    "Uživatelské jméno": ["Používateľské meno", "Username"],
    "Zhlédnuto": ["Pozreté", "Watched"],
    "Vyber nejvýše 30 hodnot v jednom poli.": ["Vyber najviac 30 hodnôt v jednom poli.", "Choose at most 30 values per field."],
    "Vyber profil znovu.": ["Vyber profil znova.", "Choose the profile again."],
    "Vyber řadu a epizodu níže.": ["Vyber sériu a epizódu nižšie.", "Choose a season and episode below."],
    "Vybraný filtr: ": ["Vybraný filter: ", "Selected filter: "],
    "Vybrat jiný zdroj": ["Vybrať iný zdroj", "Choose another source"],
    "Vybrat zdroj": ["Vybrať zdroj", "Choose source"],
    "Vymazat historii": ["Vymazať históriu", "Clear history"],
    "Vyplň uživatelské jméno a heslo.": ["Vyplň používateľské meno a heslo.", "Enter your username and password."],
    "Vyčistit formulář": ["Vyčistiť formulár", "Clear form"],
    "Vyžaduje připojení účtu v plné aplikaci": ["Vyžaduje pripojenie účtu v plnej aplikácii", "Requires connecting the account in the full app"],
    "Vzestupně": ["Vzostupne", "Ascending"],
    "Výsledky": ["Výsledky", "Results"],
    "Vše": ["Všetko", "All"],
    "Všechny": ["Všetky", "All"],
    "Webshare · živé hledání": ["Webshare · živé hľadanie", "Webshare · live search"],
    "Zadej PIN profilu. Můžeš použít číselná tlačítka ovladače.": ["Zadaj PIN profilu. Môžeš použiť číselné tlačidlá ovládača.", "Enter the profile PIN. You can use the number buttons on the remote."],
    "Zatím nemáš žádné uložené filtry.": ["Zatiaľ nemáš žiadne uložené filtre.", "You have no saved filters yet."],
    "Zatím tu žádná hledání nejsou.": ["Zatiaľ tu nie sú žiadne hľadania.", "No searches yet."],
    "Zdroj se nepodařilo připravit: ": ["Zdroj sa nepodarilo pripraviť: ", "Couldn't prepare the source: "],
    "Země": ["Krajina", "Country"],
    "Zjišťuji, kde jsi skončil(a)…": ["Zisťujem, kde si skončil(a)…", "Finding where you left off…"],
    "Zkontroluj číselné rozsahy filtru.": ["Skontroluj číselné rozsahy filtra.", "Check the filter number ranges."],
    "Zkusit návrhy znovu": ["Skúsiť návrhy znova", "Retry suggestions"],
    "Zkusit znovu": ["Skúsiť znova", "Try again"],
    "Změnit profil": ["Zmeniť profil", "Switch profile"],
    "Zobrazit vše — ": ["Zobraziť všetko — ", "Show all — "],
    "Zpět": ["Späť", "Back"],
    "Zrušit filtry": ["Zrušiť filtre", "Clear filters"],
    "\u25C0 Zpět": ["\u25C0 Späť", "\u25C0 Back"],
    "Účet nemá žádný profil. Vytvoř ho v plné aplikaci Movly.": ["Účet nemá žiadny profil. Vytvor ho v plnej aplikácii Movly.", "The account has no profile. Create one in the full Movly app."],
    "účet není připojený": ["účet nie je pripojený", "account not connected"],
    "Řada ": ["Séria ", "Season "],
    "Řada nemá žádné epizody.": ["Séria nemá žiadne epizódy.", "The season has no episodes."],
    "Řady a epizody": ["Série a epizódy", "Seasons and episodes"],
    "Řazení": ["Radenie", "Sort"],
    "Žádné tituly.": ["Žiadne tituly.", "No titles."],
    "Žádné zdroje nebyly nalezeny. Webshare a další účty připoj v plné aplikaci Movly.": ["Nenašli sa žiadne zdroje. Webshare a ďalšie účty pripoj v plnej aplikácii Movly.", "No sources found. Connect Webshare and other accounts in the full Movly app."],
    "Žánr musí mít platný číselný kód.": ["Žáner musí mať platný číselný kód.", "A genre must have a valid numeric code."],
    "Žánry": ["Žánre", "Genres"],
    "Žánry: zkusit znovu": ["Žánre: skúsiť znova", "Genres: try again"]
  };
  function t(cs) {
    var lang = homeLanguage(), entry = TEXT.hasOwnProperty(cs) ? TEXT[cs] : null;
    return entry && lang !== "cs" ? entry[lang === "sk" ? 0 : 1] : cs;
  }
  if (window.__movlyStarted || window.__movlyTvStarted) return;

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 461, BACKSPACE: 8, ESC: 27,
    PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, STOP: 413, REWIND: 412, FORWARD: 417 };
  var NETWORK_ERROR = t("Nepodařilo se spojit se serverem Movly. Zkontroluj připojení a zkus to znovu.");
  var SESSION_CODES = ["app_session_required", "session_revoked", "account_inactive", "invalid_or_expired_session"];
  var PROFILE_CODES = ["app_profile_required", "profile_grant_required", "profile_access_denied", "profile_grant_expired", "invalid_profile_grant"];
  var HLS_SCRIPT = "/app/vendor/hls-0.14.17.light.min.js";

  // ---------- pomocné funkce ----------
  function arrayList(value) { return Object.prototype.toString.call(value) === "[object Array]" ? value : []; }
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function filter(list, fn) { var out = []; each(list, function (x, i) { if (fn(x, i)) out.push(x); }); return out; }
  function map(list, fn) { var out = []; each(list, function (x, i) { out.push(fn(x, i)); }); return out; }
  function contains(list, value) { for (var i = 0; i < list.length; i++) if (list[i] === value) return true; return false; }
  function isId(value) { return typeof value === "number" && value > 0 && Math.floor(value) === value; }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return (h ? h + ":" : "") + pad(m) + ":" + pad(s);
  }
  function query(params) {
    var parts = [];
    for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k) && params[k] !== undefined && params[k] !== null)
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])));
    return parts.length ? "?" + parts.join("&") : "";
  }
  function h(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k) || attrs[k] === undefined || attrs[k] === null || attrs[k] === false) continue;
      if (k === "className") n.className = attrs[k];
      else if (k === "text") n.appendChild(document.createTextNode(String(attrs[k])));
      else if (k === "onclick") n.onclick = attrs[k];
      else n.setAttribute(k, attrs[k] === true ? "" : String(attrs[k]));
    }
    if (children) each(children, function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  // Wordmark se značkou M (stejný soubor jako plná aplikace).
  function brand(tag, className) {
    return h(tag, { className: className }, [h("img", { className: "tv-mark", src: "/assets/movly-mark.svg", alt: "" }), "Movly"]);
  }
  function button(label, onclick, className) {
    return h("button", { type: "button", className: "tv-f tv-button" + (className ? " " + className : ""), onclick: onclick, text: label });
  }
  // Vodorovná řada s tlačítky ◀ ▶: prohlížeč LG NetCast mění šipky ovladače na kurzor,
  // takže řady musí jít posouvat i kliknutím.
  function scroller(track) {
    function by(dir) {
      return function () {
        var step = Math.max(200, Math.floor(track.clientWidth * 0.8));
        track.scrollLeft = Math.max(0, track.scrollLeft + dir * step);
        sync();
      };
    }
    var prev = h("button", { type: "button", className: "tv-scroll-nav tv-scroll-prev", "aria-label": t("Posunout doleva"), onclick: by(-1), text: "\u25C0" });
    var next = h("button", { type: "button", className: "tv-scroll-nav tv-scroll-next", "aria-label": t("Posunout doprava"), onclick: by(1), text: "\u25B6" });
    function sync() {
      prev.hidden = track.scrollLeft <= 0;
      next.hidden = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
    }
    setTimeout(sync, 0);
    setTimeout(sync, 1500);
    return h("div", { className: "tv-scroller" }, [prev, track, next]);
  }
  // Obrázky jen z důvěryhodných zdrojů (stejně jako api.js imageURL).
  function imageURL(value, size) {
    if (typeof value !== "string" || !value) return null;
    if (/^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(value)) return "https://image.tmdb.org/t/p/" + (size || "w342") + value;
    if (/^https:\/\/image\.tmdb\.org\/[^\s"'<>]+$/.test(value)) {
      var match = value.match(/^https:\/\/image\.tmdb\.org\/t\/p\/(original|w(\d+))\/([a-zA-Z0-9_-]+\.(?:jpg|png|webp))$/);
      var requested = /^w\d+$/.test(size || "") ? Number(size.slice(1)) : 0;
      if (match && requested > 0 && (match[1] === "original" || Number(match[2]) > requested)) {
        return "https://image.tmdb.org/t/p/" + size + "/" + match[3];
      }
      return value;
    }
    if (/^https:\/\/res\.cloudinary\.com\/dsnzqq6kh\/[^\s"'<>]+$/.test(value)) return value;
    return null;
  }
  var DIACRITICS = { "á": "a", "č": "c", "ď": "d", "é": "e", "ě": "e", "í": "i", "ň": "n", "ó": "o", "ř": "r", "š": "s", "ť": "t", "ú": "u", "ů": "u", "ý": "y", "ž": "z", "ä": "a", "ö": "o", "ü": "u", "ľ": "l", "ĺ": "l", "ŕ": "r", "ô": "o" };
  function plain(value) {
    var s = String(value || "").toLowerCase();
    if (typeof s.normalize === "function") {
      try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) { /* bez ICU */ }
    }
    return s.replace(/[^\u0000-\u007f]/g, function (c) { return DIACRITICS[c] || c; });
  }

  // ---------- API (XHR přes BFF) ----------
  function apiError(status, body) {
    var message = body && typeof body.message === "string" && body.message ? body.message
      : status === 0 ? NETWORK_ERROR : t("Požadavek selhal (") + status + ").";
    var e = new Error(message);
    e.status = status;
    e.code = body && body.code;
    return e;
  }
  var pendingRequests = [], requestEpoch = 0;
  // ---------- diagnostika pro ladění na skutečných TV ----------
  // Both queue and server enforce the same closed numeric/enum schema.
  var diagnosticPolicy = window.MovlyTvDiagnostics;
  var diagQueue = [], diagTimer = null, diagCount = 0, diagKeys = 0, bootAt = new Date().getTime();
  function diag(type, data) {
    if (diagCount >= 300 || !diagnosticPolicy) return;
    var event = diagnosticPolicy.sanitize(type, data, (new Date().getTime() - bootAt) / 1000);
    if (!event) return;
    diagCount++;
    diagQueue.push(event);
    if (!diagTimer) diagTimer = setTimeout(flushDiag, 1500);
  }
  function flushDiag() {
    diagTimer = null;
    if (!diagQueue.length) return;
    var batch = diagQueue.splice(0, 20);
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/app/tv-diagnostics", true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("X-Movly-App", "1");
      xhr.send(JSON.stringify({ events: batch }));
    } catch (e) { /* ignorovat */ }
    if (diagQueue.length) diagTimer = setTimeout(flushDiag, 1500);
  }
  function mediaSupport() {
    var v = document.createElement("video"), out = {};
    function cpt(type) { try { return v.canPlayType ? v.canPlayType(type) : "none"; } catch (e) { return "err"; } }
    out.hls = cpt("application/vnd.apple.mpegurl");
    out.xhls = cpt("application/x-mpegURL");
    out.mp4 = cpt('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
    out.ts = cpt("video/mp2t");
    var MS = window.MediaSource || window.WebKitMediaSource;
    out.mse = MS ? (window.MediaSource ? "std" : "webkit") : "none";
    try { out.mseAvc = MS && MS.isTypeSupported ? MS.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"') : null; } catch (e) { out.mseAvc = "err"; }
    return out;
  }
  window.onerror = function (message, source, line, col) {
    diag("error", { stage: "runtime", l: line, c: col });
  };
  function logKey(phase, event) {
    if (diagKeys >= 60 || !diagnosticPolicy) return;
    var eventData = diagnosticPolicy.keyEvent(phase, event, document.activeElement);
    if (!eventData) return;
    diagKeys++;
    diag(phase, eventData.d);
  }
  window.addEventListener("keydown", function (event) { logKey("keydown", event); }, true);
  window.addEventListener("keypress", function (event) { logKey("keypress", event); }, true);
  window.addEventListener("keyup", function (event) { logKey("keyup", event); }, true);
  function diagnosticStage(path) {
    if (/^(?:login|logout|session)(?:\?|$)/.test(path)) return "auth";
    if (/^profiles?(?:[/?]|$)/.test(path)) return "profiles";
    if (/^home(?:\?|$)/.test(path)) return "home";
    if (/^search(?:\?|$)/.test(path)) return "search";
    if (/^titles\//.test(path)) return "detail";
    if (/^(?:sources|streaming2?|providers)\//.test(path)) return "sources";
    if (/^playback(?:[/?]|$)/.test(path)) return "playback";
    if (/^watch-history(?:[/?]|$)/.test(path)) return "history";
    return "other";
  }
  function api(path, options, done) {
    options = options || {};
    var xhr = new XMLHttpRequest(), finished = false, epoch = requestEpoch;
    xhr.open(options.method || "GET", "/api/app/" + path, true);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-Movly-App", "1");
    xhr.setRequestHeader("X-Movly-Language", homeLanguage());
    // Pin requests to the account/profile that opened the screen, including
    // history writes and session teardown after another tab switches profiles.
    if (account && isId(account.id) && profile && isId(profile.id) && path !== "session" && path !== "profiles" && path !== "profile" && path !== "login" && path !== "logout") {
      xhr.setRequestHeader("X-Movly-Expected-Account", String(account.id));
      xhr.setRequestHeader("X-Movly-Expected-Profile", String(profile.id));
    }
    if (options.body !== undefined) xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = options.timeout || 60000;
    function finish(err, data) {
      if (finished) return;
      finished = true;
      var i = pendingRequests.indexOf(xhr);
      if (i >= 0) pendingRequests.splice(i, 1);
      if (epoch !== requestEpoch) return;
      if (err && path !== "session") diag("api", { stage: diagnosticStage(path), st: err.status });
      if (err && !options.quiet && handleAuthError(err)) return;
      if (done) done(err, data);
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || finished) return;
      if (xhr.status === 0) { finish(apiError(0)); return; }
      var data = null;
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; }
      catch (e) { finish(apiError(502, { message: t("Server vrátil nečitelnou odpověď.") })); return; }
      if (xhr.status >= 200 && xhr.status < 300) finish(null, data);
      else finish(apiError(xhr.status, data));
    };
    xhr.ontimeout = function () { finish(apiError(0)); };
    xhr.onerror = function () { finish(apiError(0)); };
    pendingRequests.push(xhr);
    xhr.send(options.body !== undefined ? JSON.stringify(options.body) : null);
    return xhr;
  }
  // Vypršené přihlášení vrací na přihlášení, chybějící profil na výběr profilu.
  function handleAuthError(err) {
    if (err.code === "offline_owner_changed") {
      stopPlayback();
      account = null; profile = null;
      boot();
      return true;
    }
    if (err.status === 401 || contains(SESSION_CODES, err.code)) {
      stopPlayback();
      account = null; profile = null;
      resetTo(loginScreen(t("Přihlášení vypršelo. Přihlas se znovu.")));
      return true;
    }
    if (contains(PROFILE_CODES, err.code)) {
      stopPlayback();
      profile = null;
      resetTo(profilesScreen(t("Vyber profil znovu.")));
      return true;
    }
    return false;
  }

  // ---------- obrazovky a historie ----------
  var root, stack = [], account = null, profile = null, historyDepth = 0, searchEnvironment = "";
  function current() { return stack[stack.length - 1]; }
  function mount(screen) {
    clear(root);
    root.appendChild(screen.el);
    root.className = "tv-root tv-screen-" + screen.name;
    // Viditelné „Zpět“ pro ovládání kurzorem (klávesa Zpět nemusí stránce dorazit).
    var head = screen.el.querySelector(".tv-header");
    if (head && stack.length > 1 && !head.querySelector(".tv-back")) head.insertBefore(button(t("\u25C0 Zpět"), back, "tv-back"), head.firstChild);
    if (screen.onShow) screen.onShow();
    var target = screen.lastFocus && screen.el.contains(screen.lastFocus) && isFocusable(screen.lastFocus) ? screen.lastFocus : null;
    focusEl(target || firstFocusable(screen.el), true);
  }
  function remember() {
    var s = current();
    if (s && document.activeElement && s.el.contains(document.activeElement)) s.lastFocus = document.activeElement;
  }
  function destroy(screen) { if (screen && screen.onDestroy) screen.onDestroy(); }
  function push(screen) {
    remember();
    stack.push(screen);
    try { history.pushState({ movlyTv: stack.length }, ""); historyDepth++; } catch (e) { /* bez history API */ }
    mount(screen);
  }
  function popScreen() {
    if (stack.length < 2) return;
    destroy(stack.pop());
    mount(current());
  }
  function back() {
    if (stack.length < 2) return;
    if (historyDepth > 0) { history.back(); return; }
    popScreen();
  }
  function resetTo(screen) {
    // Revoke callbacks before aborting: old XHR errors must never reset a newer
    // login/profile screen. Aborts can synchronously trigger readyState changes.
    requestEpoch++;
    var obsolete = pendingRequests.slice(0);
    pendingRequests.length = 0;
    each(obsolete, function (xhr) { try { xhr.abort(); } catch (e) { /* already closed */ } });
    while (stack.length) destroy(stack.pop());
    if (screen.name === "profiles") profile = null;
    // Záznamy historie z předchozích obrazovek už nic nevracejí.
    historyDepth = 0;
    stack.push(screen);
    mount(screen);
  }
  window.addEventListener("popstate", function () {
    if (historyDepth > 0) historyDepth--;
    popScreen();
  });

  // ---------- prostorová navigace ----------
  function isFocusable(n) {
    return n && n.className && (" " + n.className + " ").indexOf(" tv-f ") >= 0 && !n.disabled && n.offsetWidth > 0 && n.offsetHeight > 0;
  }
  function focusables(scope) {
    return filter(scope.querySelectorAll(".tv-f"), isFocusable);
  }
  function firstFocusable(scope) {
    var preferred = scope.querySelector(".tv-autofocus");
    if (preferred && isFocusable(preferred)) return preferred;
    return focusables(scope)[0] || null;
  }
  function hasClass(n, name) { return n && n.className && (" " + n.className + " ").indexOf(" " + name + " ") >= 0; }
  // Posune nejbližší posuvné kontejnery, aby byl prvek celý vidět (bez scrollIntoView s volbami).
  function ensureVisible(n) {
    var p = n.parentNode, margin;
    while (p && p !== document.body) {
      if (hasClass(p, "tv-scroll-x")) {
        margin = 48;
        var left = rel(n, p).left, right = left + n.offsetWidth;
        if (left - margin < p.scrollLeft) p.scrollLeft = Math.max(0, left - margin);
        else if (right + margin > p.scrollLeft + p.clientWidth) p.scrollLeft = right + margin - p.clientWidth;
      }
      if (hasClass(p, "tv-scroll-y")) {
        margin = 80;
        var top = rel(n, p).top, bottom = top + n.offsetHeight;
        if (top - margin < p.scrollTop) p.scrollTop = Math.max(0, top - margin);
        else if (bottom + margin > p.scrollTop + p.clientHeight) p.scrollTop = bottom + margin - p.clientHeight;
      }
      p = p.parentNode;
    }
  }
  // Poloha prvku vůči obsahu kontejneru (nezávisle na aktuálním posunu).
  function rel(n, container) {
    var a = n.getBoundingClientRect(), b = container.getBoundingClientRect();
    return { left: a.left - b.left + container.scrollLeft, top: a.top - b.top + container.scrollTop };
  }
  function focusEl(n, silent) {
    if (!n) return;
    try { n.focus(); } catch (e) { /* ignorovat */ }
    ensureVisible(n);
    if (!silent) remember();
  }
  function move(direction) {
    var screen = current();
    if (!screen) return;
    var list = focusables(screen.el);
    if (!list.length) return;
    var from = document.activeElement;
    if (!from || !screen.el.contains(from) || !isFocusable(from)) { focusEl(list[0]); return; }
    var a = from.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var horizontal = direction === KEY.LEFT || direction === KEY.RIGHT;
    var best = null, bestScore = Infinity;
    each(list, function (c) {
      if (c === from) return;
      var b = c.getBoundingClientRect();
      var bx = b.left + b.width / 2, by = b.top + b.height / 2, main, cross, overlap;
      if (direction === KEY.RIGHT) { if (bx <= ax + 1 || b.left < a.left + 4) return; main = Math.max(0, b.left - a.right); }
      else if (direction === KEY.LEFT) { if (bx >= ax - 1 || b.right > a.right - 4) return; main = Math.max(0, a.left - b.right); }
      else if (direction === KEY.DOWN) { if (by <= ay + 1 || b.top < a.top + 4) return; main = Math.max(0, b.top - a.bottom); }
      else { if (by >= ay - 1 || b.bottom > a.bottom - 4) return; main = Math.max(0, a.top - b.bottom); }
      if (horizontal) {
        // Vodorovně jen v rámci stejné řady (na konci řady fokus zůstane).
        overlap = b.bottom > a.top + 2 && b.top < a.bottom - 2;
        if (!overlap) return;
        cross = Math.abs(by - ay);
      } else {
        cross = Math.abs(bx - ax);
      }
      // Svisle nejbližší řádek, pak nejmenší boční posun.
      var score = horizontal ? main + cross * 3 : main * 4 + cross;
      if (score < bestScore) { bestScore = score; best = c; }
    });
    if (best) focusEl(best);
  }
  // Po načtení dat přesune fokus na obsah, pokud s ním uživatel mezitím nehýbal.
  function autoFocus(s, scope) {
    if (current() !== s) return;
    var a = document.activeElement;
    if (s.touched && a && s.el.contains(a) && isFocusable(a)) return;
    focusEl((scope && firstFocusable(scope)) || firstFocusable(s.el), true);
  }
  function isTextInput(n) {
    return n && n.tagName === "INPUT" && n.type !== "button" && n.type !== "submit";
  }
  // Kurzor ovladače: najetí na prvek ho zvýrazní stejně jako fokus z šipek.
  document.addEventListener("mouseover", function (event) {
    var n = event.target;
    while (n && n !== document.body && !isFocusable(n)) n = n.parentNode;
    if (n && n !== document.body && n !== document.activeElement && !isTextInput(n)) { try { n.focus(); } catch (e) { /* ignorovat */ } remember(); }
  }, false);
  document.addEventListener("keydown", function (event) {
    var screen = current();
    if (!screen) return;
    var key = event.keyCode, target = event.target;
    if (key === KEY.UP || key === KEY.DOWN || key === KEY.LEFT || key === KEY.RIGHT) screen.touched = true;
    if (screen.onKey && screen.onKey(event) === true) { event.preventDefault(); return; }
    if (key === KEY.BACK || key === KEY.ESC || (key === KEY.BACKSPACE && !isTextInput(target))) {
      event.preventDefault();
      back();
      return;
    }
    if (key === KEY.UP || key === KEY.DOWN || key === KEY.LEFT || key === KEY.RIGHT) {
      if (isTextInput(target) && (key === KEY.LEFT || key === KEY.RIGHT)) {
        // Šipky uvnitř textu posouvají kurzor; navigace až na kraji pole.
        var atStart = target.selectionStart === 0 && target.selectionEnd === 0;
        var atEnd = target.selectionStart === target.value.length;
        if ((key === KEY.LEFT && !atStart) || (key === KEY.RIGHT && !atEnd)) return;
      }
      event.preventDefault();
      move(key);
      return;
    }
    if (key === KEY.ENTER && !isTextInput(target) && isFocusable(target) && screen.el.contains(target)) {
      event.preventDefault();
      target.click();
    }
  }, false);

  // ---------- společné prvky ----------
  function header(title, extra) {
    return h("header", { className: "tv-header" }, [
      brand("span", "tv-brand"),
      title ? h("h1", { className: "tv-title", text: title }) : null,
      extra ? h("div", { className: "tv-header-actions" }, extra) : null
    ]);
  }
  function statusBox(text, kind) {
    return h("p", { className: "tv-status" + (kind ? " tv-status-" + kind : ""), role: kind === "error" ? "alert" : "status", text: text });
  }
  function setStatus(box, text, kind) {
    clear(box);
    box.className = "tv-status" + (kind ? " tv-status-" + kind : "");
    box.hidden = !text;
    if (text) box.appendChild(document.createTextNode(text));
  }
  function makeScreen(name, children, extra) {
    var el = h("section", { className: "tv-screen tv-scroll-y" }, children);
    var s = { name: name, el: el };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) s[k] = extra[k];
    return s;
  }
  function titleOf(item) {
    var t = item && item.title && typeof item.title === "object" ? item.title : item;
    if (!t || !isId(t.id) || typeof t.title !== "string") return null;
    return t;
  }
  function posterCard(t, onclick, caption) {
    var src = imageURL(t.poster_path, "w342");
    return h("button", { type: "button", className: "tv-f tv-card", onclick: onclick, "aria-label": t.title }, [
      h("span", { className: "tv-poster" }, [
        src ? h("img", { src: src, alt: "" }) : h("span", { className: "tv-poster-fallback", text: t.title })
      ]),
      h("span", { className: "tv-card-title", text: t.title }),
      caption ? h("span", { className: "tv-card-meta", text: caption }) : null
    ]);
  }
  function rail(name, items, onOpen) {
    var track = h("div", { className: "tv-rail-track tv-scroll-x" }, map(items, function (t) {
      return posterCard(t, function () { (onOpen || openDetail)(t); });
    }));
    return h("section", { className: "tv-rail" }, [h("h2", { text: name }), scroller(track)]);
  }
  function grid(items) {
    return h("div", { className: "tv-grid" }, map(items, function (t) {
      return posterCard(t, function () { openDetail(t); }, t.year ? String(t.year) : null);
    }));
  }

  // ---------- přihlášení ----------
  function loginScreen(notice) {
    var user = h("input", { type: "text", className: "tv-f tv-input tv-autofocus", autocomplete: "username", autocapitalize: "off", spellcheck: "false", "aria-label": t("Uživatelské jméno"), placeholder: t("Uživatelské jméno") });
    var pass = h("input", { type: "password", className: "tv-f tv-input", autocomplete: "current-password", "aria-label": t("Heslo"), placeholder: t("Heslo") });
    var submit = h("button", { type: "submit", className: "tv-f tv-button tv-primary", text: t("Přihlásit se") });
    var status = statusBox(notice || "", notice ? "info" : null);
    status.hidden = !notice;
    var busy = false;
    var form = h("form", { className: "tv-form", novalidate: true }, [
      h("label", { className: "tv-label", text: t("Uživatelské jméno") }), user,
      h("label", { className: "tv-label", text: t("Heslo") }), pass,
      submit, status
    ]);
    form.onsubmit = function (event) {
      event.preventDefault();
      if (busy) return;
      if (document.activeElement === user && !pass.value) { focusEl(pass); return; }
      if (document.activeElement === pass && !user.value) { focusEl(user); return; }
      if (!user.value.replace(/\s+/g, "") || !pass.value) { setStatus(status, t("Vyplň uživatelské jméno a heslo."), "error"); return; }
      busy = true;
      submit.disabled = true;
      setStatus(status, t("Přihlašuji…"), "info");
      api("login", { method: "POST", body: { username: user.value, password: pass.value }, quiet: true }, function (err, data) {
        busy = false;
        submit.disabled = false;
        if (err) {
          pass.value = "";
          setStatus(status, err.status === 0 ? NETWORK_ERROR
            : err.status === 401 || err.status === 403 ? t("Přihlášení se nepodařilo: nesprávné uživatelské jméno nebo heslo.")
            : t("Přihlášení se nepodařilo: ") + err.message, "error");
          focusEl(pass);
          return;
        }
        searchEnvironment = data && /^[a-f0-9]{32}$/.test(data.environment || "") ? data.environment : "";
        account = data && data.account;
        profile = null;
        resetTo(profilesScreen());
      });
    };
    return makeScreen("login", [
      h("div", { className: "tv-center" }, [
        brand("h1", "tv-logo"),
        h("p", { className: "tv-lead", text: t("Přihlas se svým účtem Movly. Text zadáš klávesnicí televizoru po stisku OK.") }),
        form,
        h("p", { className: "tv-hint", text: t("TV lite: omezená verze pro starší televizory.") })
      ])
    ]);
  }

  // ---------- profily a PIN ----------
  function profilesScreen(notice) {
    var list = h("div", { className: "tv-profiles" });
    var status = statusBox(notice || t("Načítám profily…"), notice ? "info" : null);
    var logout = button(t("Odhlásit se"), doLogout);
    function load() {
      setStatus(status, t("Načítám profily…"));
      api("profiles", {}, function (err, data) {
        clear(list);
        if (err) { setStatus(status, err.message, "error"); list.appendChild(button(t("Zkusit znovu"), load, "tv-autofocus")); focusEl(firstFocusable(s.el)); return; }
        if (!data || !data.length) { setStatus(status, t("Účet nemá žádný profil. Vytvoř ho v plné aplikaci Movly."), "error"); return; }
        setStatus(status, notice || "", notice ? "info" : null);
        each(data, function (p) {
          if (!isId(p.id) || typeof p.name !== "string") return;
          var src = imageURL(p.avatar_url);
          list.appendChild(h("button", { type: "button", className: "tv-f tv-profile" + (list.firstChild ? "" : " tv-autofocus"), onclick: function () { chooseProfile(p); } }, [
            h("span", { className: "tv-avatar" }, [src ? h("img", { src: src, alt: "" }) : h("span", { text: p.name.charAt(0).toUpperCase() })]),
            h("span", { className: "tv-profile-name", text: p.name }),
            p.has_pin ? h("span", { className: "tv-profile-lock", text: t("Chráněno PINem") }) : null
          ]));
        });
        autoFocus(s, list);
      });
    }
    function chooseProfile(p) {
      if (p.has_pin) { push(pinScreen(p)); return; }
      setStatus(status, t("Otevírám profil ") + p.name + "…", "info");
      selectProfile(p, null, function (err) { if (err) setStatus(status, err.message, "error"); });
    }
    var s = makeScreen("profiles", [
      header(t("Kdo se dívá?"), [logout]),
      status,
      list
    ], { onShow: function () { if (!list.firstChild) load(); } });
    return s;
  }
  function selectProfile(p, pin, done) {
    var body = { id: p.id };
    if (pin !== null) body.pin = pin;
    api("profile", { method: "POST", body: body, quiet: true }, function (err, data) {
      if (err) {
        if (contains(SESSION_CODES, err.code)) { handleAuthError(err); return; }
        done(err);
        return;
      }
      searchEnvironment = data && /^[a-f0-9]{32}$/.test(data.environment || "") ? data.environment : searchEnvironment;
      profile = data && data.profile;
      done(null);
      resetTo(homeScreen());
    });
  }
  function pinScreen(p) {
    var input = h("input", { type: "password", className: "tv-f tv-input tv-pin-input", inputmode: "numeric", maxlength: "8", autocomplete: "off", "aria-label": "PIN profilu", placeholder: "PIN" });
    var status = statusBox("", null);
    status.hidden = true;
    var busy = false;
    function submit() {
      if (busy) return;
      if (!/^\d{4,8}$/.test(input.value)) { setStatus(status, t("PIN musí mít 4 až 8 číslic."), "error"); return; }
      busy = true;
      setStatus(status, t("Ověřuji PIN…"), "info");
      selectProfile(p, input.value, function (err) {
        busy = false;
        if (!err) return;
        input.value = "";
        setStatus(status, err.code === "invalid_profile_pin" || err.status === 401 ? t("Nesprávný PIN. Zkus to znovu.") : err.message, "error");
      });
    }
    function type(d) { if (input.value.length < 8) input.value += d; }
    var keys = h("div", { className: "tv-keypad" });
    each(["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"], function (d) {
      keys.appendChild(button(d, function () {
        if (d === "OK") submit();
        else if (d === "⌫") input.value = input.value.slice(0, -1);
        else type(d);
      }, (d === "OK" ? "tv-primary" : "") + (d === "1" ? " tv-autofocus" : "")));
    });
    var form = h("form", { className: "tv-form tv-pin-form", novalidate: true }, [input]);
    form.onsubmit = function (event) { event.preventDefault(); submit(); };
    return makeScreen("pin", [
      header("Profil " + p.name),
      h("div", { className: "tv-center" }, [
        h("p", { className: "tv-lead", text: t("Zadej PIN profilu. Můžeš použít číselná tlačítka ovladače.") }),
        form, keys, status,
        button(t("Zpět"), back)
      ])
    ], {
      onKey: function (event) {
        var k = event.keyCode;
        if (k >= 48 && k <= 57 && event.target !== input) { type(String(k - 48)); return true; }
        if (k >= 96 && k <= 105 && event.target !== input) { type(String(k - 96)); return true; }
        return false;
      }
    });
  }
  function doLogout() {
    api("logout", { method: "POST", body: {}, quiet: true }, function () {
      account = null;
      profile = null;
      resetTo(loginScreen(t("Byl(a) jsi odhlášen(a).")));
    });
  }

  function homeLanguage() {
    try { var value = localStorage.getItem("movly.uiLanguage"); if (value === "en" || value === "sk") return value; } catch (e) { /* no UI-language storage */ }
    return "cs";
  }
  function pageFeed(path, done) {
    var scope = searchScope(), ownerId = account.id, profileId = profile.id, request = null, cancelled = false;
    function validPolicy(value) { return value && value.user_id === ownerId && value.profile_id === profileId && /^ep1\.[a-f0-9]{64}$/.test(value.revision || ""); }
    function currentScope() { return !cancelled && scope === searchScope(); }
    request = api("profiles/effective-content-policy", {}, function (err, policy) {
      if (!currentScope()) return;
      if (err || !validPolicy(policy)) { done(err || { message: t("Pravidla profilu nejsou ověřena.") }); return; }
      request = api(path, {}, function (error, data) {
        if (!currentScope()) return;
        if (error) { done(error); return; }
        request = api("profiles/effective-content-policy", {}, function (policyError, fresh) {
          if (!currentScope()) return;
          if (policyError || !validPolicy(fresh) || fresh.revision !== policy.revision) { done(policyError || { message: t("Pravidla profilu se změnila. Načti stránku znovu.") }); return; }
          done(null, data);
        });
      });
    });
    return { abort: function () { cancelled = true; if (request) request.abort(); } };
  }
  function watchPageMetadata(page, active, changed) {
    var model = window.MovlyHomePreferences, scope = searchScope(), ownerId = account.id, profileId = profile.id;
    return model.watch({ initial: true, active: function () { return !document.hidden && scope === searchScope() && active(); }, changed: changed,
      read: function (done) {
        var cancelled = false, request = null;
        request = api("profiles/effective-content-policy", {}, function (err, policy) {
          if (cancelled || scope !== searchScope() || !active()) return;
          if (err || !policy || policy.user_id !== ownerId || policy.profile_id !== profileId || !/^ep1\.[a-f0-9]{64}$/.test(policy.revision || "")) { done(err || { message: "Context changed" }); return; }
          request = api("pages/" + page + "/preferences" + query({ lang: homeLanguage() }), {}, function (error, value) {
            if (cancelled || scope !== searchScope() || !active()) return;
            try { if (!error) { value = model.document(value, profileId, page); value.policy_revision = policy.revision; } } catch (invalid) { error = invalid; }
            done(error, value);
          });
        });
        return { abort: function () { cancelled = true; if (request) request.abort(); } };
      }
    });
  }
  function tvSettingsScreen() {
    var words = window.MovlyHomePreferences, lang = homeLanguage(), scope = searchScope(), screen, entries = [];
    each(["home", "movies", "series"], function (page) {
      var entry = button(words.text("pages", lang) + " — " + words.text(page, lang), function () {
        if (scope === searchScope() && current() === screen && screen.el.contains(entry)) push(homePreferencesScreen(page));
      });
      entries.push(entry);
    });
    var identifiers = window.MovlyTitleIdentifiers;
    entries.push(h("h2", { text: identifiers.text("advanced", lang) }));
    var toggle = button("", function () {
      if (current() !== screen || scope !== searchScope()) return;
      if (!identifiers.setEnabled(!identifiers.enabled())) { toggle.textContent = identifiers.text("error", lang); return; }
      paint();
    });
    function paint() {
      toggle.textContent = identifiers.text("title", lang) + ": " + identifiers.text(identifiers.enabled() ? "on" : "off", lang);
      toggle.setAttribute("aria-pressed", identifiers.enabled() ? "true" : "false");
    }
    toggle.setAttribute("data-title-identifiers-toggle", ""); paint(); entries.push(toggle);
    screen = makeScreen("settings", [header(words.text("settings", lang))].concat(entries));
    return screen;
  }
  function homePreferencesScreen(page) {
    if (["home", "movies", "series"].indexOf(page) < 0) page = "home";
    var model = window.MovlyHomePreferences, lang = homeLanguage(), scope = searchScope(), profileId = profile.id;
    var alive = true, generation = 0, request = null, busy = false, ready = false, conflict = false, doc = null, draft = null, policyRevision = "", dirty = false, screen, watcher;
    var status = statusBox(""), rows = h("div", { className: "tv-home-preferences" }), actions = h("div", { className: "tv-search-actions" });
    function text(key) { return model.text(key, lang); }
    function present() { return alive && scope === searchScope() && current() === screen && !screen.el.hidden; }
    function action(label, fn, enabled) {
      var control = button(label, function () { if (present() && ready && !busy && !conflict && screen.el.contains(control)) fn(); });
      control.disabled = !ready || busy || conflict || enabled === false;
      return control;
    }
    function paint(focusKey) {
      clear(rows); clear(actions);
      if (doc && draft) each(draft.order, function (slug, index) {
        var row = null;
        each(doc.sections, function (item) { if (item.slug === slug) row = item; });
        var hidden = draft.hidden.indexOf(slug) >= 0;
        var group = h("section", { className: "tv-home-preference-row", "data-home-slug": slug }, [h("h2", { text: row.name || slug }), h("p", { text: text(hidden ? "hidden" : "visible") })]);
        each(["up", "down", hidden ? "show" : "hide"], function (key) {
          var control = action(text(key), function () {
            if (key === "up" || key === "down") model.move(draft, slug, key === "up" ? -1 : 1); else model.toggle(draft, slug);
            dirty = true; paint(slug + ":" + key);
          }, key === "up" ? index > 0 : key === "down" ? index < draft.order.length - 1 : true);
          control.setAttribute("aria-label", text(key) + " " + (row.name || slug)); control.setAttribute("data-home-action", slug + ":" + key); group.appendChild(control);
        });
        rows.appendChild(group);
      });
      if (doc && !doc.sections.length) rows.appendChild(h("p", { text: text("empty") }));
      actions.appendChild(action(text("save"), function () { save(false); }));
      actions.appendChild(action(text("reset"), function () {
        var mine = generation; if (window.confirm(text("resetConfirm")) && present() && mine === generation) save(true);
      }));
      var reload = button(text("reload"), function () { if (present() && !busy && screen.el.contains(reload)) load(); });
      reload.disabled = busy; actions.appendChild(reload);
      if (focusKey) {
        var choices = screen.el.querySelectorAll("[data-home-action]");
        each(choices, function (node) { if (node.getAttribute("data-home-action") === focusKey && !node.disabled) focusEl(node); });
      }
    }
    function cancel() { if (watcher) watcher.stop(); generation++; if (request) request.abort(); request = null; busy = false; }
    function freshPolicy(mine, done) {
      request = api("profiles/effective-content-policy", {}, function (err, value) {
        if (!present() || mine !== generation) return;
        if (err || !value || value.user_id !== account.id || value.profile_id !== profileId || !/^ep1\.[a-f0-9]{64}$/.test(value.revision || "")) { done(err || { message: text("context") }); return; }
        done(null, value);
      });
    }
    function load(preserve) {
      if (!present() || busy) return;
      cancel(); var mine = generation; busy = true; ready = false; setStatus(status, text("loading")); paint();
      freshPolicy(mine, function (policyError, policy) {
        if (policyError) { busy = false; setStatus(status, text("loadError"), "error"); paint(); return; }
        request = api("pages/" + page + "/preferences" + query({ lang: lang }), {}, function (err, value) {
          if (!present() || mine !== generation) return;
          busy = false;
          if (!err) try { var fresh = model.document(value, profileId, page);
            var next = model.reconcile(doc, draft, fresh, preserve && dirty, policy.revision === policyRevision, preserve && conflict);
            doc = next.document; draft = next.draft; dirty = next.dirty; ready = next.ready; conflict = next.conflict;
            if (!dirty) policyRevision = policy.revision; } catch (invalid) { err = invalid; }
          setStatus(status, err ? text("loadError") : conflict ? text(ready ? "conflict" : "context") : "", err || conflict ? "error" : null); paint(); autoFocus(screen, rows); if (watcher) watcher.start();
        });
      });
    }
    function save(reset) {
      if (!present() || !ready || busy || conflict || !doc) return;
      cancel(); var mine = generation, body = model.body(doc, draft, reset); busy = true; setStatus(status, text("saving")); paint();
      freshPolicy(mine, function (policyError, policy) {
        if (policyError || policy.revision !== policyRevision) { busy = false; ready = false; setStatus(status, text("context"), "error"); paint(); return; }
        request = api("pages/" + page + "/preferences" + query({ lang: lang }), { method: "PUT", body: body }, function (err, value) {
          if (!present() || mine !== generation) return;
          busy = false;
          if (!err) try { doc = model.receipt(value, profileId, body.revision, page); draft = model.draft(doc); dirty = false; if (watcher) { var accepted = model.document(doc, profileId, page); accepted.policy_revision = policyRevision; watcher.accept(accepted); } } catch (invalid) { err = invalid; }
          conflict = !!err && err.status === 409;
          setStatus(status, text(err ? conflict ? "conflict" : "error" : "saved"), err ? "error" : null); paint(); if (watcher) watcher.start();
        });
      });
    }
    screen = makeScreen("home-preferences", [header(text("pages") + " — " + text(page)), h("p", { text: text("description") }), status, rows, actions], {
      onShow: function () { screen.el.hidden = false; if (!doc) load(); else paint(); },
      onBlur: function () { cancel(); ready = false; screen.el.hidden = true; },
      onFocus: function () { verifySearchScope(screen, scope, function () { load(true); }); },
      onDestroy: function () { alive = false; cancel(); }
    });
    watcher = watchPageMetadata(page, present, function () { load(true); });
    return screen;
  }

  // ---------- Domů ----------
  function homeScreen() {
    var body = h("div", { className: "tv-home" });
    var status = statusBox(t("Načítám Domů…"));
    var s, scope = searchScope(), alive = true, generation = 0, request = null, watcher;
    function valid() { return alive && scope === searchScope() && current() === s && !s.el.hidden; }
    function homeAction(label, action) {
      var control = button(label, function () { if (valid() && s.el.contains(control)) action(); });
      return control;
    }
    function open(screen) { generation++; if (request) request.abort(); push(screen); }
    function load() {
      if (!valid()) return;
      var mine = ++generation;
      if (request) request.abort();
      clear(body); setStatus(status, t("Načítám Domů…"));
      request = pageFeed("home" + query({ include_highlights: "true", page: 1 }), function (err, data) {
        if (!valid() || mine !== generation) return;
        clear(body);
        if (err) {
          setStatus(status, err.message, "error");
          body.appendChild(homeAction(t("Zkusit znovu"), load));
          autoFocus(s, body);
          return;
        }
        var sections = data && data.sections && data.sections.length !== undefined ? data.sections.slice(0) : [];
        sections.sort(function (a, b) { return (a.display_order || 0) - (b.display_order || 0); });
        var shown = 0;
        each(sections, function (row) {
          if (!row || typeof row.name !== "string") return;
          if (row.kind === "collections") {
            var banners = filter(row.collections || [], function (c) { return c && typeof c.slug === "string" && /^[a-z0-9_-]{1,100}$/.test(c.slug) && typeof c.name === "string"; });
            if (!banners.length) return;
            body.appendChild(h("section", { className: "tv-rail" }, [
              h("h2", { text: row.name }),
              scroller(h("div", { className: "tv-rail-track tv-scroll-x" }, map(banners, function (c) {
                return h("button", { type: "button", className: "tv-f tv-collection", onclick: function () { if (valid() && mine === generation) open(collectionScreen(c)); } }, [
                  h("strong", { text: c.name }),
                  c.total_items ? h("span", { text: c.total_items + t(" titulů") }) : null
                ]);
              })))
            ]));
            shown++;
            return;
          }
          var items = filter(map(row.items || [], titleOf), Boolean);
          if (!items.length) return;
          body.appendChild(rail(row.name, row.kind === "top10" ? items.slice(0, 10) : items, function (title) { if (valid() && mine === generation) openDetail(title); }));
          shown++;
        });
        setStatus(status, shown ? "" : t("Domů zatím nemá žádné řady."), shown ? null : "info");
        autoFocus(s, body); if (watcher) watcher.start();
      });
    }
    s = makeScreen("home", [
      header(profile ? profile.name : "", [
        homeAction(window.MovlyHomePreferences.text("movies", homeLanguage()), function () { open(catalogPageScreen("movies")); }),
        homeAction(window.MovlyHomePreferences.text("series", homeLanguage()), function () { open(catalogPageScreen("series")); }),
        homeAction(t("Hledat"), function () { open(searchScreen()); }),
        homeAction(window.MovlyHomePreferences.text("settings", homeLanguage()), function () { open(tvSettingsScreen()); }),
        homeAction(t("Změnit profil"), function () { resetTo(profilesScreen()); }),
        homeAction(t("Odhlásit se"), doLogout)
      ]),
      status,
      body
    ], {
      onShow: function () { s.el.hidden = false; load(); },
      onBlur: function () { if (watcher) watcher.stop(); generation++; if (request) request.abort(); s.el.hidden = true; },
      onFocus: function () { verifySearchScope(s, scope, load); },
      onDestroy: function () { if (watcher) watcher.stop(); alive = false; generation++; if (request) request.abort(); }
    });
    watcher = watchPageMetadata("home", valid, load);
    return s;
  }
  function catalogPageScreen(page) {
    var type = page === "series" ? "tv" : "movie", scope = searchScope(), alive = true, generation = 0, request = null, screen, watcher;
    var body = h("div", { className: "tv-home" }), status = statusBox("");
    function valid() { return alive && scope === searchScope() && current() === screen && !screen.el.hidden; }
    function guarded(label, fn) { var control = button(label, function () { if (valid() && screen.el.contains(control)) fn(); }); return control; }
    function load() {
      if (!valid()) return;
      var mine = ++generation; if (request) request.abort(); clear(body); setStatus(status, t("Načítám…"));
      request = pageFeed("main" + query({ type: type, limit: 30 }), function (err, data) {
        if (!valid() || mine !== generation) return;
        clear(body);
        if (err) { setStatus(status, err.message, "error"); body.appendChild(guarded(t("Zkusit znovu"), load)); autoFocus(screen, body); return; }
        var lists = (data && data.lists && data.lists.length !== undefined ? data.lists.slice(0) : []), seen = {}, shown = 0;
        lists.sort(function (a, b) { return (a.display_order || 0) - (b.display_order || 0); });
        each(lists, function (row) {
          if (!row || typeof row.slug !== "string" || seen["$" + row.slug]) return;
          seen["$" + row.slug] = true;
          var items = filter(map(row.items || [], titleOf), Boolean); if (!items.length) return;
          var node = rail(row.name || row.slug, row.slug === "top-watched" ? items.slice(0, 10) : items, function (title) { if (valid() && mine === generation) push(detailScreen(title)); });
          node.setAttribute("data-rail-slug", row.slug);
          var more = guarded(t("Zobrazit vše — ") + (row.name || row.slug), function () { push(catalogListScreen(row, page)); });
          node.appendChild(more); body.appendChild(node); shown++;
        });
        setStatus(status, shown ? "" : t("Na této stránce zatím nejsou žádné řady."), shown ? null : "info"); autoFocus(screen, body); if (watcher) watcher.start();
      });
    }
    screen = makeScreen("catalog-" + page, [header(window.MovlyHomePreferences.text(page, homeLanguage()), [
      guarded(window.MovlyHomePreferences.text("settings", homeLanguage()), function () { push(homePreferencesScreen(page)); }),
      guarded(t("Hledat"), function () { push(searchScreen()); })]), status, body], {
      onShow: function () { screen.el.hidden = false; load(); },
      onBlur: function () { if (watcher) watcher.stop(); generation++; if (request) request.abort(); screen.el.hidden = true; },
      onFocus: function () { verifySearchScope(screen, scope, load); },
      onDestroy: function () { if (watcher) watcher.stop(); alive = false; generation++; if (request) request.abort(); }
    });
    watcher = watchPageMetadata(page, valid, load);
    return screen;
  }
  function catalogListScreen(row, page) {
    var scope = searchScope(), alive = true, generation = 0, request = null, screen, pageNumber = 1;
    var body = h("div"), status = statusBox("");
    function valid() { return alive && scope === searchScope() && current() === screen && !screen.el.hidden; }
    function load() {
      if (!valid()) return; var mine = ++generation; if (request) request.abort(); clear(body); setStatus(status, t("Načítám…"));
      request = pageFeed("main/lists/" + encodeURIComponent(row.slug) + query({ page: pageNumber, limit: 30, type: page === "series" ? "tv" : "movie" }), function (err, data) {
        if (!valid() || mine !== generation) return;
        clear(body); if (err) { setStatus(status, err.message, "error"); var retry = button(t("Zkusit znovu"), function () { if (valid() && screen.el.contains(retry)) load(); }); body.appendChild(retry); autoFocus(screen, body); return; }
        var list = data && (data.list || data);
        var items = filter(map(list && list.items || [], titleOf), Boolean);
        body.appendChild(rail(row.name || row.slug, items, function (title) { if (valid() && mine === generation) push(detailScreen(title)); }));
        function paging(label, delta) { var control = button(label, function () { if (valid() && screen.el.contains(control)) { pageNumber += delta; load(); } }); return control; }
        if (pageNumber > 1) body.appendChild(paging(t("Předchozí"), -1));
        if (items.length === 30) body.appendChild(paging(t("Další"), 1));
        setStatus(status, items.length ? "" : t("Žádné tituly.")); autoFocus(screen, body);
      });
    }
    screen = makeScreen("catalog-list-" + page, [header(row.name || row.slug), status, body], {
      onShow: function () { screen.el.hidden = false; load(); }, onBlur: function () { generation++; if (request) request.abort(); screen.el.hidden = true; },
      onFocus: function () { verifySearchScope(screen, scope, load); }, onDestroy: function () { alive = false; generation++; if (request) request.abort(); }
    }); return screen;
  }
  function collectionScreen(c) {
    var body = h("div");
    var status = statusBox(t("Načítám…"));
    var s = makeScreen("collection", [header(c.name), status, body], {
      onShow: function () {
        if (body.firstChild) return;
        api("home" + query({ collection: c.slug, page: 1 }), {}, function (err, data) {
          if (err) { setStatus(status, err.message, "error"); return; }
          var items = [];
          each((data && data.sections) || [], function (row) { items = items.concat(filter(map(row.items || [], titleOf), Boolean)); });
          setStatus(status, items.length ? "" : t("Kolekce je prázdná."), items.length ? null : "info");
          body.appendChild(grid(items));
          autoFocus(s, body);
        });
      }
    });
    return s;
  }

  // ---------- hledání ----------
  // History contains bounded terms only, partitioned by trusted environment,
  // account and selected profile. Unknown environment disables persistence.
  function exactTitleKey(value) {
    if (typeof value !== "string") return "";
    return plain(value).replace(/[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\u2000-\u206f\u3000-\u303f]+/g, " ").replace(/^ +| +$/g, "");
  }
  function exactSearchGroups(rawItems, term, offset) {
    var key = exactTitleKey(term), exact = [], related = [], seen = {};
    each(arrayList(rawItems), function (raw, i) {
      var title = titleOf(raw);
      if (!title || seen["$" + title.id]) return;
      seen["$" + title.id] = true;
      var entry = { title: title, position: offset + i + 1 };
      if (key && (exactTitleKey(title.title) === key || exactTitleKey(title.original_title) === key)) exact.push(entry);
      else related.push(entry);
    });
    return { exact: exact, related: related };
  }
  function searchScope() { return account && profile ? account.id + ":" + profile.id + ":" + searchEnvironment : ""; }
  function searchOwner() {
    return account && isId(account.id) && profile && isId(profile.id) && searchEnvironment
      ? searchEnvironment + ":" + account.id + ":" + profile.id : "";
  }
  function historyTerms(owner) {
    if (!owner) return [];
    try {
      var values = JSON.parse(localStorage.getItem("movly.searchHistory.v2." + owner) || "[]");
      if (Object.prototype.toString.call(values) !== "[object Array]") return [];
      return filter(values, function (v) { return typeof v === "string" && v.length <= 200 && /\S/.test(v); }).slice(0, 20);
    } catch (e) { return []; }
  }
  function storeTerms(owner, terms) {
    if (!owner || owner !== searchOwner()) return;
    try { localStorage.setItem("movly.searchHistory.v2." + owner, JSON.stringify(terms.slice(0, 20))); } catch (e) { /* storage unavailable */ }
  }
  function rememberTerm(owner, value) {
    var term = value.replace(/^\s+|\s+$/g, "").slice(0, 200);
    if (term) storeTerms(owner, [term].concat(filter(historyTerms(owner), function (v) { return v.toLowerCase() !== term.toLowerCase(); })));
  }
  function filterQuery(definition) {
    var out = {}, listKeys = { audio_languages: "audio_language", subtitle_languages: "subtitle_language", original_languages: "original_language" };
    for (var k in definition) if (Object.prototype.hasOwnProperty.call(definition, k)) {
      var v = definition[k];
      if (v === "" || v === null || v === undefined || v === false) continue;
      if (Object.prototype.toString.call(v) === "[object Array]") { if (v.length) out[listKeys[k] || k] = v.join(","); }
      else out[k] = v;
    }
    return out;
  }
  function verifySearchScope(screen, scope, done) {
    screen.el.hidden = true;
    api("session", { quiet: true }, function (err, data) {
      if (current() !== screen) return;
      var environment = data && /^[a-f0-9]{32}$/.test(data.environment || "") ? data.environment : "";
      var next = data && data.account && data.profile ? data.account.id + ":" + data.profile.id + ":" + environment : "";
      if (err || next !== scope) { boot(); return; }
      screen.el.hidden = false;
      if (done) done();
    });
  }
  function searchScreen() {
    var owner = searchOwner(), scope = searchScope(), alive = true, revision = 0, suggestRevision = 0, policyRevision = "", policyGeneration = 0, discoveryAllowed = false, discoveryError = false;
    var input = h("input", { type: "search", maxlength: 200, className: "tv-f tv-input tv-autofocus", autocomplete: "off", "aria-label": t("Hledat název nebo výraz"), placeholder: t("Název filmu, seriálu nebo popis"), role: "combobox", "aria-expanded": "false", "aria-controls": "tv-search-suggestions" });
    var suggestions = h("div", { id: "tv-search-suggestions", role: "listbox", "aria-label": t("Návrhy hledání") });
    var status = statusBox(t("Napiš název a potvrď Hledat."), "info"), results = h("div"), idle = h("div"), activeFilters = h("p", { className: "tv-hint" });
    var suggestTimer = null, suggestionRequest = null, activeRequest = null, definition = {}, page = 1, natural = false, committedQuery = null, lastResult = null, pendingResultFocus = false, s;
    function valid() { return alive && scope === searchScope(); }
    function active() { return valid() && current() === s && !s.el.hidden; }
    function searchAction(label, action, className) {
      var control = button(label, function () { if (active() && s.el.contains(control)) action.call(control); }, className);
      return control;
    }
    function cancelSuggestions() {
      suggestRevision++; clearTimeout(suggestTimer);
      if (suggestionRequest) { suggestionRequest.abort(); suggestionRequest = null; }
      clear(suggestions); input.setAttribute("aria-expanded", "false");
    }
    function termButton(term) { return searchAction(term, function () { input.value = term; page = 1; natural = false; commitSearch(); }); }
    function renderHistory() {
      clear(idle);
      if (input.value.replace(/\s/g, "")) return;
      var history = h("div", { className: "tv-search-history" }), terms = historyTerms(owner);
      history.appendChild(h("h2", { text: t("Poslední hledání") }));
      each(terms, function (term) {
        history.appendChild(h("div", { className: "tv-search-term" }, [termButton(term), searchAction("Odebrat „" + term + "“", function () {
          storeTerms(owner, filter(historyTerms(owner), function (v) { return v !== term; })); renderHistory(); focusEl(firstFocusable(idle));
        })]));
      });
      if (!terms.length) history.appendChild(h("p", { text: t("Zatím tu žádná hledání nejsou.") }));
      else history.appendChild(searchAction(t("Vymazat historii"), function () { storeTerms(owner, []); renderHistory(); focusEl(firstFocusable(s.el)); }));
      idle.appendChild(history);
      var discoveries = h("div"); idle.appendChild(discoveries);
      if (!discoveryAllowed) { if (discoveryError) discoveries.appendChild(searchAction(t("Obnovit pravidla a návrhy"), function () { s.onShow(); })); return; }
      var mine = revision, policy = policyRevision;
      function unchanged() { return valid() && mine === revision && policy === policyRevision && !input.value.replace(/\s/g, ""); }
      api("trending-searches?limit=10", {}, function (err, data) {
        if (!unchanged()) return;
        var section = h("div", {}, [h("h2", { text: t("Populární hledání") })]);
        if (err) section.appendChild(searchAction(t("Populární hledání: zkusit znovu"), renderHistory));
        else each(arrayList(data && data.trending_searches).slice(0, 10), function (v) {
          if (v && typeof v.query === "string" && v.query.length <= 100 && v.search_count > 0) section.appendChild(termButton(v.query));
        });
        discoveries.appendChild(section);
      });
      api("popular-titles-search?limit=10", {}, function (err, data) {
        if (!unchanged()) return;
        var section = h("div", {}, [h("h2", { text: t("Nejčastěji vybírané tituly") })]);
        if (err) section.appendChild(searchAction(t("Populární tituly: zkusit znovu"), renderHistory));
        else each(arrayList(data && data.popular_titles).slice(0, 10), function (v) {
          if (!v || !isId(v.title_id) || v.interaction_count <= 0 || typeof v.title !== "string") return;
          // No unrestricted title data/poster hydration: the discovery API is policy-scoped.
          section.appendChild(searchAction(v.title, function () { openDetail({ id: v.title_id, title: v.title, type: v.type }); }));
        });
        discoveries.appendChild(section);
      });
    }
    function suggest() {
      if (!active()) return;
      cancelSuggestions();
      var q = input.value.replace(/^\s+|\s+$/g, "");
      if (!valid() || !discoveryAllowed || !q || q.length > 100) return;
      var mine = suggestRevision, policy = policyRevision;
      suggestionRequest = api("autocomplete" + query({ q: q, limit: 8 }), {}, function (err, data) {
        if (!valid() || mine !== suggestRevision || policy !== policyRevision || input.value.replace(/^\s+|\s+$/g, "") !== q) return;
        if (err) {
          var retry = searchAction(t("Zkusit návrhy znovu"), suggest); retry.setAttribute("role", "option"); suggestions.appendChild(retry);
          input.setAttribute("aria-expanded", "true"); return;
        }
        each(arrayList(data && data.suggestions).slice(0, 8), function (term) {
          if (typeof term !== "string" || !term || term.length > 100) return;
          var choice = termButton(term); choice.setAttribute("role", "option"); suggestions.appendChild(choice);
        });
        input.setAttribute("aria-expanded", suggestions.firstChild ? "true" : "false");
      });
    }
    function renderResults(data, focus, searchText, resultOffset, generation) {
      lastResult = { data: data, text: searchText, offset: resultOffset, policy: policyRevision };
      var items = filter(map((data && data.results) || [], titleOf), Boolean);
      clear(results);
      setStatus(status, items.length ? "Nalezeno: " + (typeof data.total === "number" ? data.total : items.length) : t("Nic jsme nenašli."), items.length ? null : "info");
      if (data.degraded || (data.warnings && data.warnings.length) || (data.degraded_sources && data.degraded_sources.length)) results.appendChild(statusBox(t("Některé zdroje výsledků nejsou dostupné. Výsledky mohou být neúplné."), "info"));
      if (data.parsed && data.parsed.matched) results.appendChild(statusBox(t("Rozpoznané filtry: ") + filterDescription(data.parsed), "info"));
      var renderedRevision = generation, renderedQuery = searchText;
      var grouped = exactSearchGroups(data.results, renderedQuery, resultOffset);
      function section(entries, heading, className) {
        if (!entries.length) return;
        var cards = h("div", { className: "tv-grid" }), section = h("section", { className: className }, [h("h2", { text: heading }), cards]);
        each(entries, function (entry) {
          var title = entry.title, card = posterCard(title, function () {
            if (!active() || renderedRevision !== revision || !s.el.contains(card)) return;
            if (renderedQuery) api("track-search", { method: "POST", body: { query: renderedQuery, title_id: title.id, interaction_type: "click", position_in_results: entry.position } }, function () {});
            openDetail(title);
          });
          cards.appendChild(card);
        });
        results.appendChild(section);
      }
      section(grouped.exact, t("Přesná shoda názvu"), "tv-search-exact");
      section(grouped.related, grouped.exact.length ? t("Další výsledky") : t("Výsledky"), "tv-search-related");
      var pages = h("div", { className: "tv-search-actions" });
      if (page > 1) pages.appendChild(searchAction(t("Předchozí stránka"), function () { page--; run(false); }));
      if (data.total > page * 30 || data.total_pages > page) pages.appendChild(searchAction(t("Další stránka"), function () { page++; run(false); }));
      results.appendChild(pages);
      if (focus && current() === s) focusEl(firstFocusable(results) || input);
    }
    function commitSearch() {
      if (!active()) return;
      committedQuery = input.value.replace(/^\s+|\s+$/g, "");
      run(true);
    }
    function run(focus) {
      if (!active() || committedQuery === null || input.value.replace(/^\s+|\s+$/g, "") !== committedQuery) return;
      if (focus) cancelSuggestions();
      var q = committedQuery, params = filterQuery(definition), mine = ++revision, resultOffset = (page - 1) * 30;
      lastResult = null; clear(results); clear(idle);
      if (!q && !Object.keys(params).length) { setStatus(status, t("Napiš název nebo nastav filtry."), "info"); renderHistory(); return; }
      if (q.length > 200) return;
      if (q && focus) rememberTerm(owner, q);
      setStatus(status, t("Hledám…"));
      if (activeRequest) activeRequest.abort();
      var filtered = Object.keys(params).length > 0;
      params.limit = 30; params.page = page;
      if (q) params.q = q;
      var path = natural && q ? "search/filters" : filtered ? "titles/filter" : "search";
      if (path === "search") { params.type = "both"; params.offset = (page - 1) * 30; delete params.page; }
      if (path === "search/filters") params = { q: q, page: page, limit: 30 };
      function done(err, data) {
        if (!valid() || mine !== revision) return;
        if (err) { setStatus(status, err.message, "error"); results.appendChild(searchAction(t("Zkusit znovu"), function () { if (mine === revision) run(focus); })); return; }
        if (path === "search/filters" && data && data.parsed && data.parsed.matched === false) {
          activeRequest = api("search" + query({ q: q, type: "both", limit: 30, offset: (page - 1) * 30 }), {}, function (fallbackError, fallback) {
            if (!valid() || mine !== revision) return;
            if (fallbackError) { setStatus(status, fallbackError.message, "error"); results.appendChild(searchAction(t("Zkusit znovu"), function () { if (mine === revision) run(focus); })); return; }
            renderResults(fallback || {}, focus, q, resultOffset, mine);
          });
          return;
        }
        renderResults(data || {}, focus, q, resultOffset, mine);
      }
      activeRequest = api(path + query(params), {}, done);
    }
    input.addEventListener("input", function () {
      if (!active()) return;
      revision++; cancelSuggestions(); committedQuery = null; lastResult = null; page = 1; natural = false;
      if (activeRequest) { activeRequest.abort(); activeRequest = null; }
      clear(results); clear(idle);
      if (!input.value.replace(/\s/g, "")) { clear(results); setStatus(status, t("Napiš název nebo nastav filtry."), "info"); renderHistory(); return; }
      setStatus(status, t("Potvrď Hledat nebo vyber návrh."), "info");
      suggestTimer = setTimeout(suggest, 250);
    }, false);
    var form = h("form", { className: "tv-form tv-search-form", novalidate: true, role: "search" }, [input, suggestions,
      h("div", { className: "tv-search-actions" }, [searchAction(t("Hledat"), function () { page = 1; natural = false; commitSearch(); }), searchAction(t("Rozpoznat filtry z textu"), function () { page = 1; natural = true; commitSearch(); }), searchAction(t("Filtry a uložené filtry"), function () {
        cancelSuggestions(); revision++;
        push(searchFilterScreen(definition, function (next) { definition = next; natural = false; page = 1; activeFilters.textContent = Object.keys(next).length ? t("Použité filtry: ") + filterDescription(next) : ""; pendingResultFocus = true; back(); }));
      }), searchAction(t("Zrušit filtry"), function () { definition = {}; activeFilters.textContent = ""; page = 1; commitSearch(); })])]);
    form.onsubmit = function (event) { event.preventDefault(); page = 1; natural = false; commitSearch(); };
    s = makeScreen("search", [header(t("Hledat")), form, activeFilters, status, idle, results], {
      onShow: function () {
        if (!valid()) return;
        var policyMine = ++policyGeneration;
        revision++; clear(results); clear(idle);
        discoveryAllowed = false; cancelSuggestions();
        api("profiles/effective-content-policy", {}, function (err, policy) {
          if (!valid() || policyMine !== policyGeneration || current() !== s) return;
          var revisionValue = !err && policy && policy.revision || "";
          if (policyRevision && revisionValue !== policyRevision) { revision++; clear(results); clear(idle); }
          policyRevision = revisionValue;
          discoveryError = !!err || !policy || policy.user_id !== account.id || policy.profile_id !== profile.id || typeof policy.is_kids !== "boolean";
          discoveryAllowed = !err && policy && policy.schema_version === 1 && policy.user_id === account.id && policy.profile_id === profile.id && policy.is_kids === false && policy.age_controls_active === false && /^ep1\.[a-f0-9]{64}$/.test(policy.revision || "");
          renderHistory();
          if (pendingResultFocus) { pendingResultFocus = false; commitSearch(); }
          else if (lastResult && lastResult.policy === policyRevision && lastResult.text === committedQuery) renderResults(lastResult.data, false, lastResult.text, lastResult.offset, revision);
          else if (committedQuery !== null) setStatus(status, t("Potvrď Hledat pro obnovení výsledků."), "info");
        });
        renderHistory();
      },
      onBlur: function () { policyGeneration++; discoveryAllowed = false; revision++; cancelSuggestions(); s.el.hidden = true; },
      onFocus: function () { verifySearchScope(s, scope, function () { s.onShow(); }); },
      onKey: function (event) {
        if (event.keyCode === KEY.ESC && suggestions.firstChild) { cancelSuggestions(); focusEl(input); return true; }
        if (event.target === input && event.keyCode === KEY.DOWN && suggestions.firstChild) { focusEl(firstFocusable(suggestions)); return true; }
        if (suggestions.contains(event.target) && event.keyCode === KEY.UP && event.target === firstFocusable(suggestions)) { focusEl(input); return true; }
        return false;
      },
      onDestroy: function () { alive = false; policyGeneration++; revision++; cancelSuggestions(); if (activeRequest) activeRequest.abort(); }
    });
    return s;
  }

  function filterDescription(definition) {
    var labels = { type: t("Typ"), genre_ids: t("Žánry"), genre_names: t("Žánry"), genre_match: t("Shoda žánrů"), year_from: t("Rok od"), year_to: t("Rok do"), rating_from: t("Hodnocení od"), rating_to: t("Hodnocení do"), runtime_from: t("Délka od (min)"), runtime_to: t("Délka do (min)"), video_height_min: t("Kvalita"), hdr: "HDR", has_streams: t("Dostupné zdroje"), audio_languages: t("Audio"), audio_language: t("Audio"), subtitle_languages: t("Titulky"), subtitle_language: t("Titulky"), original_languages: t("Původní jazyk"), original_language: t("Původní jazyk"), countries: t("Země"), sort_by: t("Řazení"), sort_order: t("Směr"), text: t("Název") };
    var values = { movie: t("Filmy"), tv: t("Seriály"), all: t("Všechny"), any: t("Libovolný"), asc: t("Vzestupně"), desc: t("Sestupně"), popularity: t("Popularita"), rating: t("Hodnocení"), year: t("Rok"), title: t("Název"), runtime: t("Délka"), vote_count: t("Počet hodnocení") }, out = [];
    for (var key in definition) if (Object.prototype.hasOwnProperty.call(definition, key) && labels[key]) {
      var value = definition[key];
      if (value === null || value === undefined || value === false || value === "") continue;
      if (key === "genre_ids") { if (definition.genre_names) continue; value = value.length + t(" vybraných"); }
      else if (Object.prototype.toString.call(value) === "[object Array]") { if (!value.length) continue; value = value.join(", "); }
      else if (value === true) value = t("Ano");
      else value = values[value] || String(value);
      out.push(labels[key] + ": " + value);
    }
    return out.join(" · ");
  }
  function searchFilterScreen(initial, apply) {
    var owner = searchOwner(), scope = searchScope(), alive = true, fields = {}, stored = [], selectedID = null, savedGeneration = 0, genreGeneration = 0, facetGeneration = 0, s;
    var status = statusBox(""), controls = h("div", { className: "tv-search-filter-fields" }), saved = h("div"), facetHints = h("div"), genreChoices = h("div", { className: "tv-filter-facets" });
    var name = h("input", { type: "text", maxlength: 60, className: "tv-f tv-input", "aria-label": t("Název uloženého filtru") });
    function valid() { return alive && scope === searchScope(); }
    function active() { return valid() && current() === s && !s.el.hidden; }
    function filterAction(label, action, className) {
      var control = button(label, function () { if (active() && s.el.contains(control)) action.call(control); }, className);
      return control;
    }
    function row(label, input) { controls.appendChild(h(input.tagName === "BUTTON" ? "div" : "label", { className: "tv-filter-field" }, input.tagName === "BUTTON" ? [input] : [h("span", { text: label }), input])); }
    function field(key, label, kind, max) {
      var input = h("input", { type: kind || "text", className: "tv-f tv-input", maxlength: max || 200, "aria-label": label });
      if (kind === "number") input.setAttribute("step", key.indexOf("rating_") === 0 ? "0.1" : "1");
      fields[key] = input; row(label, input);
    }
    function cycle(key, label, options) {
      var control = filterAction(label, function () {
        var at = 0; each(options, function (o, i) { if (o[0] === control.value) at = i; });
        control.value = options[(at + 1) % options.length][0]; control.refresh();
      });
      control.value = "";
      control.refresh = function () { var text = control.value; each(options, function (o) { if (o[0] === control.value) text = o[1]; }); control.textContent = label + ": " + (text || t("Libovolné")); };
      fields[key] = control; row(label, control);
    }
    cycle("type", t("Typ"), [["", t("Vše")], ["movie", t("Filmy")], ["tv", t("Seriály")]]);
    fields.genre_ids = h("input", { type: "hidden" });
    controls.appendChild(h("h2", { text: t("Žánry") })); controls.appendChild(genreChoices);
    cycle("genre_match", t("Shoda žánrů"), [["any", t("Libovolný")], ["all", t("Všechny")]]);
    each([["year_from", t("Rok od")], ["year_to", t("Rok do")], ["rating_from", t("Hodnocení od (0–10)")], ["rating_to", t("Hodnocení do (0–10)")], ["runtime_from", t("Délka od (min)")], ["runtime_to", t("Délka do (min)")]], function (entry) { field(entry[0], entry[1], "number"); });
    cycle("video_height_min", t("Kvalita"), [["", t("Libovolná")], ["720", "HD"], ["1080", "Full HD"], ["2160", "4K"]]);
    cycle("hdr", "HDR", [["", t("Libovolné")], ["true", t("Ano")]]);
    cycle("has_streams", t("Dostupné zdroje"), [["", t("Vše")], ["true", t("Jen dostupné")]]);
    each([["audio_languages", t("Audio")], ["subtitle_languages", t("Titulky")], ["original_languages", t("Původní jazyk")], ["countries", t("Země")]], function (entry) { field(entry[0], entry[1] + t(" (kódy oddělené čárkou)")); });
    controls.appendChild(facetHints);
    cycle("sort_by", t("Řazení"), [["popularity", t("Popularita")], ["title", t("Název")], ["year", t("Rok")], ["rating", t("Hodnocení")], ["runtime", t("Délka")], ["vote_count", t("Počet hodnocení")]]);
    cycle("sort_order", t("Směr"), [["desc", t("Sestupně")], ["asc", t("Vzestupně")]]);
    function refreshChoices() {
      each(controls.querySelectorAll(".tv-filter-choice"), function (choice) {
        var key = choice.getAttribute("data-filter-key"), code = choice.getAttribute("data-filter-code");
        choice.setAttribute("aria-pressed", contains(fields[key].value.split(","), code) ? "true" : "false");
      });
    }
    function facetChoice(key, code, label) {
      var choice = filterAction(label, function () {
        var values = fields[key].value ? fields[key].value.split(",") : [];
        fields[key].value = (contains(values, code) ? filter(values, function (v) { return v !== code; }) : values.concat([code])).join(",");
        refreshChoices();
      }, "tv-filter-choice");
      choice.setAttribute("data-filter-key", key); choice.setAttribute("data-filter-code", code);
      choice.setAttribute("aria-pressed", contains(fields[key].value.split(","), code) ? "true" : "false");
      return choice;
    }
    function fill(definition) {
      each(Object.keys(fields), function (key) {
        var value = definition[key];
        if (key === "audio_languages" && !value) value = definition.audio_language;
        if (key === "original_languages" && !value) value = definition.original_language;
        fields[key].value = value === undefined || value === null || value === false ? "" : Object.prototype.toString.call(value) === "[object Array]" ? value.join(",") : String(value);
        if (fields[key].refresh) fields[key].refresh();
      });
      refreshChoices();
    }
    function read() {
      var out = {};
      each(Object.keys(fields), function (key) {
        var raw = fields[key].value.replace(/^\s+|\s+$/g, "");
        if (!raw) return;
        if (key === "hdr" || key === "has_streams") { out[key] = raw === "true"; return; }
        if (key === "genre_ids" || /_languages$/.test(key) || key === "countries") {
          var parts = raw.split(","), values = [];
          if (parts.length > 30) throw new Error(t("Vyber nejvýše 30 hodnot v jednom poli."));
          each(parts, function (part) {
            part = part.replace(/^\s+|\s+$/g, "");
            if (key === "genre_ids") { if (!/^[1-9]\d*$/.test(part)) throw new Error(t("Žánr musí mít platný číselný kód.")); part = Number(part); }
            else { if (!(key === "countries" ? /^[a-z]{2}$/i : /^[a-z]{2,3}$/i).test(part)) throw new Error(t("Použij platné kódy jazyků a zemí.")); part = key === "countries" ? part.toUpperCase() : part.toLowerCase(); }
            if (!contains(values, part)) values.push(part);
          }); out[key] = values; return;
        }
        if (/^(year_|rating_|runtime_|video_height)/.test(key)) {
          var value = Number(raw), low = key.indexOf("year_") === 0 ? 1800 : 0, high = key.indexOf("year_") === 0 ? 2100 : key.indexOf("rating_") === 0 ? 10 : 10000;
          if (!isFinite(value) || value < low || value > high) throw new Error(t("Zkontroluj číselné rozsahy filtru."));
          out[key] = value; return;
        }
        out[key] = raw;
      });
      each(["year", "rating", "runtime"], function (key) { if (out[key + "_from"] !== undefined && out[key + "_to"] !== undefined && out[key + "_from"] > out[key + "_to"]) throw new Error(t("Dolní mez nesmí být vyšší než horní.")); });
      return out;
    }
    function choose(item) { selectedID = item.id; name.value = item.name; fill(item.filter || {}); setStatus(status, t("Vybraný filtr: ") + item.name, "info"); focusEl(firstFocusable(controls)); }
    function loadSaved() {
      var mine = ++savedGeneration;
      api("saved-filters", {}, function (err, data) {
        if (!valid() || mine !== savedGeneration) return; clear(saved);
        saved.appendChild(h("h2", { text: t("Uložené filtry") }));
        if (err) { saved.appendChild(filterAction(t("Uložené filtry: zkusit znovu"), loadSaved)); return; }
        stored = data && data.items || [];
        each(stored, function (item) {
          if (!item || !isId(item.id) || typeof item.name !== "string") return;
          saved.appendChild(h("div", { className: "tv-search-term" }, [filterAction(item.name, function () { choose(item); }), filterAction("Smazat filtr „" + item.name + "“", function () {
            api("saved-filters/" + item.id, { method: "DELETE" }, function (error) { if (!valid()) return; if (error) setStatus(status, error.message, "error"); else { if (selectedID === item.id) selectedID = null; loadSaved(); setStatus(status, t("Filtr byl smazán."), "info"); } });
          })]));
        });
        if (!stored.length) saved.appendChild(h("p", { text: t("Zatím nemáš žádné uložené filtry.") }));
      });
    }
    function save(update) {
      if (!active()) return;
      var definition; try { definition = read(); } catch (e) { setStatus(status, e.message, "error"); return; }
      var value = name.value.replace(/^\s+|\s+$/g, "");
      if (!value || value.length > 60) { setStatus(status, t("Pojmenuj filtr (nejvýše 60 znaků)."), "error"); focusEl(name); return; }
      if (update && !selectedID) { setStatus(status, t("Nejdřív vyber uložený filtr."), "error"); return; }
      api("saved-filters" + (update ? "/" + selectedID : ""), { method: update ? "PUT" : "POST", body: { name: value, filter: definition } }, function (err) { if (!valid()) return; setStatus(status, err ? err.message : t("Filtr byl uložen."), err ? "error" : "info"); if (!err) loadSaved(); });
    }
    each(["audio_languages", "subtitle_languages", "original_languages", "countries"], function (key) { fields[key].addEventListener("input", refreshChoices, false); });
    fill(initial);
    s = makeScreen("search-filters", [header(t("Filtry hledání")), status, saved, controls, name, h("div", { className: "tv-search-actions" }, [
      filterAction(t("Použít filtry"), function () { if (!valid()) return; try { apply(read()); } catch (e) { setStatus(status, e.message, "error"); } }),
      filterAction(t("Uložit jako nový filtr"), function () { save(false); }), filterAction(t("Upravit vybraný filtr"), function () { save(true); }),
      filterAction(t("Vyčistit formulář"), function () { selectedID = null; name.value = ""; fill({}); })
    ])], { onBlur: function () { facetGeneration++; genreGeneration++; s.el.hidden = true; }, onFocus: function () { verifySearchScope(s, scope, function () { loadFacets(); loadGenres(); }); }, onDestroy: function () { alive = false; } });
    loadSaved();
    function loadGenres() {
    var mine = ++genreGeneration;
    clear(genreChoices);
    api("titles/genres", {}, function (err, data) {
      if (!valid() || mine !== genreGeneration) return;
      if (err) { genreChoices.appendChild(filterAction(t("Žánry: zkusit znovu"), loadGenres)); return; }
      each(arrayList(data && data.genres || data).slice(0, 60), function (genre) {
        if (!genre || !isId(genre.id)) return;
        genreChoices.appendChild(facetChoice("genre_ids", String(genre.id), genre.name_cs || genre.name || String(genre.id)));
      });
    });
    }
    function loadFacets() {
    var mine = ++facetGeneration;
    clear(facetHints);
    api("titles/filter/facets", {}, function (err, facets) {
      if (!valid() || mine !== facetGeneration) return;
      if (err || !facets || facets.policy_scoped !== true) { facetHints.appendChild(filterAction(t("Nabídka jazyků: zkusit znovu"), loadFacets)); return; }
      each(["audio_languages", "subtitle_languages", "original_languages", "countries"], function (key) {
        var group = h("div", { className: "tv-filter-facets" }, [h("h3", { text: fields[key].getAttribute("aria-label") })]);
        each(arrayList(facets && facets[key]).slice(0, 60), function (facet) {
          if (!facet || typeof facet.code !== "string" || !(key === "countries" ? /^[A-Z]{2}$/ : /^[a-z]{2,3}$/).test(facet.code)) return;
          group.appendChild(facetChoice(key, facet.code, facet.label || facet.code));
        }); facetHints.appendChild(group);
      });
    });
    }
    loadGenres(); loadFacets();
    return s;
  }

  // ---------- detail titulu ----------
  function openDetail(t) { push(detailScreen(t)); }
  function released(episode) {
    var d = episode && episode.air_date;
    if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(d)) return true;
    var now = new Date(), today = now.getUTCFullYear() + "-" + pad(now.getUTCMonth() + 1) + "-" + pad(now.getUTCDate());
    return d.slice(0, 10) <= today;
  }
  function detailScreen(t) {
    var body = h("div", { className: "tv-detail" });
    var status = statusBox(t("Načítám detail…"));
    var s;
    var inventory = null, inventoryAccess = !!account && (["premium","vip","moderator","admin"].indexOf(account.role)>=0 || Date.parse(account.premiumUntil || "")>Date.now()), inventoryGeneration = 0, detailData = null;
    function inventoryBadge(episodeId) {
      var node = h("span", {className:"database-inventory-badge", "data-inventory-episode":episodeId || "title"});
      window.MovlyDatabaseAvailability.paint(node, inventory ? window.MovlyDatabaseAvailability.summary(episodeId ? inventory.episodes[episodeId] || [] : inventory.providers) : null, inventoryAccess);
      return node;
    }
    function loadInventory(data) {
      var mine=++inventoryGeneration; inventory=null;
      api("streaming/titles/" + data.id + "/inventory", {quiet:true}, function (error,result) {
        if(mine!==inventoryGeneration || !s || !s.el.parentNode) return;
        if(!error && result && result.access===false && result.title_id===data.id) inventoryAccess=false;
        else if(!error && window.MovlyDatabaseAvailability.valid(result,data.id)) { inventory=result; inventoryAccess=true; }
        var nodes=body.querySelectorAll("[data-inventory-episode]");
        each(nodes,function(node) { var id=node.getAttribute("data-inventory-episode"); window.MovlyDatabaseAvailability.paint(node,inventory ? window.MovlyDatabaseAvailability.summary(id==="title" ? inventory.providers : inventory.episodes[id] || []) : null,inventoryAccess); });
      });
    }
    function identifierNode(data) {
      var node = h("p", {className: "title-identifiers", "data-title-identifiers": ""});
      window.MovlyTitleIdentifiers.paint(node, data); return node;
    }
    function render(data) {
      detailData = data;
      clear(body);
      loadInventory(data);
      var meta = filter([
        data.year || (typeof data.release_date === "string" ? data.release_date.slice(0, 4) : null),
        data.runtime ? data.runtime + " min" : null,
        map(filter(data.genres || [], function (g) { return g && typeof g.name === "string"; }), function (g) { return g.name; }).slice(0, 3).join(", ") || null,
        data.type === "tv" ? t("Seriál") : t("Film")
      ], Boolean).join(" · ");
      var ratings = map(filter(data.ratings || [], function (r) { return r && r.source && typeof r.rating === "number"; }), function (r) { return r.source + " " + r.rating + " %"; }).join(" · ");
      var src = imageURL(data.poster_path, "w342");
      var wp = data.watch_progress || data.watch_history;
      var actions = h("div", { className: "tv-actions" });
      var info = h("div", { className: "tv-detail-info" }, [
        h("h1", { className: "tv-detail-title", text: data.title }),
        data.original_title && data.original_title !== data.title ? h("p", { className: "tv-muted", text: data.original_title }) : null,
        meta ? h("p", { className: "tv-meta", text: meta }) : null,
        identifierNode(data),
        ratings ? h("p", { className: "tv-meta", text: ratings }) : null,
        data.type !== "tv" ? inventoryBadge(null) : null,
        data.overview ? h("p", { className: "tv-overview", text: data.overview }) : null,
        actions
      ]);
      body.appendChild(h("div", { className: "tv-detail-top" }, [
        src ? h("img", { className: "tv-detail-poster", src: src, alt: "" }) : null,
        info
      ]));
      if (data.type !== "tv") {
        var resume = wp && wp.watch_status !== "completed" && wp.progress_seconds > 5 ? " (od " + clock(wp.progress_seconds) + ")" : "";
        var playTitle = button(t("Přehrát") + resume, function () { push(sourcesScreen(data, null, true)); }, "tv-primary tv-autofocus");
        window.attachPlayChoice(playTitle, function () { push(sourcesScreen(data, null, false)); }, t("Vybrat jiný zdroj"));
        actions.appendChild(playTitle);
        actions.appendChild(button(t("Vybrat zdroj"), function () { push(sourcesScreen(data, null, false)); }));
      } else {
        actions.appendChild(statusBox(t("Vyber řadu a epizodu níže."), "info"));
        loadSeasons(data);
      }
      if (data.type !== "tv") autoFocus(s, body);
    }
    function loadSeasons(data) {
      var has = false;
      each(data.seasons || [], function (x) { if (x && x.episodes && x.episodes.length !== undefined) has = true; });
      if (has) { renderSeasons(data, data.seasons); return; }
      api("titles/" + data.id + "/seasons", {}, function (err, result) {
        if (err) { body.appendChild(statusBox(err.message, "error")); return; }
        renderSeasons(data, (result && result.seasons) || []);
      });
    }
    function renderSeasons(data, seasons) {
      // Pouze běžné řady a epizody (bez speciálů s číslem 0).
      seasons = filter(seasons, function (x) { return x && x.season_number > 0; });
      seasons.sort(function (a, b) { return a.season_number - b.season_number; });
      if (!seasons.length) { body.appendChild(statusBox(t("Seriál zatím nemá žádné epizody."), "info")); return; }
      var wp = data.watch_progress;
      var selected = seasons[0];
      each(seasons, function (x) { if (wp && wp.season_number === x.season_number) selected = x; });
      var tabs = h("div", { className: "tv-season-tabs tv-scroll-x" });
      var episodes = h("div", { className: "tv-episodes" });
      var tabButtons = [];
      function pick(season, focusFirst) {
        selected = season;
        each(tabButtons, function (b) { b.btn.className = "tv-f tv-button tv-season" + (b.season === season ? " tv-selected" : ""); });
        clear(episodes);
        var list = filter(season.episodes || [], function (e) { return e && isId(e.id) && e.episode_number > 0; });
        list.sort(function (a, b) { return a.episode_number - b.episode_number; });
        if (!list.length) episodes.appendChild(statusBox(t("Řada nemá žádné epizody."), "info"));
        each(list, function (e) {
          var episode = { id: e.id, season_number: season.season_number, episode_number: e.episode_number, name: e.name, runtime: e.runtime, air_date: e.air_date };
          var ok = released(e);
          var progress = e.watch_history || e.watch_progress;
          var note = !ok ? t("Premiéra ") + e.air_date.slice(0, 10)
            : progress && progress.watch_status === "completed" ? t("Zhlédnuto")
            : progress && progress.progress_seconds > 5 ? t("Rozkoukáno ") + clock(progress.progress_seconds) : "";
          var btn = h("button", { type: "button", className: "tv-f tv-episode", disabled: !ok, onclick: function () { push(sourcesScreen(data, episode, true)); } }, [
            h("strong", { text: "S" + pad(season.season_number) + "E" + pad(e.episode_number) + " · " + (e.name || "Epizoda " + e.episode_number) }),
            inventoryBadge(e.id),
            note ? h("span", { className: "tv-muted", text: note }) : null
          ]);
          window.attachPlayChoice(btn, function () { if (ok) push(sourcesScreen(data, episode, false)); }, t("Vybrat jiný zdroj"));
          episodes.appendChild(btn);
        });
        if (focusFirst) { var f = firstFocusable(episodes); if (f) focusEl(f); }
      }
      each(seasons, function (season) {
        var btn = button(season.name || t("Řada ") + season.season_number, function () { pick(season, true); }, "tv-season");
        tabButtons.push({ btn: btn, season: season });
        tabs.appendChild(btn);
      });
      body.appendChild(h("section", { className: "tv-seasons" }, [h("h2", { text: t("Řady a epizody") }), scroller(tabs), episodes]));
      pick(selected, false);
      autoFocus(s, firstFocusable(episodes) ? episodes : tabs);
    }
    s = makeScreen("detail", [header(t.title), status, body], {
      onShow: function () {
        if (body.firstChild) {
          if (detailData) {
            loadInventory(detailData);
            each(body.querySelectorAll("[data-title-identifiers]"), function (node) { window.MovlyTitleIdentifiers.paint(node, detailData); });
          }
          return;
        }
        api("titles/" + t.id, {}, function (err, data) {
          if (err) { setStatus(status, err.message, "error"); body.appendChild(button(t("Zkusit znovu"), function () { clear(body); s.onShow(); }, "tv-autofocus")); focusEl(firstFocusable(s.el), true); return; }
          if (!data || !isId(data.id)) { setStatus(status, t("API vrátilo neplatný titul."), "error"); return; }
          setStatus(status, "");
          render(data);
        });
      }
    });
    return s;
  }

  // ---------- zdroje ----------
  // Shodné s player.js: podporovaní poskytovatelé a účty, které musí být připojené.
  var SUPPORTED = /^(?:webshare|hellspy|fastshare|sosac|streamuj|sktorrent|sledujteto|crwiki|ceskawiki|prehrajto|stremio|bombuj|voe|mixdrop|streamtape|doodstream|streamwish|vidhide|lulustream|ct|ceskatelevize|stvr)$/;
  function providerKey(name) { return plain(name).replace(/[ ._-]/g, ""); }
  function rank(s) { var v = s.video_height || 0; return v >= 4320 ? 5 : v >= 2160 ? 4 : v >= 1440 ? 3 : v >= 1080 ? 2 : v >= 720 ? 1 : 0; }
  function words(value) { return plain(value).replace(/[^a-z0-9]+/g, " ").replace(/^\s+|\s+$/g, ""); }
  // Stejná kontrola identity jako stream-recommendations.js (název, rok, SxxEyy).
  function identityMatches(s, t, episode) {
    var name = words(s.file_name);
    var names = filter([words(t.title), words(t.original_title)], Boolean);
    var ok = false;
    each(names, function (n) { if (name === n || name.indexOf(n + " ") === 0) ok = true; });
    if (!ok) return false;
    if (episode) {
      var m = /(?:^|[^a-z0-9])s(\d{1,2})[ ._-]*e(\d{1,3})(?!\d)|(?:^|[^a-z0-9])(\d{1,2})x(\d{1,3})(?!\d)/i.exec(s.file_name || "");
      return Boolean(m && Number(m[1] || m[3]) === episode.season_number && Number(m[2] || m[4]) === episode.episode_number);
    }
    var year = t.year || Number(String(t.release_date || "").slice(0, 4)) || null;
    var years = String(s.file_name || "").match(/\b(?:19|20)\d{2}\b/g) || [];
    return !year || !years.length || contains(years, String(year));
  }
  function displayCap() {
    var width = Math.max(window.screen.width || 0, window.screen.height || 0) * (window.devicePixelRatio || 1);
    // Starší TV dekódují spolehlivě nejvýše Full HD.
    return width >= 1920 ? 2 : width >= 1280 ? 1 : 0;
  }
  function sourcesScreen(t, episode, autoPlay) {
    var origins = [t("Databáze"), t("Databáze AI"), t("Webshare · živé hledání"), t("Hellspy · živé hledání"), t("Další poskytovatelé a doplňky")];
    var statusList = h("div", { className: "tv-source-status" });
    var rows = map(origins, function (name) { var r = h("p", { className: "tv-muted", text: name + t(": hledám…") }); statusList.appendChild(r); return r; });
    var bestBox = h("div", { className: "tv-actions" });
    var list = h("div", { className: "tv-sources" });
    var status = statusBox(autoPlay ? t("Hledám nejlepší zdroj…") : t("Hledám zdroje…"));
    var connections = {}, results = [], pending = origins.length, alive = true, s;
    function ready(stream) {
      var key = providerKey(stream.provider_name || stream.provider_identifier || "");
      return contains(["webshare", "fastshare", "sosac", "stremio"], key) ? connections[key] === true : true;
    }
    function playable(stream) {
      return SUPPORTED.test(providerKey(stream.provider_name || stream.provider_identifier || "")) && stream.available !== false && ready(stream);
    }
    function selectionFor(stream) {
      var sel = { title_id: t.id };
      if (stream.origin >= 2) { sel.source = "live"; sel.ticket = stream.ticket; }
      else { sel.source = stream.origin ? "ai" : "human"; sel.stream_id = stream.id; }
      if (episode) sel.episode_id = episode.id;
      return sel;
    }
    function label(stream) {
      var langs = map(stream.audio_languages || (stream.audio_language ? [stream.audio_language] : []), function (l) { return String(l).toUpperCase(); });
      return filter([stream.provider_name || stream.provider_identifier || origins[stream.origin],
        stream.video_height >= 2160 ? "4K" : stream.video_height ? stream.video_height + "p" : null,
        stream.video_codec, stream.hdr_type, langs.join(", ") || null,
        stream.file_size ? (stream.file_size / 1073741824).toFixed(2) + " GB" : null], Boolean).join(" · ");
    }
    // „Podobné" (demoted verdikt relevance z resolveru) se automaticky nikdy nevybírají.
    function demoted(x) { return Boolean(x.relevance && x.relevance.bucket === "demoted"); }
    // Doporučení jako stream-recommendations.js; jinak nejvyšší kvalita jako automatické přehrání v player.js.
    function best() {
      var cap = displayCap();
      var recommended = window.MovlyTvScoring.recommended(results, {
        displayMaxRank: cap,
        runtimeMinutes: episode && episode.runtime || t.runtime,
        primaryLanguage: document.documentElement.lang || "cs",
        downlinkMbps: navigator.connection && navigator.connection.downlink
      }, playable, function (x) { return identityMatches(x, t, episode); });
      if (recommended) return recommended;
      var options = filter(results, function (x) { return !demoted(x) && playable(x) && rank(x) <= cap; });
      if (!options.length) options = filter(results, function (x) { return !demoted(x) && playable(x); });
      options.sort(function (a, b) { return (b.video_height || 0) - (a.video_height || 0); });
      return options[0] || null;
    }
    function play(stream) {
      push(playerScreen(t, episode, selectionFor(stream), label(stream)));
    }
    function render() {
      var focused = document.activeElement;
      var hadFocus = s && s.el.contains(focused) && isFocusable(focused);
      clear(bestBox);
      clear(list);
      var b = best();
      if (b) {
        bestBox.appendChild(button(t("Přehrát doporučený zdroj"), function () { play(b); }, "tv-primary tv-autofocus"));
        bestBox.appendChild(h("p", { className: "tv-muted", text: label(b) }));
      }
      var sorted = results.slice(0);
      sorted.sort(function (a, b2) { return Number(playable(b2)) - Number(playable(a)) || (b2.video_height || 0) - (a.video_height || 0); });
      each(sorted.slice(0, 60), function (x) {
        var ok = playable(x);
        list.appendChild(h("button", { type: "button", className: "tv-f tv-source", disabled: !ok, onclick: function () { play(x); } }, [
          h("strong", { text: label(x) }),
          x.file_name ? h("span", { className: "tv-muted", text: x.file_name }) : null,
          !ok ? h("span", { className: "tv-muted", text: x.available === false ? t("Nedostupné") : t("Vyžaduje připojení účtu v plné aplikaci") }) : null
        ]));
      });
      if (!pending) setStatus(status, results.length ? t("Nalezeno zdrojů: ") + results.length : t("Žádné zdroje nebyly nalezeny. Webshare a další účty připoj v plné aplikaci Movly."), results.length ? null : "error");
      if (s && (!hadFocus || !s.el.contains(focused))) { s.touched = false; autoFocus(s); }
    }
    function search() {
      var suffix = query({ limit: 100, episode_id: episode ? episode.id : null });
      var ep = query({ episode_id: episode ? episode.id : null });
      var paths = [
        "streaming/titles/" + t.id + "/streams" + suffix,
        "streaming2/titles/" + t.id + "/streams" + suffix + "&type=" + encodeURIComponent(t.type || "movie"),
        "sources/" + t.id + "/webshare" + ep,
        "sources/" + t.id + "/hellspy" + ep,
        "sources/" + t.id + "/native" + ep
      ];
      each(paths, function (path, i) {
        api(path, {}, function (err, data) {
          if (!alive) return;
          pending--;
          if (err) { rows[i].textContent = origins[i] + ": " + err.message; rows[i].className = "tv-muted tv-error-text"; }
          else {
            var streams = data && data.streams && data.streams.length !== undefined ? data.streams : [];
            each(streams, function (x) { if (x && typeof x === "object") { x.origin = i; results.push(x); } });
            rows[i].textContent = origins[i] + ": " + (data && data.state === "not_connected" ? (data.message || t("účet není připojený")) : streams.length + t(" výsledků"));
          }
          if (autoPlay && !pending && current() === s) {
            var b = best();
            if (b) { autoPlay = false; s.autoStarted = true; play(b); return; }
            autoPlay = false;
          }
          render();
        });
      });
    }
    s = makeScreen("sources", [
      header(t.title + (episode ? " · S" + pad(episode.season_number) + "E" + pad(episode.episode_number) : "")),
      status, bestBox, statusList, list
    ], {
      onShow: function () {
        if (s.started) {
          // Návrat z přehrávače po automatickém spuštění: rovnou zpět na detail.
          if (s.autoStarted) { s.autoStarted = false; render(); }
          return;
        }
        s.started = true;
        var left = 4;
        each(["webshare", "fastshare", "sosac", "stremio"], function (name) {
          api("providers/" + name, { quiet: true }, function (err, data) {
            connections[name] = !err && (name === "stremio" ? Boolean(data && data.addons && data.addons.length) : data && data.connected === true);
            if (--left === 0 && alive) search();
          });
        });
      },
      onDestroy: function () { alive = false; }
    });
    return s;
  }

  // ---------- přehrávač ----------
  var activePlayer = null;
  function stopPlayback() { if (activePlayer) activePlayer.stop(); }
  var hlsLoading = null;
  function loadHls(done) {
    if (window.Hls) { done(window.Hls); return; }
    if (hlsLoading) { hlsLoading.push(done); return; }
    hlsLoading = [done];
    var script = document.createElement("script");
    script.src = HLS_SCRIPT;
    function finish() { var cbs = hlsLoading; hlsLoading = null; each(cbs, function (cb) { cb(window.Hls || null); }); }
    script.onload = finish;
    script.onerror = finish;
    (document.getElementsByTagName("head")[0] || document.documentElement).appendChild(script);
  }
  function hasMediaSource() { return Boolean(window.MediaSource || window.WebKitMediaSource); }
  function canNativeHls(video) {
    var r = video.canPlayType ? video.canPlayType("application/vnd.apple.mpegurl") : "";
    if (!r) r = video.canPlayType ? video.canPlayType("application/x-mpegURL") : "";
    return r === "probably" || r === "maybe";
  }
  function playerScreen(t, episode, selection, sourceLabel) {
    var video = h("video", { className: "tv-video", preload: "auto" });
    var titleText = t.title + (episode ? " · S" + pad(episode.season_number) + "E" + pad(episode.episode_number) + (episode.name ? " " + episode.name : "") : "");
    var timeText = h("span", { className: "tv-osd-time", text: "00:00" });
    var fill = h("span", { className: "tv-osd-fill" });
    var info = h("p", { className: "tv-osd-status", role: "status", text: t("Připravuji video…") });
    var osd = h("div", { className: "tv-osd" }, [
      h("p", { className: "tv-osd-title", text: titleText }),
      h("div", { className: "tv-osd-bar" }, [fill]),
      h("div", { className: "tv-osd-row" }, [timeText, h("span", { className: "tv-osd-hint", text: t("OK přehrát/pozastavit · ◀ ▶ posun o 10 s · Zpět ukončit") })]),
      info
    ]);
    // Tlačítka pro kurzor ovladače (LG NetCast posílá šipky jako pohyb kurzoru).
    var playButton = button(t("Pozastavit"), function () { togglePlay(); }, "tv-f-player tv-osd-play");
    var controls = h("div", { className: "tv-osd-controls" }, [
      button(t("\u25C0 Zpět"), back, "tv-f-player"),
      button("\u221210 s", function () { seek(-10); }, "tv-f-player"),
      playButton,
      button("+10 s", function () { seek(10); }, "tv-f-player"),
      button("+60 s", function () { seek(60); }, "tv-f-player")
    ]);
    osd.insertBefore(controls, info);
    var errorBox = h("div", { className: "tv-player-error" });
    errorBox.hidden = true;
    var el = h("section", { className: "tv-player" }, [video, osd, errorBox]);
    // Video jde přímo od poskytovatele, ne přes server (#153): délku a pozici
    // zná jen přehrávač televizoru.
    var session = null, offset = 0, hls = null, stopped = false, progressTimer = null, openTimer = null,
      osdTimer = null, seekTimer = null, seekTarget = null, generation = 0, lastSaved = -1, played = false, loaded = false;

    function duration() { return isFinite(video.duration) && video.duration > 0 ? video.duration : 0; }
    function position() { return loaded ? video.currentTime || 0 : offset; }
    function paint() {
      var dur = duration(), pos = seekTarget !== null ? seekTarget : position();
      timeText.textContent = clock(pos) + " / " + clock(dur);
      fill.style.width = (dur > 0 ? Math.min(100, (pos / dur) * 100) : 0) + "%";
    }
    function showOsd(sticky) {
      osd.className = "tv-osd tv-osd-visible";
      clearTimeout(osdTimer);
      if (!sticky && !video.paused) osdTimer = setTimeout(function () { osd.className = "tv-osd"; }, 4000);
    }
    function say(text) { info.textContent = text || ""; showOsd(Boolean(text)); }
    function fail(text) {
      diag("fail", { stage: "playback", engine: el.getAttribute("data-engine") });
      var at = position();
      saveHistory();
      teardown();
      offset = at;
      say("");
      clear(errorBox);
      errorBox.appendChild(h("h2", { text: t("Přehrávání selhalo") }));
      errorBox.appendChild(h("p", { text: text }));
      var retry = button(t("Zkusit znovu"), function () { errorBox.hidden = true; start(position()); }, "tv-primary tv-f-player");
      errorBox.appendChild(h("div", { className: "tv-actions" }, [retry, button(t("Zpět"), back, "tv-f-player")]));
      errorBox.hidden = false;
      focusEl(retry, true);
    }
    // Ukládání pozice stejně jako player.js (každých 20 s a při ukončení).
    function saveHistory() {
      if (!session || !loaded || !(video.currentTime > 0) || !duration()) return;
      var pos = Math.floor(position());
      if (pos === lastSaved) return;
      lastSaved = pos;
      var body = {
        title_id: t.id,
        type: t.type,
        watch_status: video.ended || pos >= duration() * 0.85 ? "completed" : "watching",
        progress_seconds: pos,
        duration_seconds: Math.floor(duration())
      };
      if (episode) { body.season_number = episode.season_number; body.episode_number = episode.episode_number; }
      api("watch-history", { method: "POST", body: body, quiet: true }, function (err) {
        if (err) {
          if (lastSaved === pos) lastSaved = -1;
          if (!stopped) say(t("Pozice se neuložila: ") + err.message);
        }
      });
    }
    function teardown() {
      clearInterval(progressTimer);
      clearTimeout(openTimer);
      clearTimeout(seekTimer);
      if (hls) { try { hls.destroy(); } catch (e) { /* ignorovat */ } hls = null; }
      try { video.pause(); } catch (e) { /* ignorovat */ }
      video.removeAttribute("src");
      try { video.load(); } catch (e) { /* ignorovat */ }
      session = null;
      loaded = false;
    }
    function start(at) {
      var mine = ++generation;
      if (session) { saveHistory(); }
      teardown();
      seekTarget = null;
      offset = Math.max(0, Math.floor(at || 0));
      say(t("Připravuji video…"));
      var body = {};
      for (var k in selection) if (Object.prototype.hasOwnProperty.call(selection, k)) body[k] = selection[k];
      api("playback", { method: "POST", body: body }, function (err, data) {
        if (stopped || mine !== generation) return;
        if (err) {
          fail(err.code === "app_required"
            ? t("Tento zdroj nejde na televizoru přehrát přímo. Otevři ho v aplikaci Movly, nebo zkus jiný zdroj.")
            : err.status === 0 ? NETWORK_ERROR : t("Zdroj se nepodařilo připravit: ") + err.message);
          return;
        }
        if (!data || data.direct !== true || typeof data.url !== "string" || !/^https:\/\//.test(data.url) || (data.kind !== "file" && data.kind !== "hls")) { fail(t("Server vrátil neplatný zdroj přehrávání.")); return; }
        session = data;
        diag("session", { kind: data.kind, offset: offset });
        paint();
        attach(mine);
      });
    }
    function attach(mine, skipNative) {
      function go() {
        var p = video.play();
        if (p && typeof p.then === "function") p.then(null, function () { say(t("Stiskni OK pro přehrání.")); });
      }
      clearInterval(progressTimer);
      progressTimer = setInterval(function () { saveHistory(); }, 20000);
      played = false;
      // Některé televizory nepodporovaný kontejner ani nenahlásí jako chybu.
      // Rezerva pro přípravu a plánování UI před celkovým limitem 25 s.
      clearTimeout(openTimer);
      openTimer = setTimeout(function () {
        if (stopped || mine !== generation || loaded || video.error) return;
        fail(t("Televizor tento zdroj neotevřel. Zkus jiný zdroj, nebo ho otevři v aplikaci Movly."));
      }, 24000);
      if (session.kind === "file" || (!skipNative && canNativeHls(video))) {
        el.setAttribute("data-engine", session.kind === "file" ? "file" : "native");
        diag("engine", { e: el.getAttribute("data-engine") });
        video.src = session.url;
        go();
        return;
      }
      if (!hasMediaSource()) { fail(t("Tento televizor neumí přehrát video ve formátu HLS (chybí nativní HLS i Media Source Extensions).")); return; }
      say(t("Načítám přehrávač…"));
      loadHls(function (Hls) {
        if (stopped || mine !== generation) return;
        if (!Hls || !Hls.isSupported()) { fail(t("Tento televizor neumí přehrát video ve formátu HLS (hls.js zde není podporováno).")); return; }
        el.setAttribute("data-engine", "hls.js");
        diag("engine", { e: "hls.js" });
        hls = new Hls({ enableWorker: false, startPosition: offset, maxBufferLength: 24 });
        hls.on(Hls.Events.ERROR, function (_event, data) {
          if (data) diag("hls-error", { type: data.type, fatal: Boolean(data.fatal), code: data.response && data.response.code });
          if (!data || !data.fatal || stopped || mine !== generation) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !hls.__recovered) { hls.__recovered = true; hls.recoverMediaError(); return; }
          fail(data.type === Hls.ErrorTypes.NETWORK_ERROR ? t("Poskytovatel nedovoluje přehrát tento stream v prohlížeči televizoru. Zkus jiný zdroj nebo aplikaci Movly.") : t("Televizor nedokáže toto video dekódovat. Zkus jiný zdroj."));
        });
        hls.on(Hls.Events.MANIFEST_PARSED, go);
        hls.loadSource(session.url);
        hls.attachMedia(video);
      });
    }
    function togglePlay() {
      if (!session || !errorBox.hidden) return;
      if (video.paused) { var p = video.play(); if (p && p.then) p.then(null, function () {}); }
      else video.pause();
      showOsd();
    }
    // Posun v přímém souboru zvládne přehrávač sám.
    function seek(delta) {
      if (!session || !loaded || !errorBox.hidden) return;
      seekTarget = Math.max(0, Math.min(duration() - 5, (seekTarget !== null ? seekTarget : position()) + delta));
      paint();
      showOsd(true);
      clearTimeout(seekTimer);
      seekTimer = setTimeout(function () {
        var target = seekTarget;
        seekTarget = null;
        video.currentTime = target;
        showOsd();
      }, 800);
    }
    video.addEventListener("timeupdate", paint, false);
    video.addEventListener("loadedmetadata", function () {
      if (loaded || !session) return;
      loaded = true;
      if (offset > 0 && session.kind === "file") { try { video.currentTime = offset; } catch (e) { /* ignorovat */ } }
      paint();
    }, false);
    function syncPlayButton() { playButton.textContent = video.paused ? t("Přehrát") : t("Pozastavit"); }
    video.addEventListener("play", syncPlayButton, false);
    video.addEventListener("pause", syncPlayButton, false);
    // Pohyb kurzoru ukáže ovládání; klik do obrazu přepne přehrávání.
    el.addEventListener("mousemove", function () { if (!stopped) showOsd(); }, false);
    video.addEventListener("click", function () { if (osd.className.indexOf("tv-osd-visible") < 0) showOsd(); else togglePlay(); }, false);
    // Diagnostika průběhu přehrávání (každých 5 s).
    var beat = setInterval(function () {
      if (stopped) { clearInterval(beat); return; }
      if (!session) return;
      var end = null;
      try { if (video.buffered.length) end = Math.round(video.buffered.end(video.buffered.length - 1) * 10) / 10; } catch (e) { end = "err"; }
      diag("beat", { ct: Math.round((video.currentTime || 0) * 10) / 10, buf: end, dur: isFinite(video.duration) ? Math.round(video.duration) : null, p: video.paused, rs: video.readyState, ns: video.networkState });
    }, 5000);
    video.addEventListener("playing", function () { say(""); showOsd(); diag("playing", { engine: el.getAttribute("data-engine"), w: video.videoWidth, h: video.videoHeight }); }, false);
    video.addEventListener("pause", function () { if (!stopped) showOsd(true); }, false);
    each(["loadstart", "loadedmetadata", "canplay", "stalled"], function (name) {
      video.addEventListener(name, function () { diag("video", { ev: name, rs: video.readyState, ns: video.networkState }); }, false);
    });
    video.addEventListener("waiting", function () { say(t("Načítám video…")); diag("video", { ev: "waiting", ct: video.currentTime }); }, false);
    video.addEventListener("ended", function () { saveHistory(); say(t("Konec videa. Stiskni Zpět.")); }, false);
    video.addEventListener("timeupdate", function () { if (video.currentTime > 1) played = true; }, false);
    video.addEventListener("error", function () {
      diag("video-error", { code: video.error ? video.error.code : null, engine: el.getAttribute("data-engine"), played: played });
      if (stopped || hls || !session) return;
      // Nativní HLS ohlášené přes canPlayType, které nic nepřehrálo: zkusit hls.js nad stejnou relací.
      if (el.getAttribute("data-engine") === "native" && !played && hasMediaSource()) {
        el.setAttribute("data-engine", "native-failed");
        video.removeAttribute("src");
        try { video.load(); } catch (e) { /* ignorovat */ }
        attach(generation, true);
        return;
      }
      fail(t("Televizor nemůže video přehrát (kód ") + (video.error ? video.error.code : "?") + t("). Zkus jiný zdroj."));
    }, false);
    var player = {
      stop: function () {
        if (stopped) return;
        saveHistory();
        stopped = true;
        clearTimeout(osdTimer);
        teardown();
        if (activePlayer === player) activePlayer = null;
      }
    };
    function unload() { player.stop(); }
    return {
      name: "player",
      el: el,
      onShow: function () {
        if (activePlayer && activePlayer !== player) activePlayer.stop();
        activePlayer = player;
        if (session || stopped) return;
        window.addEventListener("pagehide", unload, false);
        say(t("Zjišťuji, kde jsi skončil(a)…"));
        var path = "watch-history/position/" + t.id + (episode ? query({ season_number: episode.season_number, episode_number: episode.episode_number }) : "");
        api(path, { quiet: true }, function (err, pos) {
          if (stopped) return;
          if (err && err.status !== 404 && err.status !== 0) { if (handleAuthError(err)) return; }
          var at = !err && pos && pos.watch_status !== "completed" && pos.progress_seconds > 0 ? pos.progress_seconds : 0;
          if (sourceLabel) say(t("Připravuji video… ") + sourceLabel);
          start(at);
        });
      },
      onDestroy: function () { window.removeEventListener("pagehide", unload, false); player.stop(); },
      onKey: function (event) {
        var k = event.keyCode;
        if (!errorBox.hidden) {
          // Chybový panel: šipky a OK obsluhuje běžná navigace (tlačítka Zkusit znovu / Zpět).
          if (k === KEY.LEFT || k === KEY.RIGHT || k === KEY.UP || k === KEY.DOWN) {
            var buttons = errorBox.querySelectorAll("button"), i = 0;
            for (; i < buttons.length; i++) if (buttons[i] === document.activeElement) break;
            var next = buttons[(i + (k === KEY.LEFT || k === KEY.UP ? buttons.length - 1 : 1)) % buttons.length];
            if (next) next.focus();
            return true;
          }
          if (k === KEY.ENTER && document.activeElement && errorBox.contains(document.activeElement)) { document.activeElement.click(); return true; }
          return false;
        }
        if (k === KEY.ENTER || k === KEY.PLAY_PAUSE) { togglePlay(); return true; }
        if (k === KEY.PLAY) { if (video.paused) togglePlay(); return true; }
        if (k === KEY.PAUSE) { if (!video.paused) togglePlay(); return true; }
        if (k === KEY.LEFT || k === KEY.REWIND) { seek(-10); return true; }
        if (k === KEY.RIGHT || k === KEY.FORWARD) { seek(10); return true; }
        if (k === KEY.UP || k === KEY.DOWN) { showOsd(); return true; }
        if (k === KEY.STOP) { back(); return true; }
        return false;
      },
      // Pro testy a diagnostiku.
      state: function () { return { session: session ? session.kind : null, offset: offset, engine: el.getAttribute("data-engine") }; }
    };
  }

  window.addEventListener("online", function () { var screen = current(); if (screen && screen.onFocus) screen.onFocus(); }, false);
  window.addEventListener("blur", function () { var screen = current(); if (screen && screen.onBlur) screen.onBlur(); }, false);
  window.addEventListener("focus", function () { var screen = current(); if (screen && screen.onFocus) screen.onFocus(); }, false);
  document.addEventListener("visibilitychange", function () {
    var screen = current();
    if (!screen) return;
    if (document.hidden && screen.onBlur) screen.onBlur();
    else if (!document.hidden && screen.onFocus) screen.onFocus();
  }, false);

  // ---------- start ----------
  function boot() {
    var html = document.documentElement;
    if ((" " + html.className + " ").indexOf(" tv-lite ") < 0) html.className += " tv-lite";
    root = document.getElementById("tv-root");
    if (!root) { root = h("div", { id: "tv-root", className: "tv-root" }); document.body.appendChild(root); }
    document.title = "Movly TV";
    var loading = makeScreen("boot", [h("div", { className: "tv-center" }, [brand("h1", "tv-logo"), statusBox(t("Načítám…"))])]);
    resetTo(loading);
    api("session", { quiet: true }, function (err, data) {
      if (err) {
        if (err.status === 401 || contains(SESSION_CODES, err.code)) { resetTo(loginScreen()); return; }
        if (contains(PROFILE_CODES, err.code)) { resetTo(profilesScreen()); return; }
        var retry = button(t("Zkusit znovu"), boot, "tv-autofocus");
        resetTo(makeScreen("boot-error", [h("div", { className: "tv-center" }, [brand("h1", "tv-logo"), statusBox(err.message, "error"), retry])]));
        return;
      }
      searchEnvironment = data && /^[a-f0-9]{32}$/.test(data.environment || "") ? data.environment : "";
      account = data && data.account;
      profile = data && data.profile;
      resetTo(profile ? homeScreen() : profilesScreen());
    });
  }
  // Příznak pro legacy.js: až po úspěšném vykreslení první obrazovky, jinak zobrazí původní hlášku.
  function start() {
    diag("boot", { sw: window.screen.width, sh: window.screen.height, iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio || 1, media: mediaSupport() });
    boot();
    window.__movlyTvStarted = true;
  }
  window.MovlyTv = { current: function () { return current(); } };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, false);
})();

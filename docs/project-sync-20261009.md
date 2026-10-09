# Opravy evidované 9. 10. 2026

Součástí tohoto snapshotu je přenos TV diagnostiky do formuláře a administrace, zachování formuláře po výpadku a bezpečná chybová odpověď při omezení provideru. Lokální průchod přes přihlášení a PostgreSQL byl ověřen v hlavním projektu Movly. Nový webový player error dialog je nadále otevřený požadavek (shebincze/Movly#41).

Zdrojový main tohoto checkoutu obsahuje navíc 9 dřívějších lokálních commitů zpětné vazby. Upstream adela-rp/movly-web má pro dostupné účty pouze právo čtení; tento commit je připraven k PR přes fork. Produkční nasazení není součástí git synchronizace. GitHub Actions se nespouští.

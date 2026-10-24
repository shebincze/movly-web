"use strict";
// Prohlížečový regresní průchod auditu web-native-2026-10-24 (movly-web #225, zbytek P3 #226).
// Spouští lokální fixture (test-support/app-fixture.cjs, účet test / movly-test)
// a headless Chromium z playwright-core. Není součástí `npm test`, protože
// playwright-core není závislost repozitáře.
//
//   PLAYWRIGHT_CORE=/cesta/k/node_modules/playwright-core \
//   node test-support/web-native-e2e.cjs [--root <checkout>] [--shots <adresář>] [--prefix after]
//
// --root umožní pustit stejné kontroly proti jinému checkoutu (např. export
// origin/main) a doložit, že před opravou selhávají. Výstup je JSON se stavem
// každé kontroly; exit 1, pokud některá selhala.
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const root = path.resolve(option("--root", path.join(__dirname, "..")));
const shots = option("--shots", null);
const prefix = option("--prefix", "after");
const port = Number(option("--port", 8296));
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const base = `http://127.0.0.1:${port}`;
const results = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, ...(detail === undefined ? {} : { detail }) });
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.message || error).split("\n")[0] });
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
async function shot(page, name) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${prefix}-${name}.png`) });
}

function startFixture() {
  const child = spawn(process.execPath, [path.join(root, "test-support/app-fixture.cjs")], {
    cwd: root,
    env: { ...process.env, MOVLY_FIXTURE_PORT: String(port), MOVLY_FIXTURE_UPSTREAM_PORT: String(port + 1) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("fixture did not start")), 15000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("TEST FIXTURE ONLY")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on("exit", (code) => reject(new Error(`fixture exited ${code}`)));
  });
}

async function signIn(page) {
  await page.goto(`${base}/app/`);
  await page.getByLabel("Uživatelské jméno nebo e-mail").fill("test");
  await page.getByLabel("Heslo", { exact: true }).fill("movly-test");
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  await page.getByRole("button", { name: /Testovací profil/ }).first().click();
  await page.waitForFunction(() => document.body.dataset.route === "home");
}

// Detail je načtený (ne jen nadpis z paměti během načítání).
const detailReady = (page, title) => page.waitForFunction((name) => document.querySelector("#dialog-title")?.textContent === name && document.querySelector("#dialog .detail-layout"), title);
const dialogOpen = (page) => page.evaluate(() => document.querySelector("#dialog").open);
const dialogTitle = (page) => page.evaluate(() => document.querySelector("#dialog-title")?.textContent || "");
const hash = (page) => page.evaluate(() => location.hash);

(async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await signIn(page);
    await page.waitForSelector(".hero-content h1");
    await shot(page, "1280-home");

    await check("WEB-N02 odkaz Hledat má název i v kompaktní hlavičce (1024 px)", async () => {
      await page.setViewportSize({ width: 1024, height: 768 });
      const link = page.getByRole("link", { name: "Hledat", exact: true });
      assert((await link.count()) === 1 && (await link.isVisible()), "link Hledat nenalezen podle přístupného názvu");
      await shot(page, "1024-header");
      await page.setViewportSize({ width: 1280, height: 800 });
    });

    await check("WEB-N06 panel účtu je disclosure a zavře se po odchodu fokusu", async () => {
      const trigger = page.locator("#account-button");
      assert((await trigger.getAttribute("aria-haspopup")) === null, "aria-haspopup slibuje role=menu");
      await trigger.focus();
      await page.keyboard.press("Enter");
      assert(await page.locator("#account-menu").isVisible(), "panel se neotevřel");
      for (let i = 0; i < 40 && (await page.evaluate(() => !!document.activeElement.closest(".header-popover"))); i++)
        await page.keyboard.press("Tab");
      assert(await page.locator("#account-menu").isHidden(), "panel zůstal otevřený po odchodu fokusu");
      assert((await trigger.getAttribute("aria-expanded")) === "false", "aria-expanded nezůstalo true");
    });

    await page.goto(`${base}/app/#movies`);
    await page.waitForSelector(".poster-card");

    await check("WEB-N01 karta je odkaz s adresou detailu", async () => {
      const link = page.getByRole("link", { name: /Oppenheimer/ }).first();
      assert((await link.count()) === 1, "karta Oppenheimer není odkaz");
      return await link.getAttribute("href");
    });

    await check("WEB-N01/N04 otevření detailu zapíše adresu, titulek a zamkne scroll stránky", async () => {
      await page.getByRole("link", { name: /Oppenheimer/ }).first().click();
      await page.waitForFunction(() => document.title === "Movly — Oppenheimer" && document.querySelector(".detail-sheet h1, .detail-sheet .detail-title, .detail-sheet") !== null, null, { timeout: 5000 });
      assert((await hash(page)) === "#movies?title=2", `hash ${await hash(page)}`);
      const overflow = await page.evaluate(() => getComputedStyle(document.documentElement).overflow);
      assert(overflow === "hidden", `html overflow ${overflow}`);
      await shot(page, "1280-detail");
    });

    await check("WEB-N01 Zpět v prohlížeči zavře detail a vrátí fokus na kartu", async () => {
      await page.goBack();
      await page.waitForFunction(() => !document.querySelector("#dialog").open);
      assert((await hash(page)) === "#movies", `hash ${await hash(page)}`);
      assert(await page.evaluate(() => document.body.dataset.route === "movies"), "stránka se změnila");
      const focused = await page.evaluate(() => document.activeElement.closest(".poster-card")?.textContent || document.activeElement.outerHTML.slice(0, 60));
      assert(/Oppenheimer/.test(focused), `fokus: ${focused}`);
    });

    await check("WEB-N01 Vpřed detail znovu otevře", async () => {
      await page.goForward();
      await detailReady(page, "Oppenheimer");
    });

    await check("WEB-N14 zavření výběru zdroje i osoby vrátí na detail, zavření detailu na stránku", async () => {
      await page.locator("#dialog .button.primary", { hasText: "Přehrát" }).click();
      await page.waitForFunction(() => document.querySelector("#dialog-title")?.textContent === "Vyber zdroj");
      await page.keyboard.press("Escape");
      await detailReady(page, "Oppenheimer");
      assert(await dialogOpen(page), "detail se nevrátil");
      assert((await hash(page)) === "#movies?title=2", "adresa detailu zmizela");
      await page.locator("#dialog .cast-person").first().click();
      await page.waitForFunction(() => document.querySelector("#dialog .person-sheet") && document.querySelector("#dialog-title")?.textContent !== "Oppenheimer");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.querySelector("#dialog-title")?.textContent === "Oppenheimer" && !document.querySelector("#dialog .person-sheet"));
      await detailReady(page, "Oppenheimer");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("#dialog").open);
      await page.waitForFunction(() => location.hash === "#movies");
      assert((await page.title()) === "Movly — Filmy", `title ${await page.title()}`);
    });

    await check("WEB-N01 sdílený odkaz otevře detail nad stránkou", async () => {
      const shared = await context.newPage();
      await shared.goto(`${base}/app/#movies?title=3`);
      await shared.waitForFunction(() => document.querySelector("#dialog-title")?.textContent === "Interstellar", null, { timeout: 10000 });
      assert(await shared.evaluate(() => document.body.dataset.route === "movies"), "pod detailem není stránka Filmy");
      await shared.locator("#dialog .dialog-close").click();
      await shared.waitForFunction(() => location.hash === "#movies");
      await shared.close();
    });

    await check("WEB-N05 klepnutí na pozadí zavře dialog", async () => {
      await page.locator("#account-button").click();
      await page.getByRole("button", { name: "Nastavení" }).click();
      await page.waitForFunction(() => document.querySelector("#dialog").open);
      await page.mouse.click(4, 4);
      await page.waitForFunction(() => !document.querySelector("#dialog").open, null, { timeout: 3000 });
    });

    await check("WEB-N07 po navigaci je fokus na nadpisu nové stránky", async () => {
      await page.getByRole("navigation", { name: "Hlavní navigace" }).getByRole("link", { name: "Seriály" }).click();
      await page.waitForFunction(() => document.body.dataset.route === "series" && document.activeElement?.tagName === "H1", null, { timeout: 5000 });
    });

    await check("WEB-N08 Hledat přesune fokus do pole hledání", async () => {
      await page.getByRole("link", { name: "Hledat", exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.id === "search-q", null, { timeout: 5000 });
    });

    await check("WEB-N09 obě pole rozsahu mají vlastní název ve skupině", async () => {
      const group = page.getByRole("group", { name: "Rok vydání" });
      assert((await group.getByRole("spinbutton", { name: "od", exact: true }).count()) === 1, "pole od");
      assert((await group.getByRole("spinbutton", { name: "do", exact: true }).count()) === 1, "pole do bez názvu");
    });

    await check("WEB-N10 tečky karuselu mají cíl ≥ 24 px bez překryvu", async () => {
      await page.goto(`${base}/app/#home`);
      await page.waitForSelector(".hero-dot");
      const geometry = await page.evaluate(() => {
        const dots = [...document.querySelectorAll(".hero-dot")];
        const before = getComputedStyle(dots[1], "::before");
        const a = dots[1].getBoundingClientRect(), b = dots[2].getBoundingClientRect();
        const gap = parseFloat(getComputedStyle(dots[1].parentElement).columnGap);
        return { width: a.width - parseFloat(before.left) - parseFloat(before.right), height: a.height - parseFloat(before.top) - parseFloat(before.bottom),
          spacing: b.left - a.right, gap, overhang: -parseFloat(before.right), role: dots[1].parentElement.getAttribute("role") };
      });
      assert(geometry.width >= 24 && geometry.height >= 24, JSON.stringify(geometry));
      assert(geometry.overhang * 2 <= geometry.spacing, `překryv cílů ${JSON.stringify(geometry)}`);
      assert(geometry.role === "group", "skupina teček bez role");
      return geometry;
    });

    await check("prefers-reduced-motion vypne přechody", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const duration = await page.evaluate(() => getComputedStyle(document.querySelector(".poster-frame")).transitionDuration);
      await page.emulateMedia({ reducedMotion: null });
      assert(duration === "0s", duration);
    });

    for (const [width, height] of [[360, 780], [768, 1024], [1920, 1080]]) {
      await check(`bez vodorovného posunu stránky (${width} px)`, async () => {
        await page.setViewportSize({ width, height });
        await page.goto(`${base}/app/#home`);
        await page.waitForSelector(".hero-content h1");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        await shot(page, `${width}-home`);
        assert(overflow <= 0, `přetéká o ${overflow} px`);
      });
    }
    await check("WEB-N04 mobilní detail neposouvá stránku pod sebou (360 px)", async () => {
      await page.setViewportSize({ width: 360, height: 780 });
      await page.goto(`${base}/app/#movies?title=1`);
      await page.waitForFunction(() => document.querySelector("#dialog-title")?.textContent === "Duna: Část druhá");
      await page.mouse.move(180, 500);
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(400);
      const pageScroll = await page.evaluate(() => scrollY);
      await shot(page, "360-detail");
      assert(pageScroll === 0, `stránka pod dialogem se posunula o ${pageScroll}`);
    });

    // #226 – zbytek P3: řady, karusel, písmo prohlížeče.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${base}/app/#home`);
    await page.waitForSelector(".hero-content h1");
    await check("WEB-N26 karusel je region s pořadím snímku a změnu ohlásí", async () => {
      const state = () => page.evaluate(() => {
        const section = document.querySelector(".home-carousel");
        const slide = section?.querySelector(".home-carousel-slide > *");
        return { role: section?.getAttribute("aria-roledescription"), label: section?.getAttribute("aria-label"),
          live: section?.querySelector(".home-carousel-slide")?.getAttribute("aria-live"),
          slideRole: slide?.getAttribute("role"), slideKind: slide?.getAttribute("aria-roledescription"), position: slide?.getAttribute("aria-label") };
      });
      const before = await state();
      assert(before.role === "karusel" && before.label === "Doporučené tituly", JSON.stringify(before));
      assert(before.live === "polite" && before.slideRole === "group" && before.slideKind === "snímek", JSON.stringify(before));
      assert(/^1 z \d+$/.test(before.position || ""), `pořadí ${before.position}`);
      await page.locator(".hero-controls .button[aria-label='Další']").click();
      const after = await state();
      assert(/^2 z \d+$/.test(after.position || ""), `po Další ${after.position}`);
      return { before: before.position, after: after.position };
    });
    await check("WEB-N25 myš posune řadu plakátů tlačítkem, Tab ho přeskočí", async () => {
      // Fixture má v řadě 3–4 karty, které se na 1280 px vejdou; přetečení vyvolá užší okno
      // se stejnou myší (hover: hover, pointer: fine). Na 1280 px se řada chová stejně.
      await page.setViewportSize({ width: 720, height: 800 });
      await page.goto(`${base}/app/#home`);
      await page.waitForSelector(".rail-viewport .poster-card");
      const rails = await page.evaluate(() => [...document.querySelectorAll(".poster-rail")].map((node) => ({ cards: node.children.length, overflow: node.scrollWidth - node.clientWidth })));
      const index = await page.evaluate(() => [...document.querySelectorAll(".rail-viewport")].findIndex((node) => {
        const track = node.querySelector(".poster-rail");
        return track.scrollWidth - track.clientWidth > 0;
      }));
      assert(index >= 0, `žádná řada nepřetéká: ${JSON.stringify(rails)}`);
      const viewport = page.locator(".rail-viewport").nth(index);
      await viewport.scrollIntoViewIfNeeded();
      const track = viewport.locator(".poster-rail");
      await viewport.hover();
      const next = viewport.locator(".rail-page.next");
      await page.waitForFunction((node) => getComputedStyle(node).opacity === "1", await next.elementHandle());
      assert((await viewport.locator(".rail-page.prev").isHidden()), "na začátku je vidět Zpět");
      assert((await next.getAttribute("tabindex")) === "-1", "tlačítko je v pořadí Tab");
      await shot(page, "720-rail-paging");
      const start = await track.evaluate((node) => node.scrollLeft);
      await next.click();
      await page.waitForFunction((node) => node.scrollLeft > 0, await track.elementHandle(), { timeout: 3000 });
      await page.waitForTimeout(900);
      const { moved, expected, nextHidden } = await track.evaluate((node) => ({
        moved: Math.round(node.scrollLeft),
        expected: Math.round(Math.min(node.clientWidth * 0.9, node.scrollWidth - node.clientWidth)),
        nextHidden: node.parentElement.querySelector(".rail-page.next").hidden,
      }));
      assert(Math.abs(moved - expected) <= 2, `posun ${moved}, čekáno ${expected}`);
      if (expected === Math.round(await track.evaluate((node) => node.scrollWidth - node.clientWidth))) assert(nextHidden, "na konci řady zůstalo Další");
      await page.waitForFunction((node) => !node.querySelector(".rail-page.prev").hidden, await viewport.elementHandle());
      await page.setViewportSize({ width: 1280, height: 800 });
      return { start, moved, expected, nextHidden, rails };
    });
    await check("WEB-N25 dotykové zařízení tlačítka stránkování nevidí", async () => {
      const touch = await browser.newContext({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });
      const mobile = await touch.newPage();
      await signIn(mobile);
      await mobile.waitForSelector(".rail-viewport .poster-card");
      const display = await mobile.evaluate(() => getComputedStyle(document.querySelector(".rail-page.next")).display);
      await touch.close();
      assert(display === "none", `display ${display}`);
    });
    await check("WEB-N24 písmo prohlížeče 20 px zvětší text a rozvržení nepřeteče (360 i 1280 px)", async () => {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Page.setFontSizes", { fontSizes: { standard: 20, fixed: 16 } });
      const sizes = {};
      for (const [width, height] of [[1280, 800], [360, 780]]) {
        await page.setViewportSize({ width, height });
        for (const route of ["#home", "#movies"]) {
          await page.goto(`${base}/app/${route}`);
          await page.waitForSelector(".poster-card");
          const metric = await page.evaluate(() => ({
            root: getComputedStyle(document.documentElement).fontSize,
            poster: getComputedStyle(document.querySelector(".poster-title, .poster-card")).fontSize,
            overflow: document.documentElement.scrollWidth - innerWidth,
          }));
          sizes[`${width}${route}`] = metric;
          assert(metric.root === "20px", `${width}${route}: kořen ${metric.root}`);
          assert(metric.overflow <= 0, `${width}${route}: přetéká o ${metric.overflow} px`);
        }
        await shot(page, `${width}-font20-movies`);
      }
      await cdp.send("Page.setFontSizes", { fontSizes: { standard: 16, fixed: 13 } });
      await cdp.detach();
      return sizes;
    });
    await context.close();

    // Kořenové stránky: bez skriptů z CDN, funkční bez JavaScriptu, FAQ z klávesnice.
    const landing = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const external = [];
    landing.on("request", (request) => {
      const url = new URL(request.url());
      if (url.hostname !== "127.0.0.1" && request.resourceType() === "script") external.push(url.href);
    });
    // Nedostupné CDN (firemní síť, blokátor, výpadek unpkg.com) nesmí stránku vyprázdnit.
    await landing.route(/unpkg\.com/, (route) => route.abort());
    const home = await landing.newPage();
    await home.goto(`${base}/`, { waitUntil: "networkidle" });
    await check("WEB-N03 úvodní stránka nenačítá skripty z cizích CDN", async () => {
      assert(external.length === 0, external.join(", "));
    });
    await check("WEB-N03 úvodní stránka funguje i při nedostupném unpkg.com", async () => {
      await home.waitForTimeout(1500);
      assert(await home.getByRole("heading", { level: 1 }).isVisible(), "úvodní stránka bez H1");
      assert((await home.locator("#mvRuntimeNotice").count()) === 0, "hláška o nenačtené interaktivní části");
    });
    await check("WEB-N03 FAQ je nativní <details> ovladatelné klávesnicí", async () => {
      const summary = home.locator("details[name=faq] > summary").first();
      assert((await summary.count()) === 1, "FAQ není <details>/<summary>");
      await summary.focus();
      await home.keyboard.press("Enter");
      assert(await home.locator("details[name=faq]").first().evaluate((node) => node.open), "Enter FAQ neotevřel");
      await summary.scrollIntoViewIfNeeded();
      await shot(home, "1280-landing-faq");
    });
    await check("WEB-N13 přihlášení na úvodní stránce má propojené popisky", async () => {
      assert((await home.getByLabel("Heslo", { exact: true }).getAttribute("id")) === "mvPass", "Heslo bez popisku");
      assert((await home.getByLabel("Uživatelské jméno nebo e-mail").getAttribute("id")) === "mvUser", "jméno bez popisku");
    });
    await check("WEB-N12 kořenové stránky mají tmavé systémové schéma", async () => {
      for (const file of ["/", "/privacy.html", "/delete-account.html", "/en/index.html", "/en/privacy.html", "/activate", "/devices"]) {
        await home.goto(`${base}${file}`);
        const scheme = await home.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
        assert(scheme === "dark", `${file}: ${scheme}`);
      }
    });
    await home.setViewportSize({ width: 360, height: 780 });
    await home.goto(`${base}/`);
    await home.waitForTimeout(600);
    await shot(home, "360-landing-cdn-blocked");
    await landing.close();

    // #226 – CSP kořenových stránek, mobilní nabídka a zastavení animací.
    const strict = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await strict.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`));
    });
    const csp = await strict.newPage();
    const consoleCsp = [];
    csp.on("console", (message) => { if (/Refused to|Content Security Policy.*(?:blocked|violat)/i.test(message.text())) consoleCsp.push(message.text().slice(0, 160)); });
    await check("WEB-N30 kořenové stránky mají CSP se script-src 'self' a nic neporušují", async () => {
      const seen = {};
      for (const file of ["/", "/privacy.html", "/delete-account.html", "/en/index.html", "/activate", "/devices", "/party/ABCDEF"]) {
        const response = await csp.goto(`${base}${file}`, { waitUntil: "networkidle" });
        const policy = response.headers()["content-security-policy"] || "";
        assert(/(?:^|;)\s*script-src 'self'(?:;|$)/.test(policy), `${file}: CSP ${policy || "chybí"}`);
        const violations = await csp.evaluate(() => window.__cspViolations);
        assert(violations.length === 0, `${file}: ${violations.join(", ")}`);
        seen[file] = policy.length;
      }
      assert(consoleCsp.length === 0, consoleCsp.join(" | "));
      assert((await csp.locator("#code").textContent()) === "ABCDEF", "skript pozvánky party neběží");
      return seen;
    });
    await check("WEB-N30 přihlášení a instalačky na úvodní stránce (cs i en) fungují pod CSP", async () => {
      // Fixture účet nesplňuje serverovou kontrolu účtu pro /api/auth/* (chybí email, coins, premium_until),
      // proto odpovědi API úvodní stránky podvrhneme ve stejném originu. Stránka i CSP jdou ze serveru.
      const calls = [];
      const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      await csp.route("**/api/auth/login", (route) => { calls.push("login"); route.fulfill(json({ token: "e2e-mock-token", account: { username: "e2e", displayName: "E2E účet", email: null }, hasDownloadAccess: true })); });
      await csp.route("**/api/downloads", (route) => { calls.push("downloads"); route.fulfill(json({ downloads: [{ id: "windows-x64", available: true, title: "Movly pro Windows", fileName: "movly-e2e.exe", sizeLabel: "1 MB" }] })); });
      await csp.route("**/api/downloads/windows-x64/link", (route) => { calls.push("link"); route.fulfill(json({ url: "/#stazeno" })); });
      for (const [file, user, password, submit] of [["/#stahnout", "#mvUser", "#mvPass", "#mvLoginBtn"], ["/en/index.html#download", "#movly-login-user", "#movly-login-password", "#movly-login-button"]]) {
        await csp.goto(`${base}${file}`, { waitUntil: "networkidle" });
        await csp.evaluate(() => localStorage.clear());
        await csp.locator(user).fill("e2e");
        await csp.locator(password).fill("e2e-mock");
        await csp.locator(submit).click();
        const download = csp.locator("[data-download-id='windows-x64']");
        await download.waitFor({ timeout: 8000 });
        await download.scrollIntoViewIfNeeded();
        if (file.startsWith("/#")) await shot(csp, "1280-landing-login-csp");
        await download.click();
        await csp.waitForFunction(() => location.hash === "#stazeno", null, { timeout: 5000 });
        const violations = await csp.evaluate(() => window.__cspViolations);
        assert(violations.length === 0, `${file}: ${violations.join(", ")}`);
      }
      await csp.unrouteAll();
      await csp.evaluate(() => localStorage.clear());
      assert(calls.join(",") === "login,downloads,link,login,downloads,link", `volání ${calls}`);
      return calls;
    });
    await check("WEB-N28 tlačítko Pozastavit animace zastaví pásy plakátů a zapamatuje si volbu", async () => {
      await csp.goto(`${base}/`);
      const toggle = csp.getByRole("button", { name: "Pozastavit animace" });
      await toggle.scrollIntoViewIfNeeded();
      assert(await toggle.isVisible(), "tlačítko není vidět");
      const running = await csp.evaluate(() => getComputedStyle(document.querySelector("[data-marquee]")).animationPlayState);
      await toggle.click();
      const paused = await csp.evaluate(() => [...document.querySelectorAll("[data-marquee]")].map((node) => getComputedStyle(node).animationPlayState));
      assert(running === "running" && paused.every((state) => state === "paused"), `${running} → ${paused}`);
      assert(await csp.getByRole("button", { name: "Spustit animace" }).isVisible(), "popisek se nezměnil");
      await csp.waitForTimeout(1200);
      await shot(csp, "1280-landing-motion-paused");
      await csp.reload();
      const remembered = await csp.evaluate(() => getComputedStyle(document.querySelector("[data-marquee]")).animationPlayState);
      await csp.getByRole("button", { name: "Spustit animace" }).click();
      assert(remembered === "paused", `po obnovení ${remembered}`);
    });
    await check("WEB-N27 úvodní stránka má na telefonu nabídku navigace (cs i en)", async () => {
      await csp.setViewportSize({ width: 360, height: 780 });
      const result = {};
      for (const [file, label, link, target] of [["/", "Nabídka", "FAQ", "#faq"], ["/en/index.html", "Menu", "FAQ", "#faq"]]) {
        await csp.goto(`${base}${file}`, { waitUntil: "networkidle" });
        const summary = csp.locator("summary", { hasText: label });
        assert(await summary.isVisible(), `${file}: nabídka není vidět`);
        const overflow = await csp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert(overflow <= 0, `${file}: přetéká o ${overflow} px`);
        await summary.focus();
        await csp.keyboard.press("Enter");
        const panelLink = csp.locator("details[open]").getByRole("link", { name: link, exact: true });
        assert(await panelLink.isVisible(), `${file}: odkaz ${link} v nabídce není vidět`);
        await shot(csp, `360-${file === "/" ? "landing" : "en-landing"}-menu`);
        await csp.keyboard.press("Escape");
        assert(!(await csp.locator("details[open]").filter({ has: summary }).count()), `${file}: Escape nabídku nezavřel`);
        await summary.click();
        await panelLink.click();
        await csp.waitForFunction((hash) => location.hash === hash, target);
        assert(!(await csp.locator("details[open]").filter({ has: summary }).count()), `${file}: po výběru zůstala otevřená`);
        result[file] = overflow;
      }
      await csp.setViewportSize({ width: 1280, height: 800 });
      await csp.goto(`${base}/`);
      assert(await csp.locator("summary", { hasText: "Nabídka" }).isHidden(), "na desktopu je nabídka navíc");
      return result;
    });
    await strict.close();

    const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
    const plain = await noScript.newPage();
    await check("WEB-N03 zásady soukromí a úvodní stránka jsou čitelné bez JavaScriptu", async () => {
      await plain.goto(`${base}/privacy.html`);
      assert(await plain.getByRole("main").getByRole("heading", { level: 1 }).isVisible(), "privacy bez <main>/H1");
      await plain.goto(`${base}/delete-account.html`);
      assert(await plain.getByRole("main").getByRole("heading", { level: 1 }).isVisible(), "smazání účtu bez <main>/H1");
      await plain.goto(`${base}/`);
      assert(await plain.getByRole("heading", { level: 1 }).isVisible(), "úvodní stránka bez H1");
      await shot(plain, "1280-landing-nojs");
    });
    await noScript.close();
  } finally {
    await browser.close();
    fixture.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ root, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(2);
});

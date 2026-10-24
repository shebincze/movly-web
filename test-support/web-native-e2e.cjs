"use strict";
// Prohlížečový regresní průchod auditu web-native-2026-10-24 (movly-web #225).
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

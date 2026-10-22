import { translateUI } from "./i18n.js";
import { api, array } from "./api.js";
import { el, button, loading, errorBox, showDialog } from "./ui.js";

const lang = () => document.documentElement.lang || "cs";
const formatDate = (value) => value.toLocaleDateString(lang());
const formatCoins = (value) => value.toLocaleString(lang());
// 1–4 mince, 0 a 5+ mincí (cs/sk); EN překlad obou tvarů je "coins".
const coinWord = (n) => translateUI(n >= 1 && n <= 4 ? "mince" : "mincí");
const coins = (n) => `${formatCoins(n)} ${coinWord(n)}`;
const daysLeft = (n) =>
  n === 1
    ? translateUI("Zbývá 1 den")
    : n >= 2 && n <= 4
      ? translateUI("Zbývají {0} dny", n)
      : translateUI("Zbývá {0} dní", n);
const svg = (paths, attrs = {}) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", ...attrs })) node.setAttribute(k, v);
  for (const d of paths) {
    const p = document.createElementNS(node.namespaceURI, "path");
    p.setAttribute("d", d);
    node.append(p);
  }
  return node;
};
const crownIcon = () => svg(["m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z"], { fill: "currentColor", stroke: "none" });
const coinIcon = () => svg(["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18", "M12 7v10M9 9.5h4.5a2 2 0 0 1 0 4H9"]);
const checkIcon = () => svg(["m5 12 5 5 9-10"], { "stroke-width": "2.6" });

function validDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Zůstatek mincí a platnost Premium aktuálního účtu. Zdroj: GET /api/app/session
// (account.coins, account.premiumUntil); hlavička ho může volat i po události
// "movly-premium-changed", kterou stránka vyšle po úspěšném nákupu.
export async function premiumSummary(signal) {
  const { account } = await api("session", { signal });
  if (!account || !Number.isSafeInteger(account.coins) || account.coins < 0)
    throw new Error(translateUI("Server vrátil neplatný zůstatek mincí."));
  const premiumUntil = validDate(account.premiumUntil);
  return {
    coins: account.coins,
    premiumUntil,
    premiumActive: !!premiumUntil && premiumUntil.getTime() > Date.now(),
    purchaseEnabled: account.premiumPurchaseEnabled === true && account.isFromLight !== true,
  };
}

function statusCards(summary) {
  const remaining = summary.premiumActive
    ? Math.max(1, Math.ceil((summary.premiumUntil.getTime() - Date.now()) / 86_400_000))
    : 0;
  const premiumCard = el(
    "div",
    { class: `premium-card premium-status ${summary.premiumActive ? "active" : ""}` },
    el("span", { class: "premium-card-icon premium-crown" }, crownIcon()),
    el(
      "span",
      { class: "premium-card-text" },
      el("span", { class: "premium-eyebrow" }, translateUI(summary.premiumActive ? "Premium aktivní" : "Premium")),
      el(
        "span",
        { class: "premium-card-value" },
        summary.premiumActive
          ? translateUI("do {0}", formatDate(summary.premiumUntil))
          : summary.premiumUntil
            ? translateUI("Vypršelo {0}", formatDate(summary.premiumUntil))
            : translateUI("Neaktivní"),
      ),
      summary.premiumActive ? el("span", { class: "premium-card-note" }, daysLeft(remaining)) : null,
    ),
  );
  const coinCard = el(
    "div",
    { class: "premium-card premium-balance" },
    el("span", { class: "premium-card-icon premium-coin" }, coinIcon()),
    el(
      "span",
      { class: "premium-card-text" },
      el("span", { class: "premium-eyebrow" }, translateUI("Zůstatek mincí")),
      el("span", { class: "premium-balance-value" }, formatCoins(summary.coins)),
    ),
  );
  return el("div", { class: "premium-status-row" }, premiumCard, coinCard);
}

function validatePlans(plans) {
  for (const plan of plans)
    if (
      !Number.isSafeInteger(plan.id) ||
      plan.id <= 0 ||
      typeof plan.name !== "string" ||
      !plan.name.trim() ||
      !Number.isSafeInteger(plan.duration_days) ||
      plan.duration_days <= 0 ||
      !Number.isSafeInteger(plan.price_coins) ||
      plan.price_coins < 0
    )
      throw new Error(translateUI("Server vrátil neplatný plán Premium."));
  return plans;
}

function shortfallDialog(plan, balance) {
  const missing = plan.price_coins - balance;
  const ratio = plan.price_coins ? Math.min(100, Math.round((balance / plan.price_coins) * 100)) : 100;
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body premium-dialog premium-shortfall", role: "alertdialog", "aria-labelledby": "dialog-title" },
      el("h2", { id: "dialog-title" }, translateUI("Nemáš dost mincí")),
      el(
        "p",
        {},
        translateUI("{0} stojí {1}. Máš {2}, chybí ti ", plan.name, coins(plan.price_coins), formatCoins(balance)),
        el("strong", {}, coins(missing)),
        ".",
      ),
      el(
        "div",
        { class: "premium-meter", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(ratio), "aria-label": translateUI("Nasbírané mince") },
        el("span", { style: `width: ${ratio}%` }),
      ),
      el("div", { class: "premium-dialog-actions" }, button(translateUI("Vybrat jiný plán"), () => dialog.close(), "secondary")),
    ),
  );
}

function successDialog(summary) {
  showDialog(
    el(
      "div",
      { class: "dialog-body premium-dialog premium-success", role: "status" },
      el("span", { class: "premium-success-icon" }, checkIcon()),
      el("h2", { id: "dialog-title" }, translateUI("Premium prodlouženo")),
      el(
        "p",
        {},
        [
          summary.premiumUntil ? translateUI("Platí do {0}", formatDate(summary.premiumUntil)) : null,
          translateUI("zůstatek {0}", coins(summary.coins)),
        ]
          .filter(Boolean)
          .join(" · "),
      ),
      el(
        "a",
        { href: "#home", class: "button accent", onClick: () => document.querySelector("#dialog").close() },
        translateUI("Pokračovat ve sledování"),
      ),
    ),
  );
}

export async function premium(signal) {
  const node = el("div", { class: "page premium-page" }, el("h1", {}, translateUI("Premium")), loading());
  const rerender = async () => {
    const updated = await premium(signal);
    node.replaceChildren(...updated.childNodes);
  };
  try {
    const { account, profile } = await api("session", { signal });
    const expectedOwner = account.id && profile?.id ? { accountId: account.id, profileId: profile.id } : null;
    const summary = {
      coins: Number.isSafeInteger(account.coins) && account.coins >= 0 ? account.coins : 0,
      premiumUntil: validDate(account.premiumUntil),
    };
    summary.premiumActive = !!summary.premiumUntil && summary.premiumUntil.getTime() > Date.now();
    if (!account.premiumPurchaseEnabled || account.isFromLight) {
      node.replaceChildren(
        el("h1", { class: "premium-title" }, translateUI("Premium")),
        statusCards(summary),
        el("p", { class: "premium-unavailable" }, translateUI("Nákup Premium není pro tento účet dostupný.")),
      );
      return node;
    }
    const plans = validatePlans(array(await api("auth/premium/plans", { signal })));
    // Úspora se počítá vůči ceně za den nejkratšího plánu; jiná data API nedává.
    const base = plans.reduce((min, plan) => (!min || plan.duration_days < min.duration_days ? plan : min), null);
    const grid = el("div", { class: "premium-plans" });
    const section = el(
      "section",
      { class: "premium-plans-section", "aria-labelledby": "premium-plans-title" },
      el("h1", { id: "premium-plans-title", class: "premium-title" }, translateUI("Prodloužit Premium")),
      grid,
    );
    node.replaceChildren(statusCards(summary), section);
    const buttons = [];
    for (const plan of plans) {
      const affordable = summary.coins >= plan.price_coins;
      const saving = base && plan !== base ? Math.round((base.price_coins / base.duration_days) * plan.duration_days - plan.price_coins) : 0;
      const note = [
        translateUI("Prodlouží o {0} dní", plan.duration_days),
        saving > 0 ? translateUI("ušetříš {0}", coins(saving)) : null,
        !affordable ? translateUI("chybí {0}", coins(plan.price_coins - summary.coins)) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const buy = button(
        affordable ? translateUI("Koupit") : translateUI("Chybí {0}", coins(plan.price_coins - summary.coins)),
        () => {
          if (!affordable) return shortfallDialog(plan, summary.coins);
          const failure = el("div", { class: "premium-failure" });
          const cancel = button(translateUI("Zrušit"), () => document.querySelector("#dialog").close(), "secondary");
          const submit = button(
            translateUI("Koupit za {0}", formatCoins(plan.price_coins)),
            async () => {
              submit.disabled = true;
              cancel.disabled = true;
              for (const control of buttons) control.disabled = true;
              try {
                if (!expectedOwner) throw new Error(translateUI("Vyber profil před nákupem Premium."));
                const result = await api("auth/premium/purchase", { method: "POST", body: { plan_id: plan.id }, expectedOwner });
                if (result.success !== true) throw new Error(translateUI("Server nepotvrdil nákup Premium."));
                document.querySelector("#dialog").close();
                window.dispatchEvent(new CustomEvent("movly-premium-changed"));
                await rerender();
                try {
                  successDialog(await premiumSummary(signal));
                } catch {
                  successDialog({ coins: summary.coins - plan.price_coins, premiumUntil: null });
                }
              } catch (error) {
                // A timeout may follow a completed debit. Never resubmit this intent.
                for (const control of node.querySelectorAll("button")) control.disabled = true;
                cancel.disabled = false;
                failure.replaceChildren(
                  errorBox(error),
                  el("p", {}, translateUI("Výsledek nákupu ověř v účtu před dalším nákupem.")),
                  button(translateUI("Ověřit stav účtu"), async () => {
                    document.querySelector("#dialog").close();
                    window.dispatchEvent(new CustomEvent("movly-premium-changed"));
                    await rerender();
                  }),
                );
              }
            },
            "accent",
          );
          showDialog(
            el(
              "div",
              { class: "dialog-body premium-dialog" },
              el("h2", { id: "dialog-title" }, translateUI("Koupit {0} Premium?", plan.name)),
              el(
                "dl",
                { class: "premium-summary" },
                el("dt", {}, translateUI("Cena")),
                el("dd", {}, coins(plan.price_coins)),
                el("dt", {}, translateUI("Prodloužení")),
                el("dd", {}, translateUI("{0} dní", plan.duration_days)),
                el("dt", {}, translateUI("Zůstatek po nákupu")),
                el("dd", {}, coins(summary.coins - plan.price_coins)),
              ),
              failure,
              el("div", { class: "premium-dialog-actions" }, cancel, submit),
            ),
          );
        },
        affordable ? "accent" : "secondary",
      );
      if (!affordable) buy.setAttribute("aria-haspopup", "dialog");
      buttons.push(buy);
      grid.append(
        el(
          "article",
          { class: `premium-plan ${affordable ? "" : "unaffordable"}` },
          el("h2", { class: "premium-plan-name" }, plan.name),
          el(
            "p",
            { class: "premium-price" },
            el("span", { class: "premium-price-value" }, formatCoins(plan.price_coins)),
            el("span", {}, coinWord(plan.price_coins)),
          ),
          el("p", { class: "premium-plan-note" }, note),
          buy,
        ),
      );
    }
    if (!plans.length) grid.append(el("p", { class: "premium-unavailable" }, translateUI("Žádný plán Premium není dostupný.")));
  } catch (error) {
    node.replaceChildren(el("h1", {}, translateUI("Premium")), errorBox(error, () => rerender()));
  }
  return node;
}

import { translateUI } from "./i18n.js";
import { api, array } from "./api.js";
import { el, button, loading, errorBox, toast } from "./ui.js";
export async function premium(signal) {
  const node = el(
    "div",
    { class: "page" },
    el("h1", {}, translateUI("Premium")),
    loading(),
  );
  try {
    const { account, profile } = await api("session", { signal });
    const expectedOwner =
      account.id && profile?.id
        ? { accountId: account.id, profileId: profile.id }
        : null;
    const summary = el(
      "p",
      {},
      translateUI("Coiny: ") +
        account.coins +
        (account.premiumUntil
          ? translateUI(" · Premium do ") +
            new Date(account.premiumUntil).toLocaleDateString(
              document.documentElement.lang,
            )
          : ""),
    );
    node.replaceChildren(el("h1", {}, translateUI("Premium")), summary);
    if (!account.premiumPurchaseEnabled || account.isFromLight) {
      node.append(
        el("p", {}, translateUI("Nákup Premium není pro tento účet dostupný.")),
      );
      return node;
    }
    const plans = array(await api("auth/premium/plans", { signal }));
    for (const plan of plans) {
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
      const row = el(
        "div",
        { class: "source-row" },
        el(
          "div",
          {},
          el("strong", {}, plan.name),
          el(
            "p",
            {},
            plan.duration_days +
              translateUI(" dní · ") +
              plan.price_coins +
              translateUI(" coinů"),
          ),
        ),
      );
      const buy = button(translateUI("Vybrat plán"), () => {
        const confirmation = el(
          "div",
          { class: "dialog-body" },
          el(
            "h2",
            { id: "dialog-title" },
            translateUI("Potvrdit nákup Premium"),
          ),
          el(
            "p",
            {},
            plan.name + " · " + plan.price_coins + translateUI(" coinů"),
          ),
        );
        const submit = button(
          translateUI("Zaplatit coiny"),
          async () => {
            submit.disabled = true;
            buy.disabled = true;
            try {
              if (!expectedOwner)
                throw new Error(
                  translateUI("Vyber profil před nákupem Premium."),
                );
              const result = await api("auth/premium/purchase", {
                method: "POST",
                body: { plan_id: plan.id },
                expectedOwner,
              });
              if (result.success !== true)
                throw new Error(
                  translateUI("Server nepotvrdil nákup Premium."),
                );
              document.querySelector("#dialog").close();
              const updated = await premium(signal);
              node.replaceChildren(...updated.childNodes);
              toast(translateUI("Premium je aktivní."));
            } catch (error) {
              // A timeout may follow a completed debit. Never resubmit this intent.
              for (const control of node.querySelectorAll("button"))
                control.disabled = true;
              confirmation.append(
                errorBox(error),
                el(
                  "p",
                  {},
                  translateUI(
                    "Výsledek nákupu ověř v účtu před dalším nákupem.",
                  ),
                ),
                button(translateUI("Ověřit stav účtu"), async () => {
                  document.querySelector("#dialog").close();
                  const updated = await premium(signal);
                  node.replaceChildren(...updated.childNodes);
                }),
              );
            }
          },
          "primary",
        );
        confirmation.append(submit);
        import("./ui.js").then((ui) => ui.showDialog(confirmation));
      });
      buy.disabled = account.coins < plan.price_coins;
      row.append(buy);
      node.append(row);
    }
    if (!plans.length)
      node.append(
        el("p", {}, translateUI("Žádný plán Premium není dostupný.")),
      );
  } catch (error) {
    node.replaceChildren(
      errorBox(error, () =>
        premium(signal).then((updated) =>
          node.replaceChildren(...updated.childNodes),
        ),
      ),
    );
  }
  return node;
}

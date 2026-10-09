import { translateUI } from "./i18n.js";
import { api } from "./api.js";
import { el, button } from "./ui.js";

export async function appendTrackingSettings(container, dialog) {
  const section = el(
    "section",
    {},
    el("h3", {}, "Trakt / Simkl"),
    el(
      "p",
      {},
      translateUI(
        "Propojení platí jen pro tento profil. Import doplní dostupnou historii a zachová místní volby. Další změny Viděno se synchronizují automaticky.",
      ),
    ),
  );
  container.append(section);
  const content = el("div", { class: "dialog-form" }),
    message = el("p", { role: "status" });
  section.append(message, content);
  let busy = false,
    alive = true;
  const cancel = new AbortController();
  dialog.addEventListener(
    "close",
    () => {
      alive = false;
      cancel.abort();
    },
    { once: true },
  );
  async function refresh() {
    const result = await api("integrations", { signal: cancel.signal });
    if (!alive) return;
    content.replaceChildren();
    for (const item of result.items) {
      const row = el(
        "div",
        { class: "dialog-form" },
        el("strong", {}, item.provider === "trakt" ? "Trakt.tv" : "Simkl"),
        el(
          "p",
          {},
          !item.configured
            ? translateUI("Služba není na tomto API nakonfigurovaná.")
            : item.revocation_pending
              ? translateUI("Odpojeno; čeká se na zrušení oprávnění služby.")
              : item.sync_pending
                ? translateUI("Synchronizace čeká nebo probíhá.")
                : item.connected
                  ? translateUI("Připojeno")
                  : translateUI("Nepřipojeno"),
        ),
      );
      if (item.error)
        row.append(
          el(
            "p",
            {},
            {
              reconnect_required: translateUI(
                "Oprávnění vypršelo. Odpoj službu a znovu ji připoj.",
              ),
              catalog_mapping_missing: translateUI(
                "Některý titul nemá platné externí ID; změna zůstává ve frontě.",
              ),
              provider_unavailable: translateUI(
                "Služba neodpovídá; změny zůstávají uložené.",
              ),
            }[item.error] ||
              translateUI("Synchronizace se nepodařila. Zkus obnovit stav."),
          ),
        );
      for (const [action, label] of item.connected
        ? [
            ["sync", translateUI("Synchronizovat")],
            ["import", translateUI("Importovat dostupnou historii")],
            ["disconnect", translateUI("Odpojit")],
          ]
        : [["connect", translateUI("Připojit")]]) {
        const control = button(label, () => run(item.provider, action));
        control.disabled = busy || !item.configured || item.revocation_pending;
        row.append(control);
      }
      content.append(row);
    }
  }
  async function run(provider, action) {
    if (busy || !alive) return;
    busy = true;
    message.textContent = "";
    content.querySelectorAll("button").forEach((control) => {
      control.disabled = true;
    });
    try {
      const base = "integrations/" + provider;
      if (action === "connect") {
        let authorization = await api(base + "/authorization", {
          method: "POST",
          body: {},
          signal: cancel.signal,
        });
        const url = new URL(authorization.verification_url);
        if (
          url.protocol !== "https:" ||
          !["trakt.tv", "simkl.com"].includes(url.hostname) ||
          url.username ||
          url.password
        )
          throw new Error(
            translateUI("Služba vrátila neplatnou ověřovací adresu."),
          );
        const code = el("p", { class: "party-code" }, authorization.user_code);
        const link = el(
          "a",
          {
            href: url.href,
            target: "_blank",
            rel: "noopener noreferrer",
            class: "button",
          },
          translateUI("Potvrdit propojení ve službě"),
        );
        content.replaceChildren(
          code,
          link,
          button(translateUI("Zrušit"), () => dialog.close()),
        );
        const expires = Date.parse(authorization.expires_at);
        if (!Number.isFinite(expires))
          throw new Error(
            translateUI("Služba vrátila neplatnou dobu platnosti."),
          );
        while (alive && Date.now() < expires) {
          cancel.signal.throwIfAborted();
          await new Promise((resolve, reject) => {
            const finish = () => {
              clearTimeout(timer);
              cancel.signal.removeEventListener("abort", abort);
              resolve();
            };
            const abort = () => {
              clearTimeout(timer);
              cancel.signal.removeEventListener("abort", abort);
              reject(cancel.signal.reason);
            };
            const timer = setTimeout(
              finish,
              Math.max(1, authorization.interval) * 1000,
            );
            cancel.signal.addEventListener("abort", abort, { once: true });
          });
          authorization = await api(base + "/authorization/poll", {
            method: "POST",
            body: { id: authorization.id },
            signal: cancel.signal,
          });
          if (authorization.status === "connected") break;
        }
        if (authorization.status !== "connected" && alive)
          throw new Error(translateUI("Kód vypršel. Spusť propojení znovu."));
      } else
        await api(base + (action === "disconnect" ? "" : "/" + action), {
          method: action === "disconnect" ? "DELETE" : "POST",
          body: action === "disconnect" ? undefined : {},
          signal: cancel.signal,
        });
    } catch (error) {
      if (alive) message.textContent = error.message;
    } finally {
      busy = false;
      if (alive)
        await refresh().catch((error) => {
          message.textContent = error.message;
        });
    }
  }
  section.append(
    button(
      translateUI("Obnovit stav"),
      () => {
        if (!busy)
          refresh().catch((error) => {
            message.textContent = error.message;
          });
      },
      "small",
    ),
  );
  try {
    await refresh();
  } catch (error) {
    if (alive) message.textContent = error.message;
  }
}

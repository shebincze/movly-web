import { translateUI } from "./i18n.js";
import { api } from "./api.js";
import {
  el,
  button,
  loading,
  empty,
  errorBox,
  formField,
  showDialog,
  toast,
} from "./ui.js";

// Správa nahlášených streamů (moderátor/admin). Data jdou přes /api/app/admin/*,
// které slučuje obě tabulky nahlášení (human = ručně přidané streamy, ai =
// importované) a u každého řádku nese `source`, takže review/restore míří
// vždy na správnou tabulku.

const statusLabel = {
  pending: translateUI("Čeká"),
  approved: translateUI("Schváleno (stream skryt)"),
  rejected: translateUI("Zamítnuto"),
};
const sourceLabel = { human: translateUI("Databáze"), ai: "AI import" };

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("cs-CZ", { dateStyle: "medium", timeStyle: "short" });
}

function reviewDialog(row, action, refresh) {
  const approve = action === "approve";
  const comment = el("textarea", {
    name: "comment",
    maxlength: 500,
    rows: 3,
    placeholder: approve
      ? translateUI("Např. stream opravdu nejde přehrát")
      : translateUI("Např. stream funguje, nahlášení bylo omylem"),
  });
  const status = el("p", { class: "form-status", role: "alert" });
  const submit = el(
    "button",
    { type: "submit", class: `button ${approve ? "danger" : "primary"}` },
    approve
      ? translateUI("Schválit a skrýt stream")
      : translateUI("Zamítnout nahlášení"),
  );
  const form = el(
    "form",
    {
      class: "dialog-form",
      onSubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        status.textContent = "";
        try {
          await api(`admin/reports/${row.source}/${row.id}/review`, {
            method: "POST",
            body: { action, comment: comment.value },
          });
          document.querySelector("#dialog").close();
          toast(
            approve
              ? translateUI("Stream #{0} byl skryt.", row.streamId)
              : translateUI("Nahlášení bylo zamítnuto."),
          );
          refresh();
        } catch (err) {
          status.textContent = err.message;
          submit.disabled = false;
        }
      },
    },
    formField(translateUI("Komentář pro záznam (nepovinné)"), comment),
    status,
    submit,
  );
  showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el(
        "h2",
        { id: "dialog-title" },
        approve
          ? translateUI("Schválit nahlášení?")
          : translateUI("Zamítnout nahlášení?"),
      ),
      el(
        "p",
        {},
        approve
          ? translateUI(
              "Stream #{0} ({1}) přestane být dostupný v aplikacích. Jde to vrátit tlačítkem Obnovit.",
              row.streamId,
              row.streamTitle || translateUI("bez názvu"),
            )
          : translateUI(
              "Stream #{0} zůstane dostupný a nahlášení se uzavře.",
              row.streamId,
            ),
      ),
      form,
    ),
  );
}

function restoreDialog(row, refresh) {
  const reason = el("input", {
    name: "reason",
    required: true,
    maxlength: 500,
    placeholder: translateUI("Např. stream znovu funguje"),
    autofocus: true,
  });
  const status = el("p", { class: "form-status", role: "alert" });
  const submit = el(
    "button",
    { type: "submit", class: "button primary" },
    translateUI("Obnovit stream"),
  );
  const form = el(
    "form",
    {
      class: "dialog-form",
      onSubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        status.textContent = "";
        try {
          await api(`admin/streams/${row.source}/${row.streamId}/restore`, {
            method: "POST",
            body: { reason: reason.value },
          });
          document.querySelector("#dialog").close();
          toast(translateUI("Stream #{0} je znovu dostupný.", row.streamId));
          refresh();
        } catch (err) {
          status.textContent = err.message;
          submit.disabled = false;
        }
      },
    },
    formField(translateUI("Důvod obnovení"), reason),
    status,
    submit,
  );
  showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el(
        "h2",
        { id: "dialog-title" },
        translateUI("Obnovit stream #{0}?", row.streamId),
      ),
      el(
        "p",
        {},
        translateUI(
          "Stream se znovu zobrazí v aplikacích. Důvod se uloží k záznamu.",
        ),
      ),
      form,
    ),
  );
}

function reportCard(row, refresh) {
  const canReview = row.status === "pending";
  const canRestore = row.status === "approved";
  return el(
    "article",
    { class: `report-card status-${row.status}` },
    el(
      "div",
      { class: "report-main" },
      el(
        "div",
        { class: "report-title" },
        el("strong", {}, row.streamTitle || translateUI("Neznámý titul")),
        el(
          "span",
          { class: `badge source-${row.source}` },
          sourceLabel[row.source],
        ),
        el(
          "span",
          { class: `badge status-${row.status}` },
          statusLabel[row.status],
        ),
        row.reviewComment && row.reviewComment.startsWith("auto-approved")
          ? el("span", { class: "badge auto" }, "auto")
          : null,
      ),
      el(
        "p",
        { class: "meta" },
        [
          `stream #${row.streamId}`,
          row.streamProvider,
          row.requesterName
            ? translateUI("nahlásil {0}", row.requesterName)
            : row.requestedBy
              ? translateUI("uživatel {0}", row.requestedBy)
              : null,
          formatDate(row.createdAt),
        ]
          .filter(Boolean)
          .join(" · "),
      ),
      el(
        "p",
        { class: "report-reason" },
        row.reason ? `„${row.reason}“` : translateUI("Bez udaného důvodu"),
      ),
      row.reviewerName || row.reviewComment
        ? el(
            "p",
            { class: "report-review" },
            [
              row.reviewerName
                ? translateUI("Vyřídil {0}", row.reviewerName)
                : null,
              row.reviewedAt ? formatDate(row.reviewedAt) : null,
              row.reviewComment ? `„${row.reviewComment}“` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          )
        : null,
    ),
    el(
      "div",
      { class: "report-actions" },
      canReview
        ? button(
            translateUI("Schválit"),
            () => reviewDialog(row, "approve", refresh),
            "danger",
            "check",
          )
        : null,
      canReview
        ? button(
            translateUI("Zamítnout"),
            () => reviewDialog(row, "reject", refresh),
            "secondary",
            "close",
          )
        : null,
      canRestore
        ? button(
            translateUI("Obnovit stream"),
            () => restoreDialog(row, refresh),
            "secondary",
          )
        : null,
    ),
  );
}

function trustedCard(row, refresh) {
  const remove = button(
    translateUI("Odebrat"),
    async () => {
      remove.disabled = true;
      try {
        await api(`admin/trusted-reporters/${row.userId}`, {
          method: "DELETE",
        });
        toast(
          translateUI("{0} už nemá automatické schvalování.", row.username),
        );
        refresh();
      } catch (e) {
        toast(e.message);
        remove.disabled = false;
      }
    },
    "secondary",
    "close",
  );
  return el(
    "article",
    { class: "report-card" },
    el(
      "div",
      { class: "report-main" },
      el(
        "div",
        { class: "report-title" },
        el("strong", {}, row.displayName || row.username),
        el("span", { class: "badge" }, row.username),
      ),
      el(
        "p",
        { class: "meta" },
        [
          row.grantedByName
            ? translateUI("přidal {0}", row.grantedByName)
            : null,
          row.createdAt ? formatDate(row.createdAt) : null,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
      row.note ? el("p", { class: "report-reason" }, `„${row.note}“`) : null,
    ),
    el("div", { class: "report-actions" }, remove),
  );
}

async function trustedView(signal, refresh) {
  const data = await api("admin/trusted-reporters", { signal });
  if (!data || !Array.isArray(data.reporters))
    throw new Error(
      translateUI("Server vrátil neplatný seznam důvěryhodných uživatelů."),
    );
  const username = el("input", {
    name: "username",
    required: true,
    maxlength: 255,
    autocomplete: "off",
    placeholder: translateUI("uživatelské jméno"),
  });
  const note = el("input", {
    name: "note",
    maxlength: 500,
    placeholder: translateUI("poznámka (nepovinné)"),
  });
  const status = el("p", { class: "form-status", role: "alert" });
  const submit = el(
    "button",
    { type: "submit", class: "button primary" },
    translateUI("Přidat"),
  );
  const form = el(
    "form",
    {
      class: "trusted-form",
      onSubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        status.textContent = "";
        try {
          const added = await api("admin/trusted-reporters", {
            method: "POST",
            body: { username: username.value, note: note.value },
          });
          toast(
            translateUI(
              "{0}: nahlášení se teď schvalují automaticky.",
              added.username,
            ),
          );
          refresh();
        } catch (err) {
          status.textContent = err.message;
          submit.disabled = false;
        }
      },
    },
    formField(translateUI("Uživatel"), username),
    formField(translateUI("Poznámka"), note),
    submit,
    status,
  );
  return el(
    "div",
    {},
    el(
      "p",
      { class: "meta" },
      translateUI(
        "Nahlášení od těchto uživatelů se rovnou schválí a stream se skryje bez čekání na kontrolu. Objeví se v záložce Schválené se štítkem auto.",
      ),
    ),
    form,
    data.reporters.length
      ? el(
          "div",
          { class: "report-list" },
          data.reporters.map((row) => trustedCard(row, refresh)),
        )
      : empty(
          translateUI("Zatím nikdo"),
          translateUI("Přidej uživatele, jehož nahlášením věříš."),
        ),
  );
}

export async function admin(params, signal, actions) {
  const view = params.get("view") === "trusted" ? "trusted" : "reports";
  const status = ["pending", "approved", "rejected", "all"].includes(
    params.get("status"),
  )
    ? params.get("status")
    : "pending";
  const page = Math.max(1, Number(params.get("page") || "1") || 1);
  const refresh = () => actions.refresh();
  if (view === "trusted") {
    return el(
      "div",
      { class: "page" },
      el(
        "div",
        { class: "page-heading" },
        el(
          "div",
          {},
          el("h1", {}, translateUI("Důvěryhodní uživatelé")),
          el(
            "p",
            {},
            translateUI("Jejich nahlášení se schvalují automaticky."),
          ),
        ),
        el(
          "a",
          { href: "#admin", class: "button secondary" },
          translateUI("Zpět na nahlášení"),
        ),
      ),
      await trustedView(signal, refresh),
    );
  }
  const data = await api(
    `admin/reports?status=${status}&page=${page}&per_page=50`,
    { signal },
  );
  if (!data || !Array.isArray(data.requests))
    throw new Error(translateUI("Server vrátil neplatný seznam nahlášení."));
  const tabs = el(
    "nav",
    {
      class: "filters report-filters",
      "aria-label": translateUI("Stav nahlášení"),
    },
    [
      ["pending", translateUI("Čekající")],
      ["approved", translateUI("Schválené")],
      ["rejected", translateUI("Zamítnuté")],
      ["all", translateUI("Vše")],
    ].map(([value, label]) =>
      el(
        "a",
        {
          href: `#admin?status=${value}`,
          class: `button ${value === status ? "primary" : "secondary"} small`,
          "aria-current": value === status ? "page" : null,
        },
        label,
      ),
    ),
  );
  tabs.append(
    el(
      "a",
      { href: "#admin?view=trusted", class: "button secondary small" },
      translateUI("Důvěryhodní uživatelé"),
    ),
  );
  const list = data.requests.length
    ? el(
        "div",
        { class: "report-list" },
        data.requests.map((row) => reportCard(row, refresh)),
      )
    : empty(
        status === "pending"
          ? translateUI("Nic nečeká na vyřízení")
          : translateUI("Žádná nahlášení"),
        translateUI(
          "Nahlášení z aplikací se tu objeví během chvíle po odeslání.",
        ),
      );
  const pagination = el(
    "div",
    { class: "pagination" },
    page > 1
      ? el(
          "a",
          {
            href: `#admin?status=${status}&page=${page - 1}`,
            class: "button secondary small",
          },
          translateUI("Předchozí"),
        )
      : null,
    el("span", {}, translateUI("Strana {0}", page)),
    data.hasMore
      ? el(
          "a",
          {
            href: `#admin?status=${status}&page=${page + 1}`,
            class: "button secondary small",
          },
          translateUI("Další"),
        )
      : null,
  );
  const totals = data.totals || {};
  return el(
    "div",
    { class: "page" },
    el(
      "div",
      { class: "page-heading" },
      el(
        "div",
        {},
        el("h1", {}, translateUI("Nahlášené streamy")),
        el(
          "p",
          {},
          translateUI(
            "Databáze: {0} · AI import: {1} záznamů ve vybraném stavu",
            totals.human ?? "?",
            totals.ai ?? "?",
          ),
        ),
      ),
      button(translateUI("Obnovit seznam"), refresh),
    ),
    tabs,
    list,
    pagination,
  );
}

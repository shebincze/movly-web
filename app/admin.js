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
  pending: "Čeká",
  approved: "Schváleno (stream skryt)",
  rejected: "Zamítnuto",
};
const sourceLabel = { human: "Databáze", ai: "AI import" };

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
      ? "Např. stream opravdu nejde přehrát"
      : "Např. stream funguje, nahlášení bylo omylem",
  });
  const status = el("p", { class: "form-status", role: "alert" });
  const submit = el(
    "button",
    { type: "submit", class: `button ${approve ? "danger" : "primary"}` },
    approve ? "Schválit a skrýt stream" : "Zamítnout nahlášení",
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
              ? `Stream #${row.streamId} byl skryt.`
              : "Nahlášení bylo zamítnuto.",
          );
          refresh();
        } catch (err) {
          status.textContent = err.message;
          submit.disabled = false;
        }
      },
    },
    formField("Komentář pro záznam (nepovinné)", comment),
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
        approve ? "Schválit nahlášení?" : "Zamítnout nahlášení?",
      ),
      el(
        "p",
        {},
        approve
          ? `Stream #${row.streamId} (${row.streamTitle || "bez názvu"}) přestane být dostupný v aplikacích. Jde to vrátit tlačítkem Obnovit.`
          : `Stream #${row.streamId} zůstane dostupný a nahlášení se uzavře.`,
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
    placeholder: "Např. stream znovu funguje",
    autofocus: true,
  });
  const status = el("p", { class: "form-status", role: "alert" });
  const submit = el(
    "button",
    { type: "submit", class: "button primary" },
    "Obnovit stream",
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
          toast(`Stream #${row.streamId} je znovu dostupný.`);
          refresh();
        } catch (err) {
          status.textContent = err.message;
          submit.disabled = false;
        }
      },
    },
    formField("Důvod obnovení", reason),
    status,
    submit,
  );
  showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el("h2", { id: "dialog-title" }, `Obnovit stream #${row.streamId}?`),
      el(
        "p",
        {},
        "Stream se znovu zobrazí v aplikacích. Důvod se uloží k záznamu.",
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
        el("strong", {}, row.streamTitle || "Neznámý titul"),
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
            ? `nahlásil ${row.requesterName}`
            : row.requestedBy
              ? `uživatel ${row.requestedBy}`
              : null,
          formatDate(row.createdAt),
        ]
          .filter(Boolean)
          .join(" · "),
      ),
      el(
        "p",
        { class: "report-reason" },
        row.reason ? `„${row.reason}“` : "Bez udaného důvodu",
      ),
      row.reviewerName || row.reviewComment
        ? el(
            "p",
            { class: "report-review" },
            [
              row.reviewerName ? `Vyřídil ${row.reviewerName}` : null,
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
            "Schválit",
            () => reviewDialog(row, "approve", refresh),
            "danger",
            "check",
          )
        : null,
      canReview
        ? button(
            "Zamítnout",
            () => reviewDialog(row, "reject", refresh),
            "secondary",
            "close",
          )
        : null,
      canRestore
        ? button(
            "Obnovit stream",
            () => restoreDialog(row, refresh),
            "secondary",
          )
        : null,
    ),
  );
}

function trustedCard(row, refresh) {
  const remove = button(
    "Odebrat",
    async () => {
      remove.disabled = true;
      try {
        await api(`admin/trusted-reporters/${row.userId}`, { method: "DELETE" });
        toast(`${row.username} už nemá automatické schvalování.`);
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
          row.grantedByName ? `přidal ${row.grantedByName}` : null,
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
    throw new Error("Server vrátil neplatný seznam důvěryhodných uživatelů.");
  const username = el("input", {
    name: "username",
    required: true,
    maxlength: 255,
    autocomplete: "off",
    placeholder: "uživatelské jméno",
  });
  const note = el("input", {
    name: "note",
    maxlength: 500,
    placeholder: "poznámka (nepovinné)",
  });
  const status = el("p", { class: "form-status", role: "alert" });
  const submit = el(
    "button",
    { type: "submit", class: "button primary" },
    "Přidat",
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
          toast(`${added.username}: nahlášení se teď schvalují automaticky.`);
          refresh();
        } catch (err) {
          status.textContent = err.message;
          submit.disabled = false;
        }
      },
    },
    formField("Uživatel", username),
    formField("Poznámka", note),
    submit,
    status,
  );
  return el(
    "div",
    {},
    el(
      "p",
      { class: "meta" },
      "Nahlášení od těchto uživatelů se rovnou schválí a stream se skryje bez čekání na kontrolu. Objeví se v záložce Schválené se štítkem auto.",
    ),
    form,
    data.reporters.length
      ? el(
          "div",
          { class: "report-list" },
          data.reporters.map((row) => trustedCard(row, refresh)),
        )
      : empty(
          "Zatím nikdo",
          "Přidej uživatele, jehož nahlášením věříš.",
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
          el("h1", {}, "Důvěryhodní uživatelé"),
          el("p", {}, "Jejich nahlášení se schvalují automaticky."),
        ),
        el("a", { href: "#admin", class: "button secondary" }, "Zpět na nahlášení"),
      ),
      await trustedView(signal, refresh),
    );
  }
  const data = await api(
    `admin/reports?status=${status}&page=${page}&per_page=50`,
    { signal },
  );
  if (!data || !Array.isArray(data.requests))
    throw new Error("Server vrátil neplatný seznam nahlášení.");
  const tabs = el(
    "nav",
    { class: "filters report-filters", "aria-label": "Stav nahlášení" },
    [
      ["pending", "Čekající"],
      ["approved", "Schválené"],
      ["rejected", "Zamítnuté"],
      ["all", "Vše"],
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
      "Důvěryhodní uživatelé",
    ),
  );
  const list = data.requests.length
    ? el(
        "div",
        { class: "report-list" },
        data.requests.map((row) => reportCard(row, refresh)),
      )
    : empty(
        status === "pending" ? "Nic nečeká na vyřízení" : "Žádná nahlášení",
        "Nahlášení z aplikací se tu objeví během chvíle po odeslání.",
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
          "Předchozí",
        )
      : null,
    el("span", {}, `Strana ${page}`),
    data.hasMore
      ? el(
          "a",
          {
            href: `#admin?status=${status}&page=${page + 1}`,
            class: "button secondary small",
          },
          "Další",
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
        el("h1", {}, "Nahlášené streamy"),
        el(
          "p",
          {},
          `Databáze: ${totals.human ?? "?"} · AI import: ${totals.ai ?? "?"} záznamů ve vybraném stavu`,
        ),
      ),
      button("Obnovit seznam", refresh),
    ),
    tabs,
    list,
    pagination,
  );
}

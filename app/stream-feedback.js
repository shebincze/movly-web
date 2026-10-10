import { translateUI } from "./i18n.js";
import { api } from "./api.js";
import { el, showDialog, button, formField, toast } from "./ui.js";
export function reportStream(selection) {
  const reason = el("textarea", { required: true, maxlength: 500, rows: 4 });
  const status = el("p", { role: "status" });
  const submit = el(
    "button",
    { type: "submit", class: "button primary" },
    translateUI("Odeslat hlášení"),
  );
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el("h2", { id: "dialog-title" }, translateUI("Nahlásit zdroj")),
      el(
        "form",
        {
          class: "dialog-form",
          onSubmit: async (event) => {
            event.preventDefault();
            submit.disabled = true;
            try {
              await api("streams/report", {
                method: "POST",
                body: { ...selection, reason: reason.value },
              });
              dialog.close();
              toast(translateUI("Hlášení bylo odesláno."));
            } catch (error) {
              status.textContent = error.message;
              submit.disabled = false;
            }
          },
        },
        formField(translateUI("Co je se zdrojem špatně?"), reason),
        status,
        submit,
      ),
    ),
  );
}
export function uploadStream(selection, onSaved) {
  let reviewID;
  let selections = [];
  const languages = el("div", { class: "dialog-form" });
  const status = el(
    "p",
    { role: "status" },
    translateUI(
      "Potvrď, že tento zdroj patří k vybranému titulu a epizodě. Před uložením ověříme video a jeho skutečné parametry.",
    ),
  );
  const submit = button(
    translateUI("Ověřit a uložit"),
    async () => {
      submit.disabled = true;
      status.textContent = translateUI("Analyzuji video a ukládám zdroj…");
      try {
        const result = await api("streams/upload", {
          method: "POST",
          body: { ...selection, ...(reviewID ? { audio_review_id: reviewID, confirmed_audio_languages: selections.map(s => s.value) } : {}) },
        });
        dialog.close();
        toast(result.message);
        await onSaved();
      } catch (error) {
        status.textContent = error.message;
        if (error.code === "audio_confirmation_required" && Array.isArray(error.body?.unknown_audio_tracks)) {
          reviewID = error.body.audio_review_id;
          languages.replaceChildren();
          selections = error.body.unknown_audio_tracks.map(index => {
            const select = el("select", { required: true });
            for (const [code, label] of [["", "Vyber jazyk"], ["cze", "Čeština"], ["slk", "Slovenština"], ["eng", "Angličtina"], ["deu", "Němčina"], ["pol", "Polština"], ["fr", "Francouzština"], ["es", "Španělština"], ["it", "Italština"], ["ja", "Japonština"], ["ko", "Korejština"]])
              select.append(el("option", { value: code }, translateUI(label)));
            select.addEventListener("change", () => { submit.disabled = selections.some(s => !s.value); });
            languages.append(formField(`Zvuková stopa ${index + 1}`, select));
            return select;
          });
        }
        submit.disabled = selections.some(s => !s.value);
      }
    },
    "primary",
  );
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el("h2", { id: "dialog-title" }, translateUI("Přidat zdroj do databáze")),
      status,
      languages,
      submit,
    ),
  );
}

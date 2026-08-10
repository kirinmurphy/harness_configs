// Metadata suggestions dialog: fetch and render discovered same-origin routes for one app.
//
// Kept out of app.js for the same reason history-view.js is: fetched only when the dialog opens,
// never on the poll loop, and app.js is already long.

import { portalFillSlots as fill, portalTpl as tpl } from "/portal/shared/api.js";
import { fetchMetadata } from "./api.js";

const SOURCE_LABELS = {
  openapi: "OpenAPI",
  sitemap: "Sitemap",
  manifest: "Manifest",
  robots: "Robots",
};

// addSuggestion(project, instance, suggestion) must return the mutation's result (or throw), same
// contract as api.updateLinks — this view stays link-storage-agnostic and lets app.js own the
// snapshot/revision bookkeeping, matching how onStale already defers to the caller for reload.
export function createSuggestionsView({ onStale, addSuggestion } = {}) {
  const dialog = document.getElementById("suggestions-dialog");
  const body = document.getElementById("suggestions-body");
  const subject = document.getElementById("suggestions-subject");
  if (!dialog) return { open() {} };

  dialog.querySelector("[data-close]")?.addEventListener("click", () => dialog.close());

  return {
    async open(project, instance) {
      subject.textContent = `${project?.name || instance.app?.name || instance.title || "This app"} · ${instance.origin || "no origin"}`;
      body.replaceChildren(message("Looking for routes…"));
      if (typeof dialog.showModal === "function") dialog.showModal();

      let result;
      try {
        result = await fetchMetadata(instance.opaqueKey);
      } catch {
        body.replaceChildren(message("Suggestions are unavailable right now."));
        return;
      }

      // A 404 means the key went stale — the app's port changed since this snapshot was rendered.
      if (result?.ok === false) {
        dialog.close();
        onStale?.();
        return;
      }

      const suggestions = result?.suggestions || [];
      if (!suggestions.length) {
        body.replaceChildren(message("No suggested routes found."));
        return;
      }
      body.replaceChildren(...suggestions.map((suggestion) =>
        suggestionRow(suggestion, () => addSuggestion?.(project, instance, suggestion))));
    },
  };
}

// Adds directly from the row — no detour through the free-text link-edit form. That form still
// exists for hand-typed links; a suggestion is already a known-good path, so confirming it here is
// a single click instead of a second dialog. Row-scoped loading/error/added states keep the dialog
// open so the user can add more than one suggestion without reopening it.
function suggestionRow(suggestion, onAdd) {
  const row = fill(tpl("tpl-suggestion-row"), {
    path: suggestion.path,
    source: SOURCE_LABELS[suggestion.source] || suggestion.source,
  });
  const button = row.querySelector("[data-action=add]");
  const errorSlot = row.querySelector("[data-slot=add-error]");
  button.addEventListener("click", async () => {
    button.disabled = true;
    if (errorSlot) errorSlot.textContent = "";
    try {
      await onAdd();
      button.textContent = "Added";
    } catch (err) {
      button.disabled = false;
      button.textContent = "Add as quick link";
      if (errorSlot) errorSlot.textContent = err.message;
    }
  });
  return row;
}

function message(text) {
  const p = document.createElement("p");
  p.className = "no-links";
  p.textContent = text;
  return p;
}

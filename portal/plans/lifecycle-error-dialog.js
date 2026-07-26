// Singleton controller for #lifecycle-error-modal — shown when a lifecycle move is rejected by
// the server (LIFECYCLE_REQUIREMENTS, or any other domain error carrying `details`). Purely
// presentational: app.js decides when a mutation failed and calls open() with the error the
// server returned; this module never touches files or re-attempts the mutation itself.
import { portalWireBackdropClose } from "/portal/shared/api.js";

export function createLifecycleErrorDialog(dialogEl) {
  const titleEl = dialogEl.querySelector('[data-slot="title"]');
  const resolutionEl = dialogEl.querySelector('[data-slot="resolution"]');
  const detailsEl = dialogEl.querySelector('[data-slot="details"]');
  const confirmEl = dialogEl.querySelector('[data-slot="confirm-action"]');

  dialogEl.querySelector('[data-slot="close"]').addEventListener("click", close);
  dialogEl.querySelector('[data-slot="close-action"]').addEventListener("click", close);
  portalWireBackdropClose(dialogEl, close);

  // open(err, onConfirm) — `err` is the thrown domain error: { message, resolution, details }.
  // `onConfirm`, when given, shows a "Move anyway" button that closes the dialog and re-attempts
  // the mutation with the validation bypassed (see app.js's LIFECYCLE_REQUIREMENTS catch branch).
  // Omit `onConfirm` for errors with nothing sensible to retry — the dialog falls back to a plain
  // message-only render with just a Cancel button.
  function open(err, onConfirm) {
    titleEl.textContent = "Couldn't move plan";
    resolutionEl.textContent = err?.resolution || String(err?.message || err);
    detailsEl.replaceChildren();
    for (const detail of err?.details || []) {
      const li = document.createElement("li");
      li.textContent = detail;
      detailsEl.appendChild(li);
    }
    detailsEl.hidden = !(err?.details?.length);
    confirmEl.hidden = !onConfirm;
    confirmEl.onclick = onConfirm ? () => { close(); onConfirm(); } : null;
    dialogEl.showModal();
  }

  function close() {
    dialogEl.close();
  }

  return { open, close };
}

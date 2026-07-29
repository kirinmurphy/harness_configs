// Singleton controller for #lifecycle-error-modal — shown when a lifecycle move is rejected by
// the server (LIFECYCLE_REQUIREMENTS, or any other domain error carrying `details`). Purely
// presentational: app.js decides when a mutation failed and calls open() with the error the
// server returned; this module never touches files or re-attempts the mutation itself.
//
// A modal rather than a toast on purpose — the user needs time to read every problem and decide
// what to do, and the repair prompt is only useful if it stays on screen long enough to copy.
import { portalWireBackdropClose } from "/portal/shared/api.js";
import { lifecycleFindingGroups, canRepairLifecycleError } from "./state.js";
import { lifecycleFinding } from "./templates.js";

export function createLifecycleErrorDialog(dialogEl, { onViewPlan } = {}) {
  const titleEl = dialogEl.querySelector('[data-slot="title"]');
  const resolutionEl = dialogEl.querySelector('[data-slot="resolution"]');
  const blockingLabelEl = dialogEl.querySelector('[data-slot="blocking-label"]');
  const detailsEl = dialogEl.querySelector('[data-slot="details"]');
  const advisoryLabelEl = dialogEl.querySelector('[data-slot="advisory-label"]');
  const advisoryDetailsEl = dialogEl.querySelector('[data-slot="advisory-details"]');
  const copyPromptEl = dialogEl.querySelector('[data-slot="copy-prompt"]');
  const viewPlanEl = dialogEl.querySelector('[data-slot="view-plan"]');
  const confirmEl = dialogEl.querySelector('[data-slot="confirm-action"]');

  dialogEl.querySelector('[data-slot="close"]').addEventListener("click", close);
  dialogEl.querySelector('[data-slot="close-action"]').addEventListener("click", close);
  portalWireBackdropClose(dialogEl, close);

  // open(err, onConfirm) — `err` is the thrown domain error: { message, resolution, details,
  // findings?, repair? }. `onConfirm`, when given, shows a "Move anyway" button that closes the
  // dialog and re-attempts the mutation with validation bypassed (see app.js's
  // LIFECYCLE_REQUIREMENTS catch branch). Omit `onConfirm` for errors with nothing sensible to
  // retry — the dialog falls back to a message-only render with just a Cancel button.
  function open(err, onConfirm) {
    titleEl.textContent = "Couldn't move plan";
    resolutionEl.textContent = err?.resolution || String(err?.message || err);

    // Blocking problems lead, matching the order the repair prompt uses, so the copied text and
    // the on-screen list read the same way.
    const { blocking, advisory } = lifecycleFindingGroups(err);
    detailsEl.replaceChildren(...blocking.map(lifecycleFinding));
    advisoryDetailsEl.replaceChildren(...advisory.map(lifecycleFinding));
    detailsEl.hidden = blocking.length === 0;
    advisoryDetailsEl.hidden = advisory.length === 0;
    // The "Must fix" heading only earns its place when there's a second group to contrast with.
    blockingLabelEl.hidden = blocking.length === 0 || advisory.length === 0;
    advisoryLabelEl.hidden = advisory.length === 0;

    // The prompt arrives with the error, so copying is synchronous and can't fail or need a
    // spinner. <portal-copy-button> owns its own "Copied!" state.
    const repairable = canRepairLifecycleError(err);
    copyPromptEl.hidden = !repairable;
    copyPromptEl.copySource = repairable ? () => err.repair.prompt : null;

    // Close before opening the drawer — two stacked showModal() dialogs is a broken state.
    const planKey = err?.repair?.planKey;
    viewPlanEl.hidden = !(planKey && onViewPlan);
    viewPlanEl.onclick = planKey && onViewPlan ? () => { close(); onViewPlan(planKey); } : null;

    confirmEl.hidden = !onConfirm;
    confirmEl.onclick = onConfirm ? () => { close(); onConfirm(); } : null;
    dialogEl.showModal();
  }

  function close() {
    dialogEl.close();
  }

  return { open, close };
}

// Singleton controller for #toast — replaces the old text-only showToast(). Handles both the
// simple "copied" notification (no actions) and the richer mutation-outcome notification (message
// + Undo / View plan / filtered-list-action, each a real button so nothing is built via innerHTML).
// Auto-dismisses after a delay that pauses while the toast has hover or keyboard focus, and resets
// its timer/content cleanly between shows so a second notification never inherits stale state.

const AUTO_DISMISS_MS = 7000;

export function createOutcomeToast(toastEl) {
  const messageEl = toastEl.querySelector('[data-slot="message"]');
  const actionsEl = toastEl.querySelector('[data-slot="actions"]');

  let dismissTimer = null;
  let remainingMs = AUTO_DISMISS_MS;
  let shownAt = 0;
  let paused = false;

  toastEl.addEventListener("mouseenter", pause);
  toastEl.addEventListener("mouseleave", resume);
  toastEl.addEventListener("focusin", pause);
  toastEl.addEventListener("focusout", resume);

  function pause() {
    if (paused || toastEl.hidden) return;
    paused = true;
    clearTimeout(dismissTimer);
    remainingMs -= Date.now() - shownAt;
  }

  function resume() {
    if (!paused || toastEl.hidden) return;
    paused = false;
    schedule(remainingMs);
  }

  function schedule(ms) {
    shownAt = Date.now();
    dismissTimer = setTimeout(dismiss, ms);
  }

  // descriptor: { message, actions? } — each action is { label, run }. `run` is called on click
  // and the toast dismisses immediately after (actions are one-shot, not toggles).
  function show({ message, actions = [] }) {
    clearTimeout(dismissTimer);
    paused = false;
    messageEl.textContent = message;
    actionsEl.replaceChildren(...actions.map((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => {
        dismiss();
        action.run();
      });
      return button;
    }));
    toastEl.hidden = false;
    remainingMs = AUTO_DISMISS_MS;
    schedule(AUTO_DISMISS_MS);
  }

  function dismiss() {
    clearTimeout(dismissTimer);
    toastEl.hidden = true;
  }

  return { show, dismiss };
}

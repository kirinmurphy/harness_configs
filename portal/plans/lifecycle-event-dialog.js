// Singleton controller for #lifecycle-event-modal — the dialog shown after a plan moves into
// Active or Completed (a "lifecycle event"), or when Active's own Start CTA is used without a
// mutation (isTransition: false). It never mutates files or validates lifecycle values itself;
// app.js only calls open() after a lifecycle mutation has already succeeded, or when it wants to
// show the same explanatory content without one.
import { portalWireBackdropClose } from "/portal/shared/api.js";

// Declarative: which destinations trigger this dialog and what explanatory copy they show.
// Deliberately small — this only answers "does this destination have an event, and what does it
// say," never filesystem/validation rules (those live in the plan-docs domain module).
export const lifecycleEvents = {
  active: {
    explanation: "/plan-docs start moves work forward: it reviews the plan, confirms it's ready, and begins implementation.",
  },
  completed: {
    explanation: "This plan is now marked Completed.",
  },
};

export function createLifecycleEventDialog(dialogEl, { onCopyPrompt, onViewPlan, onRevert }) {
  const titleEl = dialogEl.querySelector('[data-slot="title"]');
  const transitionNoteEl = dialogEl.querySelector('[data-slot="transition-note"]');
  const explanationEl = dialogEl.querySelector('[data-slot="explanation"]');
  const copyEl = dialogEl.querySelector('[data-slot="copy-prompt"]');
  const viewPlanEl = dialogEl.querySelector('[data-slot="view-plan"]');
  const revertEl = dialogEl.querySelector('[data-slot="revert"]');

  dialogEl.querySelector('[data-slot="close"]').addEventListener("click", close);
  portalWireBackdropClose(dialogEl, close);

  // open({ change, record, isTransition }) — `change` is the mutation's { property, previousValue,
  // newValue } (or null when opened from Active's Start CTA without a mutation). `record` is the
  // current full record (the post-mutation record on a transition, or the unchanged record for
  // the no-mutation Active case). `isTransition` gates the confirmation copy and Revert action.
  function open({ change, record, isTransition }) {
    const lifecycle = change ? change.newValue : record.plan.lifecycle;
    const event = lifecycleEvents[lifecycle];
    if (!event) return; // defensive: caller should only invoke this for configured destinations

    titleEl.textContent = record.plan.title;
    transitionNoteEl.hidden = !isTransition;
    transitionNoteEl.textContent = isTransition
      ? `Moved to ${capitalize(lifecycle)}.`
      : "";
    explanationEl.textContent = event.explanation;

    copyEl.hidden = lifecycle !== "active";
    copyEl.disabled = false;
    copyEl.textContent = "Copy Start Prompt";
    copyEl.onclick = async () => {
      copyEl.disabled = true;
      copyEl.textContent = "Copying…";
      try {
        await onCopyPrompt(record);
        copyEl.textContent = "Copied!";
      } catch {
        copyEl.textContent = "Copy Start Prompt";
      } finally {
        copyEl.disabled = false;
      }
    };

    viewPlanEl.onclick = () => {
      close();
      onViewPlan(record);
    };

    revertEl.hidden = !isTransition;
    if (isTransition) {
      revertEl.textContent = `Revert to ${capitalize(change.previousValue)}`;
      revertEl.onclick = () => {
        close();
        onRevert(record, change.previousValue);
      };
    }

    dialogEl.showModal();
  }

  function close() {
    dialogEl.close();
  }

  return { open, close };
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Wiring for the two self-contained chrome panels on the Plans page: the discovery-roots
// ("Project Folders") settings panel and the info modal. Each exposes a small controller so
// app.js can call into it without owning DOM refs or listeners for these panels itself.

import { portalWireBackdropClose } from "/portal/shared/api.js";
import * as api from "./api.js";
import * as tmpl from "./templates.js";

// Once discovery roots exist, the empty-state `.settings` block (label + form) is physically
// relocated into the control bar's roots-panel mount point and driven by the "update" toggle
// instead. Moving the same nodes (rather than duplicating the form) keeps one source of truth.
export function createRootsPanel({ onSnapshot, onError, onExpand }) {
  const rootsEl = document.getElementById("roots");
  const settingsEl = document.getElementById("settings");
  const settingsLabelEl = document.getElementById("settings-label");
  const rootsToggleEl = document.getElementById("roots-toggle");
  const rootFormLabelEmptyEl = document.getElementById("root-form-label-empty");
  const rootFormLabelPopulatedEl = document.getElementById("root-form-label-populated");
  const rootSubmitEl = document.getElementById("root-submit");
  const settingsBodyEl = document.getElementById("settings-body");
  const rootsDoneEl = document.getElementById("roots-done");
  const rootsPanelMountEl = document.getElementById("roots-panel-mount");
  const rootFormErrEl = document.getElementById("root-form-err");

  let currentRoots = [];
  let wasEmpty = true;

  document.getElementById("root-form").addEventListener("submit", onSubmit);
  rootsToggleEl.addEventListener("click", () => setExpanded(rootsPanelMountEl.hidden));
  rootsDoneEl.addEventListener("click", () => setExpanded(false));

  async function onSubmit(event) {
    event.preventDefault();
    rootFormErrEl.textContent = "";
    const input = document.getElementById("root-input");
    rootSubmitEl.disabled = true;
    rootSubmitEl.replaceChildren("Adding…", tmpl.spinner());
    try {
      const snap = await api.saveDiscoveryRoots([...currentRoots, input.value]);
      input.value = "";
      onSnapshot(snap);
      if (currentRoots.length) setExpanded(true); // stay open across multiple adds in one sitting
    } catch (err) {
      rootFormErrEl.textContent = err.message;
    } finally {
      rootSubmitEl.disabled = false;
      rootSubmitEl.textContent = "Add Folder";
    }
  }

  async function remove(root) {
    await api
      .saveDiscoveryRoots(currentRoots.filter((item) => item !== root))
      .then(onSnapshot)
      .catch(onError);
  }

  function setExpanded(expanded) {
    rootsPanelMountEl.hidden = !expanded;
    if (expanded) onExpand?.();
  }

  function render(roots) {
    currentRoots = roots;
    if (!roots.length) {
      // Empty state: form lives in the standalone `.settings` block, always visible, no toggle.
      settingsEl.hidden = false;
      settingsEl.append(settingsBodyEl);
      settingsLabelEl.textContent = "No Project Folders configured";
      rootFormLabelEmptyEl.hidden = false;
      rootFormLabelPopulatedEl.hidden = true;
      rootsDoneEl.hidden = true;
      rootsPanelMountEl.hidden = true;
      rootsEl.replaceChildren();
      wasEmpty = true;
      return;
    }
    // Populated state: form moves into the control bar's roots-panel mount, gated behind the
    // "update" toggle (row 1's "N Repos" replaces the old settings-label). The moment we cross
    // from empty to populated, collapse it by default.
    settingsEl.hidden = true;
    rootsPanelMountEl.append(settingsBodyEl);
    rootFormLabelEmptyEl.hidden = true;
    rootFormLabelPopulatedEl.hidden = false;
    rootsDoneEl.hidden = false;
    if (wasEmpty) setExpanded(false);
    wasEmpty = false;
    rootsEl.replaceChildren(...roots.map((root) => tmpl.rootChip(root, remove)));
  }

  return { render, setExpanded };
}

// Popup for a bulk agent-prompt action (currently just "Work next plans"): explains the
// objective, states how many plans it's scoped to under the current filters, then copies the
// generated prompt on demand. Caller passes scopeCount (computed cheaply up front, before the
// prompt itself is generated) and onCopy (does the actual generate+clipboard work on click).
export function createPromptModal(dialogEl) {
  const titleEl = dialogEl.querySelector('[data-slot="title"]');
  const objectiveEl = dialogEl.querySelector('[data-slot="objective"]');
  const scopeEl = dialogEl.querySelector('[data-slot="scope"]');
  const copyEl = dialogEl.querySelector('[data-slot="copy"]');

  dialogEl.querySelector('[data-slot="close"]').addEventListener("click", close);
  portalWireBackdropClose(dialogEl, close);

  function open({ title, objective, scopeCount, onCopy, onError }) {
    titleEl.textContent = title;
    objectiveEl.textContent = objective;
    scopeEl.textContent =
      scopeCount === 0
        ? "No plans currently match your filters."
        : `Scoped to the ${scopeCount} plan${scopeCount === 1 ? "" : "s"} currently visible under your active filters.`;
    copyEl.disabled = scopeCount === 0;
    copyEl.textContent = "Copy prompt";
    copyEl.onclick = async () => {
      copyEl.disabled = true;
      copyEl.textContent = "Copying…";
      try {
        await onCopy();
        copyEl.textContent = "Copied!";
      } catch (err) {
        copyEl.textContent = "Copy prompt";
        onError?.(err);
      } finally {
        copyEl.disabled = scopeCount === 0;
      }
    };
    dialogEl.showModal();
  }

  function close() {
    dialogEl.close();
  }

  return { open, close };
}

export function createInfoModal() {
  const infoIconEl = document.getElementById("info-icon");
  const infoModalEl = document.getElementById("info-modal");

  infoIconEl.addEventListener("click", () => setOpen(true));
  document.getElementById("info-modal-close").addEventListener("click", () => setOpen(false));
  portalWireBackdropClose(infoModalEl, () => setOpen(false));
  infoModalEl.addEventListener("close", () => infoIconEl.setAttribute("aria-expanded", "false"));

  function setOpen(open) {
    if (open) infoModalEl.showModal();
    else infoModalEl.close();
    infoIconEl.setAttribute("aria-expanded", String(open));
  }
}

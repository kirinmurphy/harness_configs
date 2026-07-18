// Wiring for the two self-contained chrome panels on the Plans page: the discovery-roots
// ("Project Folders") settings panel and the info modal. Each exposes a small controller so
// app.js can call into it without owning DOM refs or listeners for these panels itself.

import * as api from "./api.js";
import * as tmpl from "./templates.js";

export function createRootsPanel({ onSnapshot, onError }) {
  const rootsEl = document.getElementById("roots");
  const settingsLabelEl = document.getElementById("settings-label");
  const rootsToggleEl = document.getElementById("roots-toggle");
  const rootFormLabelEl = document.getElementById("root-form-label");
  const rootSubmitEl = document.getElementById("root-submit");
  const settingsBodyEl = document.getElementById("settings-body");
  const filtersEl = document.getElementById("filters");
  const rootFormErrEl = document.getElementById("root-form-err");

  let currentRoots = [];

  document.getElementById("root-form").addEventListener("submit", onSubmit);
  rootsToggleEl.addEventListener("click", () => setExpanded(settingsBodyEl.hidden));
  document.getElementById("roots-done").addEventListener("click", () => setExpanded(false));

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
      setExpanded(true); // stay open across multiple adds in one sitting
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
    settingsBodyEl.hidden = !expanded;
    rootsToggleEl.textContent = expanded ? "Close" : "View/Add Folders";
  }

  function render(roots) {
    currentRoots = roots;
    filtersEl.hidden = roots.length === 0;
    if (!roots.length) {
      // Empty state: not a toggleable section — no chevron, no button, form is always visible.
      settingsLabelEl.textContent = "No Project Folders configured";
      rootFormLabelEl.innerHTML = "Look for all <b>/docs/plans</b> folders in:";
      rootsToggleEl.hidden = true;
      settingsBodyEl.hidden = false;
      rootsEl.replaceChildren();
      return;
    }
    // Populated state: title shows a count, body is gated behind the toggle button. The moment we
    // cross from empty (body always shown) to populated, collapse the body by default.
    const wasEmpty = rootsToggleEl.hidden;
    settingsLabelEl.textContent = `Project Folders (${roots.length} selected)`;
    rootFormLabelEl.textContent = "Look for more /docs/plans folders in:";
    rootsToggleEl.hidden = false;
    if (wasEmpty) setExpanded(false);
    rootsEl.replaceChildren(...roots.map((root) => tmpl.rootChip(root, remove)));
  }

  return { render };
}

export function createInfoModal() {
  const infoIconEl = document.getElementById("info-icon");
  const infoModalEl = document.getElementById("info-modal");

  infoIconEl.addEventListener("click", () => setOpen(true));
  document.getElementById("info-modal-close").addEventListener("click", () => setOpen(false));
  infoModalEl.addEventListener("click", (event) => {
    if (event.target === infoModalEl) setOpen(false); // click on the overlay itself, not the panel
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !infoModalEl.hidden) setOpen(false);
  });

  function setOpen(open) {
    infoModalEl.hidden = !open;
    infoIconEl.setAttribute("aria-expanded", String(open));
  }
}

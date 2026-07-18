// Wiring for the Telemetry page's single self-contained chrome panel: the generic detail
// <dialog>. app.js calls into this controller instead of owning the modal's DOM refs and
// listeners itself — mirrors createConfigModal in portal/config/panels.js. Unlike config's two
// independent fetch-shapes (openSource/openSnapshot), telemetry's five call sites
// (openModal/flaggedEventModal/openCaptureModal/openSessionModal, all funneling through one DOM
// primitive) already have their data in hand before calling in, so this controller exposes ONE
// open() shape rather than several — see docs/plans/portal-telemetry-web-components-plan.md.

import { esc } from "./state.js";

export function createDetailModal() {
  const dialogEl = document.getElementById("telemetry-modal");
  const titleEl = document.getElementById("modaltitle");
  const subEl = document.getElementById("modalsub");
  const bodyEl = document.getElementById("modalbody");
  const actionsEl = document.getElementById("modalactions");
  const extraEl = document.getElementById("modalextra");

  document.getElementById("modalclose").addEventListener("click", close);
  dialogEl.addEventListener("click", (event) => {
    if (event.target === dialogEl) close(); // click landed on the dialog's own backdrop area
  });

  // Generic key/value popup. rows is an array of [label, value]; null entries are dropped so
  // callers can include optional fields inline. opts.actions = [{label, onClick}] renders
  // buttons; the extra region is cleared unless a caller fills it (e.g. fetched transcript turns).
  function open(title, sub, rows, opts) {
    titleEl.textContent = title;
    subEl.textContent = sub || "";
    bodyEl.innerHTML = rows
      .filter(Boolean)
      .map((r) => "<dt>" + esc(r[0]) + "</dt><dd>" + (r[1] == null || r[1] === "" ? "—" : esc(r[1])) + "</dd>")
      .join("");
    actionsEl.innerHTML = "";
    extraEl.innerHTML = "";
    for (const a of (opts && opts.actions) || []) {
      const btn = document.createElement("button");
      btn.textContent = a.label;
      btn.addEventListener("click", a.onClick);
      actionsEl.appendChild(btn);
    }
    if (!dialogEl.open) dialogEl.showModal();
  }

  function close() {
    dialogEl.close();
  }

  function extra() {
    return extraEl;
  }

  return { open, close, extra };
}

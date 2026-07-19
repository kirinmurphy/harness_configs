// Wiring for the Config page's single self-contained chrome panel: the source-inspect /
// snapshot-view <dialog>. app.js calls into this controller instead of owning the modal's DOM
// refs and listeners itself. See docs/plans/portal-config-web-components-plan.md — this is a
// panel-factory (like createInfoModal in plans/panels.js), not a custom element: the modal is a
// page singleton referenced by id, never declaratively instantiated or cloned.

import { portalWireBackdropClose } from "/portal/shared/api.js";
import * as api from "./api.js";
import * as tmpl from "./templates.js";

export function createConfigModal() {
  const dialogEl = document.getElementById("config-modal");
  const titleEl = document.getElementById("modal-title");
  const pathEl = document.getElementById("modal-path");
  const contentEl = document.getElementById("modal-content");
  const footerEl = document.getElementById("modal-footer");

  document.getElementById("modal-close").addEventListener("click", close);
  portalWireBackdropClose(dialogEl, close);

  function setHeader(title, pathText) {
    titleEl.textContent = title || "";
    pathEl.textContent = pathText || "";
  }

  function setContent(data) {
    if (data?.html) {
      contentEl.innerHTML = data.html;
    } else {
      contentEl.textContent = data?.content || "(empty)";
    }
  }

  function setFooter(node) {
    if (node) {
      footerEl.replaceChildren(node);
      footerEl.hidden = false;
    } else {
      footerEl.replaceChildren();
      footerEl.hidden = true;
    }
  }

  function open() {
    if (!dialogEl.open) dialogEl.showModal();
  }

  function close() {
    dialogEl.close();
  }

  // fetch-then-show: the source-inspect entry point (inspect-click, config-files grid click).
  async function openSource(inspect, { rules, onDefaultClick }) {
    setHeader(inspect.label || inspect.id, "loading…");
    contentEl.innerHTML = "";
    setFooter(null);
    open();
    try {
      const data = await api.fetchSource(inspect);
      if (!data.ok) {
        setHeader(inspect.label || inspect.id, "");
        contentEl.textContent = "error: " + (data.error || "failed to load");
        return;
      }
      setHeader(data.title || inspect.label, data.path || "");
      setContent(data);
      if (inspect.kind === "live-rules") {
        setFooter(tmpl.modalDefaults(rules, onDefaultClick));
      }
    } catch (e) {
      setHeader(inspect.label || inspect.id, "");
      contentEl.textContent = "error: " + e.message;
    }
  }

  // show-already-known-data: the defaults-menu entry point (globals baseline/claude/codex/packages).
  function openSnapshot(title, pathText, data) {
    setHeader(title, pathText);
    setContent(data);
    setFooter(null);
    open();
  }

  return { openSource, openSnapshot };
}

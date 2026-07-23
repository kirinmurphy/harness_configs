// Panel-factory for a "view docs" popup that renders a server-side Markdown guide in place —
// same idiom as skill-detail-modal.js's createSkillDetailModal (a page-singleton <dialog>, wired
// once, opened/closed via showModal()/close()). The content comes from a caller-supplied fetch
// function so this stays reusable across pages instead of hardcoding one API route; the Telemetry
// page passes fetchTelemetryGuide (GET /api/telemetry/guide -> server-rendered
// docs/guides/telemetry.md), so the popup and the on-disk guide are always the same content, never
// a second copy that can drift.
//
// Deep-linking: open(anchorId) scrolls the freshly-rendered content to the heading whose slug id
// matches anchorId once it exists in the DOM (renderMarkdown() in scripts/cli/markdown-render.mjs
// gives every heading a stable GitHub-style slug id) — info icons throughout the host page pass
// their section's anchor so "view docs" from any panel lands on the relevant section, not the top.
import { portalWireBackdropClose } from "./api.js";

export function createDocGuideModal(dialogEl, fetchGuide) {
  const titleEl = dialogEl.querySelector('[data-slot="title"]');
  const pathEl = dialogEl.querySelector('[data-slot="path"]');
  const contentEl = dialogEl.querySelector('[data-slot="content"]');

  dialogEl.querySelector('[data-slot="close"]').addEventListener("click", close);
  portalWireBackdropClose(dialogEl, close);

  let cachedHtml = null;

  async function open(anchorId = null) {
    dialogEl.showModal();
    if (cachedHtml == null) {
      titleEl.textContent = "loading…";
      pathEl.textContent = "";
      contentEl.innerHTML = "";
      try {
        const data = await fetchGuide();
        if (!data.ok) {
          titleEl.textContent = "docs unavailable";
          contentEl.textContent = "error: " + (data.error || "failed to load");
          return;
        }
        titleEl.textContent = data.title || "Guide";
        pathEl.textContent = data.path || "";
        cachedHtml = data.html || "";
      } catch (err) {
        titleEl.textContent = "docs unavailable";
        contentEl.textContent = "error: " + err.message;
        return;
      }
    }
    contentEl.innerHTML = cachedHtml;
    scrollToAnchor(anchorId);
  }

  function scrollToAnchor(anchorId) {
    if (!anchorId) {
      contentEl.scrollTop = 0;
      return;
    }
    const target = contentEl.querySelector(`#${CSS.escape(anchorId)}`);
    if (target) target.scrollIntoView({ block: "start" });
    else contentEl.scrollTop = 0;
  }

  function close() {
    dialogEl.close();
  }

  return { open, close };
}

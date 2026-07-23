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

// Lazy-loaded once per page (not per popup open) — mermaid.min.js is ~3.5MB, so it's only fetched
// the first time a guide with an actual ```mermaid block is opened, not on every portal page load.
// Vendored locally (portal/shared/vendor/mermaid.min.js) rather than a CDN <script> tag: this is a
// loopback-only, offline-first tool, so a live diagram shouldn't depend on outbound network access.
let mermaidLoadPromise = null;
function loadMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (!mermaidLoadPromise) {
    mermaidLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/portal/shared/vendor/mermaid.min.js";
      script.onload = () => resolve(window.mermaid);
      script.onerror = () => reject(new Error("failed to load mermaid.min.js"));
      document.head.appendChild(script);
    });
  }
  return mermaidLoadPromise;
}

// Renders every ```mermaid block markdown-render.mjs emitted as <pre class="mermaid"
// data-mermaid-source="...">. Runs on every open() — cachedHtml holds the original unrendered
// markup and gets reassigned to contentEl.innerHTML on each open (including reopens), so this
// must re-run each time rather than assuming a first-open render persists in the live DOM.
// Falls back to the escaped source text already sitting in the element (untouched) if mermaid
// fails to load or a specific diagram fails to parse — never a blank box.
async function renderMermaidBlocks(root) {
  const blocks = root.querySelectorAll("pre.mermaid");
  if (!blocks.length) return;
  let mermaid;
  try {
    mermaid = await loadMermaid();
  } catch {
    return; // offline/blocked: leave the escaped source visible, as before this change.
  }
  // Matches whichever theme is active on open — read once here rather than kept in sync with the
  // toggle, since a popup only rarely stays open across a theme switch.
  const isLight = document.documentElement.dataset.theme === "light";
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: isLight ? "default" : "dark" });
  for (const block of blocks) {
    const source = block.dataset.mermaidSource;
    const id = "mmd-" + Math.random().toString(36).slice(2);
    try {
      const { svg } = await mermaid.render(id, source);
      const wrap = document.createElement("div");
      wrap.className = "mermaid-rendered";
      wrap.innerHTML = svg;
      block.replaceWith(wrap);
    } catch {
      // leave block's original escaped-source content in place as the fallback.
    }
  }
}

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
    // cachedHtml always holds the ORIGINAL fetched markup (unrendered <pre class="mermaid">
    // blocks) — reassigning it here on every open, including reopens, is what makes this
    // idempotent to re-run renderMermaidBlocks against each time, rather than trying to skip it
    // and risk leaving a reopened guide's diagrams unrendered.
    contentEl.innerHTML = cachedHtml;
    scrollToAnchor(anchorId);
    renderMermaidBlocks(contentEl);
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

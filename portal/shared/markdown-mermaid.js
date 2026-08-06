// Client-side half of the portal's markdown pipeline: turns the ```mermaid blocks that
// scripts/cli/markdown-render.mjs emits (as <pre class="mermaid" data-mermaid-source="...">) into
// rendered SVG. Shared because every surface that injects server-rendered markdown needs it — the
// Telemetry "view docs" popup, the Config source/skill popup, the shared <skill-detail-modal>, and
// the Plans drawer. It used to live inside doc-guide-modal.js, so only the Telemetry guide ever
// rendered a diagram and everywhere else showed raw diagram source.
//
// Call renderMermaidBlocks(container) after assigning server HTML to container.innerHTML. It is a
// no-op when the container holds no diagrams, so callers can call it unconditionally.

// Lazy-loaded once per page (not per popup open) — mermaid.min.js is ~3.5MB, so it's only fetched
// the first time content with an actual ```mermaid block is rendered, not on every page load.
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

// Safe to re-run against the same container: callers reassign the original (unrendered) markup to
// innerHTML on each open, so this must render every time rather than assume a first pass persists.
// Falls back to the escaped source text already sitting in the element (untouched) if mermaid
// fails to load or a specific diagram fails to parse — never a blank box.
export async function renderMermaidBlocks(root) {
  const blocks = root?.querySelectorAll?.("pre.mermaid");
  if (!blocks || !blocks.length) return;
  let mermaid;
  try {
    mermaid = await loadMermaid();
  } catch {
    return; // offline/blocked: leave the escaped source visible.
  }
  // Matches whichever theme is active at render time — read once here rather than kept in sync
  // with the toggle, since a popup only rarely stays open across a theme switch.
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

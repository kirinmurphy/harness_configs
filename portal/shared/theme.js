// Shared portal chrome: renders the global header, footer, nav, and theme toggle. Every page loads
// this before its own app.js. Adding a portal page = add one entry to PAGES in
// scripts/cli/portal-server.mjs — the server injects it into window.ROBOREPO_PORTAL and the nav
// below picks it up on every page, so there is nothing to hand-sync here.
//
// The no-flash theme *init* is NOT here: it must run before first paint, so it stays as a tiny
// inline <script> in each page's <head>. This file only handles the interactive toggle + nav.
//
// The header/footer/nav-link markup is cloned from <template>s injected via the {{CHROME}}
// marker (portal/shared/chrome-partial.html, rendered server-side in
// scripts/cli/portal-server.mjs) — one source of truth instead of duplicating markup per page.
// The loading overlay is NOT here: it's real markup in the initial HTML (see {{LOADING}} in
// portal-server.mjs) so it's visible on first paint instead of flashing in after this module
// script runs.
import { portalTpl as tpl } from "/portal/shared/api.js";

if (!window.ROBOREPO_PORTAL) {
  throw new Error(
    "portal manifest missing: window.ROBOREPO_PORTAL was not injected into this page",
  );
}
const PORTAL_PAGES = window.ROBOREPO_PORTAL.pages;

(function renderChrome() {
  if (!document.querySelector(".portal-header")) {
    document.body.prepend(tpl("tpl-portal-header"));
  }
  if (!document.querySelector(".portal-footer")) {
    document.body.append(tpl("tpl-portal-footer"));
  }
  const nav = document.getElementById("nav");
  if (!nav) return;
  const here = location.pathname;
  // `hidden: true` pages stay served but out of the nav (e.g. the v1 tokens dashboard at
  // /tokens_v1 during the v2 cutover).
  nav.prepend(
    ...PORTAL_PAGES.filter((p) => !p.hidden).map((p) => {
      const link = tpl("tpl-nav-link");
      link.href = p.path;
      link.textContent = p.title;
      if (p.path === here) link.classList.add("active");
      return link;
    }),
  );
})();

// Theme toggle: sun glyph in dark mode (click -> light), moon in light mode. Choice persists in
// localStorage (key shared with the head init script) and is applied across all portal pages.
// On change we dispatch "roborepo:themechange" on <html> so a page can react (e.g. the telemetry
// dashboard redraws its canvas, whose colors are resolved from CSS vars at draw time).
(function themeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const render = () => {
    const light = document.documentElement.dataset.theme === "light";
    btn.textContent = light ? "☾" : "☀";
    btn.title = light ? "Switch to dark mode" : "Switch to light mode";
  };
  btn.addEventListener("click", () => {
    const next =
      document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("roborepo-theme", next);
    } catch (e) {}
    render();
    document.documentElement.dispatchEvent(
      new CustomEvent("roborepo:themechange", { detail: { theme: next } }),
    );
  });
  render();
})();

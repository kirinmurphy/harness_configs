// Shared portal chrome: renders the global header, footer, nav, and theme toggle. Every page loads
// this before its own app.js. Adding a portal page = add one entry to PAGES in
// scripts/cli/portal-server.mjs — the server injects it into window.ROBOREPO_PORTAL and the nav
// below picks it up on every page, so there is nothing to hand-sync here.
//
// The no-flash theme *init* is NOT here: it must run before first paint, so it stays as a tiny
// inline <script> in each page's <head>. This file only handles the interactive toggle + nav.

if (!window.ROBOREPO_PORTAL) {
  throw new Error(
    "portal manifest missing: window.ROBOREPO_PORTAL was not injected into this page",
  );
}
const PORTAL_PAGES = window.ROBOREPO_PORTAL.pages;

(function renderChrome() {
  if (!document.querySelector(".portal-header")) {
    document.body.insertAdjacentHTML(
      "afterbegin",
      '<header class="portal-header">' +
        '<div class="inner">' +
        '<div class="logo-wrapper">' +
        "<h1>roborepo</h1>" +
        '<span id="portal-updated" class="portal-updated">updated --</span>' +
        "</div>" +
        '<nav id="nav" aria-label="Portal sections"></nav>' +
        "</div>" +
        "</header>",
    );
  }
  if (!document.querySelector(".portal-footer")) {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<footer class="portal-footer">' +
        '<button id="theme-toggle" class="theme-toggle" type="button" aria-label="Toggle theme"></button>' +
        "</footer>",
    );
  }
  if (!document.querySelector(".page-loading")) {
    // Inserted right after the header (not "afterbegin" on body) so the loading block sits in
    // normal flow below the sticky header, not on top of it — the header/footer chrome stays
    // visible while this occupies its own allocated space.
    document.querySelector(".portal-header").insertAdjacentHTML(
      "afterend",
      '<div class="page-loading" id="page-loading"><span class="loading-spinner"></span></div>',
    );
  }
  const nav = document.getElementById("nav");
  if (!nav) return;
  const here = location.pathname;
  const links = PORTAL_PAGES.map((p) => {
    const active =
      p.path === here || (p.path === "/" && here === "/config")
        ? ' class="active"'
        : "";
    return '<a href="' + p.path + '"' + active + ">" + p.title + "</a>";
  }).join("");
  nav.insertAdjacentHTML("afterbegin", links);
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

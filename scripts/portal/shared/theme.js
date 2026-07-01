// Shared portal chrome: renders the nav from one page list and wires the theme toggle. Both pages
// load this before their own app.js. Adding a portal page = add one entry to PORTAL_PAGES here
// (and the matching PAGES entry + folder server-side) — the nav then updates on every page.
//
// The no-flash theme *init* is NOT here: it must run before first paint, so it stays as a tiny
// inline <script> in each page's <head>. This file only handles the interactive toggle + nav.

// Keep in sync with PAGES in scripts/cli/portal-server.mjs (path + title). Order = nav order.
const PORTAL_PAGES = [
  { path: "/", title: "Config" },
  { path: "/telemetry", title: "Telemetry" },
];

(function renderNav() {
  const nav = document.getElementById("nav");
  if (!nav) return;
  const here = location.pathname;
  const links = PORTAL_PAGES.map((p) => {
    const active = p.path === here ? ' class="active"' : "";
    return '<a href="' + p.path + '"' + active + ">" + p.title + "</a>";
  }).join("");
  nav.insertAdjacentHTML(
    "afterbegin",
    links +
      '<button id="theme-toggle" class="theme-toggle" type="button" aria-label="Toggle theme"></button>',
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

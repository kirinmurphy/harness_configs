// <portal-icon name="refresh"> — single reusable element backed by the ICONS registry below.
// Add a new icon anywhere on the site by adding one entry here; every call site just sets `name`.
// Renders inline (no shadow DOM) so page CSS can still target `svg`/`path` the way existing
// call sites already do (e.g. localhoster's setRefreshing() toggles the icon via [hidden]).
const ICONS = {
  refresh: {
    viewBox: "0 0 16 16",
    body: `<path fill="currentColor" d="M8 2.5a5.5 5.5 0 1 0 5.163 3.588.75.75 0 0 1 1.406-.526A7 7 0 1 1 8 1v-.5a.5.5 0 0 1 .82-.385l2.25 1.875a.5.5 0 0 1 0 .77L8.82 4.635A.5.5 0 0 1 8 4.25V2.5Z" />`,
  },
  pencil: {
    viewBox: "0 0 16 16",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" d="M11.3 2.3a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1 0 1.4L5.6 12.8l-2.9.6.6-2.9L11.3 2.3Z" /><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M9.9 3.7l2.4 2.4" />`,
  },
  filter: {
    viewBox: "0 0 16 16",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M2 3h12L9.5 8.2v4.3L6.5 14V8.2L2 3Z" />`,
  },
  "agent-prompt": {
    viewBox: "0 0 16 16",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M2 2.5h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8.8L5.5 13.8V10.5H2a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" />`,
  },
  "external-link": {
    viewBox: "0 0 24 24",
    body: `<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="15 3 21 3 21 9" /><line stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" x1="10" y1="14" x2="21" y2="3" />`,
  },
  warning: {
    viewBox: "0 0 16 16",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" d="M8 1.5 15 13.8H1L8 1.5Z" /><path fill="currentColor" d="M7.4 6h1.2v4.2H7.4V6Z" /><circle fill="currentColor" cx="8" cy="11.7" r="0.75" />`,
  },
  close: {
    viewBox: "0 0 16 16",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M3 3l10 10M13 3 3 13" />`,
  },
  copy: {
    viewBox: "0 0 16 16",
    body: `<rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" /><path fill="none" stroke="currentColor" stroke-width="1.3" d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />`,
  },
  // Success confirmation, paired with `copy` — same 16x16 box and stroke weight so swapping one for
  // the other does not shift the control's metrics.
  check: {
    viewBox: "0 0 16 16",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M3 8.5l3.2 3.2L13 5" />`,
  },

  // Technology glyphs. Deliberately monochrome silhouettes in this set's own style rather than
  // vendor logos: real brand marks are trademarked (this repo installs onto other people's
  // machines) and are multi-color, which would make them the only icons here that ignore
  // currentColor and therefore the only ones that break in one of the two themes.
  //
  // Each is a suggestion of the tool's familiar shape, not a reproduction of its mark.
  // Container ship: stacked deck boxes over a hull.
  docker: {
    viewBox: "0 0 16 16",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M1.5 8.5h9.2c.9 0 1.6-.5 2-1.2M1.5 8.5c0 2.5 1.7 4.5 4.6 4.5 3.4 0 6-1.7 7-4.7" /><rect x="3" y="6.2" width="2" height="2" fill="none" stroke="currentColor" stroke-width="1.1" /><rect x="5.6" y="6.2" width="2" height="2" fill="none" stroke="currentColor" stroke-width="1.1" /><rect x="5.6" y="3.8" width="2" height="2" fill="none" stroke="currentColor" stroke-width="1.1" /><rect x="8.2" y="6.2" width="2" height="2" fill="none" stroke="currentColor" stroke-width="1.1" />`,
  },
  // Node: the hexagon that reads as "node" across the ecosystem.
  node: {
    viewBox: "0 0 16 16",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M8 1.6l5.4 3.1v6.6L8 14.4 2.6 11.3V4.7L8 1.6Z" />`,
  },
  // Supabase: the lightning bolt of its mark, as an outline.
  supabase: {
    viewBox: "0 0 16 16",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M8.8 1.6L3 8.6h4.2v5.8L13 7.4H8.8V1.6Z" />`,
  },
  // ngrok / tunnel: two endpoints joined through a constriction.
  tunnel: {
    viewBox: "0 0 16 16",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M1.8 8h3.4M10.8 8h3.4" /><circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" stroke-width="1.3" />`,
  },
  "git-branch": {
    viewBox: "0 0 16 16",
    body: `<circle cx="4" cy="3" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3" /><circle cx="4" cy="13" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3" /><circle cx="12" cy="6" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3" /><path fill="none" stroke="currentColor" stroke-width="1.3" d="M4 4.6V11.4" /><path fill="none" stroke="currentColor" stroke-width="1.3" d="M4 8c0-2.5 2-3.5 4.5-3.8" />`,
  },
  chevron: {
    viewBox: "0 0 16 16",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M4 6l4 4 4-4" />`,
  },

  // Portal section glyphs — the monochrome entry-point icons for Home's destination cards.
  // Same stroke family as the rest of this set (1.3 weight, round caps/joins, currentColor).
  // Home: a house — roof peak over a door, read as "start here".
  home: {
    viewBox: "0 0 16 16",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" d="M2.5 7.6 8 3l5.5 4.6" /><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M4 6.8V13h8V6.8" /><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M6.5 13v-3h3v3" />`,
  },
  // Agents: a small robot head — the harness/prompt side of the portal. A neutral bot mark rather
  // than a vendor silhouette, so it can't be misread as a brand logo.
  agents: {
    viewBox: "0 0 16 16",
    body: `<rect x="3.5" y="6" width="9" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="1.3" /><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M8 3.5V6" /><circle cx="8" cy="2.8" r="1.1" fill="none" stroke="currentColor" stroke-width="1.3" /><path fill="currentColor" d="M6.4 9.3h.01M9.6 9.3h.01" />`,
  },
  // Plans: a checklist document — a bordered sheet with a check, read as "implementation plan".
  plans: {
    viewBox: "0 0 16 16",
    body: `<rect x="3" y="2.5" width="10" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" /><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M5.6 6.6l1.3 1.3 2.6-2.8" />`,
  },
  // Tokens: a coin — a token unit. The inner "T" notches read as a minted value without needing a
  // currency glyph.
  tokens: {
    viewBox: "0 0 16 16",
    body: `<circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.3" /><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M6.4 6.4h3.2M8 6.4v3.2" />`,
  },
  // Localhost: a terminal — the dev-server / local process side of the portal.
  localhost: {
    viewBox: "0 0 16 16",
    body: `<rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" /><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M5 6.5l2 2-2 2" /><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M8.5 10.5h2.5" />`,
  },
};

// A fixed scale, not free-form pixel values. Call sites pick a step (`size="sm"`); they do not get
// to invent a size, and page CSS must not shrink an icon below the scale with a bare `svg { width }`
// rule — every step here is chosen to stay legible, and 10px-class icons (which this page had) are
// not. `md` is the default and matches the body-text cap height.
//
// The floor sits at 16px: at 14 the stroke-heavy glyphs in this set (git-branch's three circles,
// the copy sheets) lost their interior detail and read as smudges next to text, which is what made
// the small icons on the repository card hard to identify. Each step is ~1.25x its predecessor so
// the gaps stay visually distinct rather than being pixel-adjacent.
const ICON_SIZES = { sm: 16, md: 20, lg: 24, xl: 30, xxl: 40, xxxl: 48 };
const DEFAULT_ICON_SIZE = "md";

class PortalIcon extends HTMLElement {
  static observedAttributes = ["name", "size"];

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  render() {
    const name = this.getAttribute("name");
    const icon = ICONS[name];
    if (!icon) {
      this.replaceChildren();
      return;
    }
    const size = ICON_SIZES[this.getAttribute("size")] || ICON_SIZES[DEFAULT_ICON_SIZE];
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", icon.viewBox);
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = icon.body;
    this.replaceChildren(svg);
  }
}

if (!customElements.get("portal-icon")) customElements.define("portal-icon", PortalIcon);

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
  "git-branch": {
    viewBox: "0 0 16 16",
    body: `<circle cx="4" cy="3" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3" /><circle cx="4" cy="13" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3" /><circle cx="12" cy="6" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3" /><path fill="none" stroke="currentColor" stroke-width="1.3" d="M4 4.6V11.4" /><path fill="none" stroke="currentColor" stroke-width="1.3" d="M4 8c0-2.5 2-3.5 4.5-3.8" />`,
  },
  chevron: {
    viewBox: "0 0 16 16",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M4 6l4 4 4-4" />`,
  },
};

class PortalIcon extends HTMLElement {
  static observedAttributes = ["name"];

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
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", icon.viewBox);
    svg.setAttribute("width", this.getAttribute("width") || "15");
    svg.setAttribute("height", this.getAttribute("height") || "15");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = icon.body;
    this.replaceChildren(svg);
  }
}

if (!customElements.get("portal-icon")) customElements.define("portal-icon", PortalIcon);

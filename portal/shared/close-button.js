// <portal-close-button></portal-close-button> — the shared X-icon close control used by every
// dialog/drawer head. Renders a <button class="close-button"> with the shared "close" icon; a
// native click on that inner button bubbles through the host element unchanged, so existing
// id/data-close/data-slot wiring (querySelector + addEventListener against the host) keeps working.
class PortalCloseButton extends HTMLElement {
  static observedAttributes = ["aria-label"];

  connectedCallback() {
    if (this.button) {
      this.syncAttributes();
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "close-button";
    const icon = document.createElement("portal-icon");
    icon.setAttribute("name", "close");
    icon.setAttribute("width", "14");
    icon.setAttribute("height", "14");
    button.append(icon);
    this.button = button;
    this.replaceChildren(button);
    this.syncAttributes();
  }

  attributeChangedCallback() {
    this.syncAttributes();
  }

  syncAttributes() {
    if (!this.button) return;
    const label = this.getAttribute("aria-label") || "Close";
    this.button.setAttribute("aria-label", label);
  }
}

if (!customElements.get("portal-close-button"))
  customElements.define("portal-close-button", PortalCloseButton);

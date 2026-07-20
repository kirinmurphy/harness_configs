class PortalInfoIcon extends HTMLElement {
  static observedAttributes = ["aria-expanded", "aria-haspopup", "aria-label", "title"];

  connectedCallback() {
    if (!this.button) {
      this.button = document.createElement("button");
      this.button.type = "button";
      this.button.className = "info-icon";
      this.button.textContent = "i";
      this.replaceChildren(this.button);
    }
    this.syncAttributes();
  }

  attributeChangedCallback() {
    this.syncAttributes();
  }

  syncAttributes() {
    if (!this.button) return;
    for (const name of PortalInfoIcon.observedAttributes) {
      const value = this.getAttribute(name);
      if (value == null) this.button.removeAttribute(name);
      else this.button.setAttribute(name, value);
    }
  }
}

customElements.define("portal-info-icon", PortalInfoIcon);

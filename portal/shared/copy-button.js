// <portal-copy-button label="Copy path"></portal-copy-button> — a button that copies text to the
// clipboard and shows "Copied!" for a few seconds instead of managing that state per call site.
//
// Usage: set `.copySource` right after creation to a string, or a function returning a string
// (sync or async) — resolved lazily at click time so callers can build the text on demand instead
// of computing it up front for every row. Attributes: `label` (button text; omit for an icon-only
// button), `icon` (portal-icon name, defaults to "copy").
//
// Both the idle and "Copied!" contents are always in the DOM, stacked in the same grid cell (one
// hidden via visibility, not `display:none`) so the button's own intrinsic width already accounts
// for the wider of the two labels — swapping state never reflows or resizes the button.
import { portalCopyText } from "./api.js";

const COPIED_DURATION_MS = 5000;

class PortalCopyButton extends HTMLElement {
  static observedAttributes = ["label", "icon", "disabled"];

  connectedCallback() {
    if (this.button) {
      this.syncAttributes();
      return;
    }
    const label = this.getAttribute("label");
    const iconName = this.getAttribute("icon") || "copy";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-button";

    const idle = document.createElement("span");
    idle.className = "copy-button-state copy-button-idle";
    const icon = document.createElement("portal-icon");
    icon.setAttribute("name", iconName);
    icon.setAttribute("width", "14");
    icon.setAttribute("height", "14");
    idle.append(icon);
    if (label) idle.append(document.createTextNode(label));

    const copied = document.createElement("span");
    copied.className = "copy-button-state copy-button-copied";
    copied.textContent = "Copied!";
    copied.setAttribute("aria-hidden", "true");

    button.append(idle, copied);
    button.addEventListener("click", () => this.#handleClick());

    this.button = button;
    this.replaceChildren(button);
    this.syncAttributes();
  }

  disconnectedCallback() {
    clearTimeout(this._resetTimer);
  }

  attributeChangedCallback() {
    this.syncAttributes();
  }

  syncAttributes() {
    if (!this.button) return;
    const label = this.getAttribute("label");
    this.button.setAttribute("aria-label", label || "Copy");
    this.button.disabled = this.hasAttribute("disabled") || this._copied;
  }

  async #handleClick() {
    if (this._copied) return;
    const source = typeof this.copySource === "function" ? this.copySource() : this.copySource;
    const text = await source;
    if (typeof text !== "string") return;
    await portalCopyText(text, () => this.#showCopied());
  }

  #showCopied() {
    this._copied = true;
    this.button.classList.add("copy-button-showing-copied");
    this.button.disabled = true;
    clearTimeout(this._resetTimer);
    this._resetTimer = setTimeout(() => {
      this._copied = false;
      this.button.classList.remove("copy-button-showing-copied");
      this.syncAttributes();
    }, COPIED_DURATION_MS);
  }
}

if (!customElements.get("portal-copy-button"))
  customElements.define("portal-copy-button", PortalCopyButton);

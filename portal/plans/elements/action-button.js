// <action-button label="Open"></action-button> — a button that owns click error handling.
// Set .onClick/.onError as properties right after creation (functions aren't attribute-safe).
class ActionButtonElement extends HTMLElement {
  connectedCallback() {
    if (this.querySelector("button")) return; // already rendered (e.g. re-connected node)
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = this.getAttribute("label") || "";
    button.addEventListener("click", () => this.#handleClick());
    this.replaceChildren(button);
  }

  #handleClick() {
    try {
      const result = this.onClick?.();
      if (result?.catch) result.catch((err) => this.onError?.(err));
    } catch (err) {
      this.onError?.(err);
    }
  }
}

customElements.define("action-button", ActionButtonElement);

// <filter-chip filter-id="repository" label="repo" value="architecture_blog"></filter-chip>
// Dispatches a bubbling "chip-remove" CustomEvent (detail: filterId) when its × is clicked.
class FilterChipElement extends HTMLElement {
  connectedCallback() {
    if (this.querySelector(".filter-chip")) return; // already rendered
    const wrapper = document.createElement("span");
    wrapper.className = "filter-chip";

    const label = document.createElement("span");
    label.className = "filter-chip-label";
    label.textContent = this.getAttribute("label") || "";

    const value = document.createElement("span");
    value.className = "filter-chip-value";
    value.textContent = this.getAttribute("value") || "";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "filter-chip-remove";
    remove.title = "Remove filter";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      this.dispatchEvent(
        new CustomEvent("chip-remove", { detail: this.getAttribute("filter-id"), bubbles: true }),
      );
    });

    wrapper.append(label, value, remove);
    this.replaceChildren(wrapper);
  }
}

customElements.define("filter-chip", FilterChipElement);

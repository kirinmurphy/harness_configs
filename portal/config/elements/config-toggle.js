// <config-toggle></config-toggle> — one on/off switch for a mutable config item. Set .item (the
// behaviorView item, needs .active/.label) and .onToggle (async (item, enabled) => void — caller
// owns the POST + re-render) as properties right after creation. Optimistic-disable while the
// POST is in flight; reverts + shows the error on failure. Status text renders into a sibling
// .item-status node the caller passes as .statusSlot (the row's own status line, shared with
// other item feedback — not owned by this element).
class ConfigToggleElement extends HTMLElement {
  connectedCallback() {
    if (this._item) this.render();
  }

  set item(value) {
    this._item = value;
    if (this.isConnected) this.render();
  }
  get item() {
    return this._item;
  }

  set onToggle(fn) {
    this._onToggle = fn;
  }
  get onToggle() {
    return this._onToggle;
  }

  set statusSlot(node) {
    this._statusSlot = node;
  }
  get statusSlot() {
    return this._statusSlot;
  }

  render() {
    const label = document.createElement("label");
    label.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!this._item.active;
    input.setAttribute("aria-label", this._item.label);
    const track = document.createElement("span");
    track.className = "switch-track";
    track.appendChild(Object.assign(document.createElement("span"), { className: "switch-knob" }));
    label.append(input, track);

    input.addEventListener("change", async () => {
      const enabled = input.checked;
      const statusSlot = this._statusSlot;
      input.disabled = true;
      if (statusSlot) {
        statusSlot.className = "item-status";
        statusSlot.textContent = "applying…";
      }
      try {
        await this._onToggle?.(this._item, enabled);
        if (statusSlot) statusSlot.textContent = "saved";
      } catch (e) {
        input.checked = !enabled; // revert
        if (statusSlot) {
          statusSlot.className = "item-status error";
          statusSlot.textContent = e.message;
        }
      } finally {
        input.disabled = false;
      }
    });

    this.replaceChildren(label);
  }
}

customElements.define("config-toggle", ConfigToggleElement);

// <config-item></config-item> — one row in a standard config section (Token Optimization,
// Commands, Code Conventions, Chat-Time Output). Set .item (the behaviorView item) and .actions
// ({onInspect, onToggle}) as properties right after creation. Builds itself from the
// tpl-config-item template, owns conditional listener wiring (inspect-click, toggle-swap)
// internally, embeds <config-toggle> in its toggle slot when the item is mutable.
import { portalTpl as tpl, portalFillSlots as fill } from "/portal/shared/api.js";

function badge(text) {
  const isCmd = text.startsWith("/");
  const node = fill(tpl("tpl-badge"), { text });
  node.classList.add(isCmd ? "badge-cmd" : "badge-skill");
  return node;
}

class ConfigItemElement extends HTMLElement {
  connectedCallback() {
    if (this._item && this._actions) this.render();
  }

  set item(value) {
    this._item = value;
    if (this.isConnected && this._actions) this.render();
  }
  get item() {
    return this._item;
  }

  set actions(value) {
    this._actions = value;
    if (this.isConnected && this._item) this.render();
  }
  get actions() {
    return this._actions;
  }

  render() {
    const item = this._item;
    const { onInspect, onToggle } = this._actions;
    const row = fill(tpl("tpl-config-item"), {
      description: item.description,
      hint: item.hint,
    });

    const dotEl = row.querySelector('[data-slot="dot"]');
    dotEl.classList.add(item.active ? "on" : "off");

    // Inspectable items (skills/commands/chat-time rules) get a clickable label that opens the
    // source popup. The label still reflects active/dim state.
    const labelEl = row.querySelector('[data-slot="label"]');
    labelEl.classList.toggle("dim", !item.active);
    labelEl.classList.toggle("clickable", !!item.inspect);
    labelEl.textContent = item.label;
    if (item.inspect) {
      labelEl.title = "view source";
      labelEl.addEventListener("click", () => onInspect(item.inspect));
    }

    // Info URL (GitHub / docs / PyPI): a single inline icon on the label row, opening the FIRST
    // urls[] entry. Items with more than one URL only expose that first one via the portal — any
    // additional related links must be reachable from that page instead (e.g. its README).
    const linkEl = row.querySelector('[data-slot="link-icon"]');
    if (item.urls && item.urls.length) {
      linkEl.href = item.urls[0].url;
      linkEl.title = item.urls[0].url;
      linkEl.hidden = false;
    }

    row.querySelector('[data-slot="description"]').hidden = !item.description;
    row.querySelector('[data-slot="hint"]').hidden = !item.hint;

    row.querySelector('[data-slot="badges"]').replaceChildren(
      ...(item.badges || []).map((b) => badge(b)),
    );

    const statusEl = row.querySelector('[data-slot="status"]');
    const toggleSlot = row.querySelector('[data-slot="toggle"]');
    if (item.toggle) {
      const toggle = document.createElement("config-toggle");
      toggle.item = item;
      toggle.onToggle = onToggle;
      toggle.statusSlot = statusEl;
      toggleSlot.replaceWith(toggle);
    } else {
      toggleSlot.remove();
    }

    this.replaceChildren(row);
  }
}

customElements.define("config-item", ConfigItemElement);

// <config-item></config-item> — one row in a standard config section (Token Optimization,
// Commands, Code Conventions, Chat-Time Output). Set .item (the behaviorView item) and .actions
// ({onInspect, onToggle}) as properties right after creation. Builds itself from the
// tpl-config-item template, owns conditional listener wiring (inspect-click, toggle-swap)
// internally, embeds <config-toggle> in its toggle slot when the item is mutable.
import { portalTpl as tpl, portalEl as el } from "/portal/shared/api.js";

function dot(on) {
  return el("span", { class: "dot " + (on ? "on" : "off") });
}

function badge(text) {
  const isCmd = text.startsWith("/");
  return el("span", { class: "badge " + (isCmd ? "badge-cmd" : "badge-skill") }, text);
}

function setOptionalText(node, value) {
  node.textContent = value || "";
  node.hidden = !value;
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
    const row = tpl("tpl-config-item");

    row.querySelector('[data-slot="dot"]').replaceWith(dot(item.active));

    // Inspectable items (skills/commands/chat-time rules) get a clickable label that opens the
    // source popup. The label still reflects active/dim state.
    const labelEl = row.querySelector('[data-slot="label"]');
    labelEl.className =
      "item-label" + (item.active ? "" : " dim") + (item.inspect ? " clickable" : "");
    labelEl.textContent = item.label;
    if (item.inspect) {
      labelEl.title = "view source";
      labelEl.addEventListener("click", () => onInspect(item.inspect));
    }

    // Info URL (GitHub / docs / PyPI): a single inline icon on the label row, opening the FIRST
    // urls[] entry. Items with more than one URL only expose that first one via the portal — any
    // additional related links must be reachable from that page instead (e.g. its README).
    if (item.urls && item.urls.length) {
      const link = el("a", { class: "item-link-icon", title: item.urls[0].url }, "↗");
      link.href = item.urls[0].url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      labelEl.insertAdjacentElement("afterend", link);
    }

    row.querySelector('[data-slot="badges"]').replaceChildren(
      ...(item.badges || []).map((b) => badge(b)),
    );
    setOptionalText(row.querySelector('[data-slot="description"]'), item.description);
    setOptionalText(row.querySelector('[data-slot="hint"]'), item.hint);

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

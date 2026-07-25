// <option-dropdown></option-dropdown> — shared popover listbox. Click the trigger, pick an item.
// Caller owns the mutation: .onSelect is invoked with the chosen value but the element does not
// update .value itself — set .value back once the caller's own state/write settles (mirrors
// bucket-control.js's caller-owns-state convention).
//
// Properties (set as JS properties after creation):
//   .options   [[value, label]]  — required
//   .value     string            — currently-selected value
//   .onSelect  async (value) => {}
//   .loading   boolean — disables the trigger, shows a spinner instead of the chevron, closes menu
//   .disabled  boolean — disables the trigger without implying an in-flight write
import { positionPopoverPanel } from "/portal/shared/popover-position.js";

class OptionDropdownElement extends HTMLElement {
  connectedCallback() {
    // Template-cloned elements can receive property assignments before upgrade; those land as
    // own properties that shadow the class setters. Re-adopt them so the setters actually run.
    for (const key of ["options", "value", "onSelect", "loading", "disabled"]) {
      if (Object.prototype.hasOwnProperty.call(this, key)) {
        const v = this[key];
        delete this[key];
        this[key] = v;
      }
    }
    this._open = false;
    this._highlighted = -1;
    // render() rebuilds the trigger/menu on every toggle, so by the time this fires the original
    // click target may already be detached from the DOM (this.contains() would wrongly say
    // "outside"). Guard with a same-tick flag set by the trigger's own click handler instead.
    this._justToggled = false;
    this._onDocClick = () => {
      if (this._justToggled) {
        this._justToggled = false;
        return;
      }
      if (this._open) this.close();
    };
    document.addEventListener("click", this._onDocClick);
    this.render();
  }

  disconnectedCallback() {
    document.removeEventListener("click", this._onDocClick);
  }

  set options(value) {
    this._options = Array.isArray(value) ? value : [];
    if (this.isConnected) this.render();
  }
  get options() {
    return this._options || [];
  }

  set value(value) {
    this._value = value;
    if (this.isConnected) this.render();
  }
  get value() {
    return this._value;
  }

  set onSelect(fn) {
    this._onSelect = fn;
  }

  set loading(value) {
    this._loading = Boolean(value);
    if (this._loading) this.close();
    if (this.isConnected) this.render();
  }
  get loading() {
    return Boolean(this._loading);
  }

  set disabled(value) {
    this._disabled = Boolean(value);
    if (this.isConnected) this.render();
  }
  get disabled() {
    return Boolean(this._disabled);
  }

  currentLabel() {
    const match = this.options.find(([v]) => v === this._value);
    return match ? match[1] : String(this._value ?? "");
  }

  open() {
    if (this._loading || this._disabled || this.options.length === 0) return;
    this._open = true;
    this._highlighted = this.options.findIndex(([v]) => v === this._value);
    this.render();
    this.positionMenu();
  }

  close() {
    if (!this._open) return;
    this._open = false;
    this.render();
  }

  toggle() {
    if (this._open) this.close();
    else this.open();
  }

  select(value) {
    this.close();
    this._onSelect?.(value);
  }

  positionMenu() {
    const menu = this.querySelector(".dropdown-menu");
    const trigger = this.querySelector(".dropdown-trigger");
    if (!menu || !trigger) return;
    // Shared positioner clamps max-height so the far edge stays on-screen and the list scrolls
    // internally when it's taller than the room on either side.
    positionPopoverPanel(menu, trigger);
    menu.style.minWidth = trigger.getBoundingClientRect().width + "px";
  }

  moveHighlight(delta) {
    const count = this.options.length;
    if (!count) return;
    this._highlighted = (this._highlighted + delta + count) % count;
    this.render();
  }

  render() {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "dropdown-trigger";
    trigger.disabled = this._loading || this._disabled;
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", String(this._open));

    if (this._loading) {
      const spinner = document.createElement("span");
      spinner.className = "spinner";
      trigger.append(spinner);
    } else {
      trigger.append(this.currentLabel());
      const chevron = document.createElement("span");
      chevron.className = "dropdown-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "▾";
      trigger.append(chevron);
    }

    trigger.addEventListener("click", () => {
      this._justToggled = true;
      this.toggle();
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!this._open) this.open();
        else this.moveHighlight(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!this._open) this.open();
        else this.moveHighlight(-1);
      } else if (event.key === "Enter" || event.key === " ") {
        if (this._open && this._highlighted >= 0) {
          event.preventDefault();
          this.select(this.options[this._highlighted][0]);
        }
      } else if (event.key === "Escape") {
        this.close();
      }
    });

    const nodes = [trigger];

    if (this._open) {
      const menu = document.createElement("div");
      menu.className = "dropdown-menu";
      menu.setAttribute("role", "listbox");
      this.options.forEach(([value, label], index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "dropdown-option" + (index === this._highlighted ? " highlighted" : "");
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(value === this._value));
        item.textContent = label;
        item.addEventListener("click", (event) => {
          event.stopPropagation();
          this.select(value);
        });
        menu.append(item);
      });
      nodes.push(menu);
    }

    this.replaceChildren(...nodes);
    if (this._open) this.positionMenu();
  }
}

customElements.define("option-dropdown", OptionDropdownElement);

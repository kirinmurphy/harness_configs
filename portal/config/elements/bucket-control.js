// <bucket-control></bucket-control> — a deny/ask/allow segmented control. Set .current (bucket
// string) and .onSelect (async callback — caller owns confirm+POST+error-routing; the element
// does NOT bake in a confirm-dialog policy since the message text differs by call site) as
// properties right after creation.
import { portalTpl as tpl } from "/portal/shared/api.js";

// Display order, loosest to strictest. Validation order lives in config-mutate.mjs and is
// order-independent; changing this array only changes how the segmented control reads.
const BUCKETS = ["allow", "ask", "deny"];

class BucketControlElement extends HTMLElement {
  connectedCallback() {
    if (this._current !== undefined) this.render();
  }

  set current(value) {
    this._current = value;
    if (this.isConnected) this.render();
  }
  get current() {
    return this._current;
  }

  set onSelect(fn) {
    this._onSelect = fn;
  }
  get onSelect() {
    return this._onSelect;
  }

  render() {
    const wrap = document.createElement("div");
    wrap.className = "bucket-group";
    for (const bucket of BUCKETS) {
      const btn = tpl("tpl-bucket-btn");
      btn.classList.add("bucket-" + bucket);
      btn.textContent = bucket;
      btn.classList.toggle("current", bucket === this._current);
      btn.disabled = bucket === this._current;
      btn.addEventListener("click", () => this._onSelect?.(bucket));
      wrap.appendChild(btn);
    }
    this.replaceChildren(wrap);
  }
}

customElements.define("bucket-control", BucketControlElement);

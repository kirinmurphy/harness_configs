// <bucket-control></bucket-control> — a deny/ask/allow segmented control. Set .current (bucket
// string) and .onSelect (async callback — caller owns confirm+POST+error-routing; the element
// does NOT bake in a confirm-dialog policy since the message text differs by call site) as
// properties right after creation. .compact toggles the tighter spacing used in arbitrary-command
// rows. Eliminates the deny/ask/allow button-building loop that was duplicated near-verbatim
// between behaviorRow and arbitraryListRow in templates.js.
import { portalTpl as tpl } from "/portal/shared/api.js";

const BUCKETS = ["deny", "ask", "allow"];

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

  set compact(value) {
    this._compact = !!value;
    if (this.isConnected) this.render();
  }
  get compact() {
    return !!this._compact;
  }

  render() {
    const wrap = document.createElement("div");
    wrap.className = "bucket-group" + (this._compact ? " bucket-group-compact" : "");
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

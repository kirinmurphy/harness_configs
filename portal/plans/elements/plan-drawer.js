// <plan-drawer id="drawer" hidden>...</plan-drawer> — a persistent right-aligned side panel, not
// a <dialog> (see docs/plans/portal-web-components-dialog-plan.md for why). Its light-DOM content
// is static markup already in index.html; this element only owns open/close/Escape/backdrop-click,
// none of which existed for the drawer before (a real gap — the info-modal had this, the drawer
// didn't). Call .open() to show it and .close() to hide it; content population stays in app.js.
class PlanDrawerElement extends HTMLElement {
  connectedCallback() {
    this.addEventListener("click", (event) => {
      if (event.target === this) this.close(); // click landed on the backdrop area, not the panel
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.hidden) this.close();
    });
  }

  open() {
    this.hidden = false;
  }

  close() {
    this.hidden = true;
  }
}

customElements.define("plan-drawer", PlanDrawerElement);

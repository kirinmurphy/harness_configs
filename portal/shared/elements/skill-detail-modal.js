// <skill-detail-modal id="skill-modal"></skill-detail-modal> — a self-contained popup for
// viewing a skill's source (same content the Config page shows for a skill card), reusable from
// any portal page. Renders its own <dialog> in connectedCallback so it needs no page-authored
// markup or page-specific CSS classes; only the light-DOM structure/tokens (--panel, --line,
// --backdrop, .markdown) that every portal page already shares via base.css. Call .open(skillId)
// to fetch and show it.
import { portalGetJson } from "../api.js";

class SkillDetailModalElement extends HTMLElement {
  #dialog;
  #title;
  #path;
  #content;

  connectedCallback() {
    if (this.#dialog) return; // already rendered (e.g. re-connected node)
    this.innerHTML = `
      <style>
        skill-detail-modal dialog.sdm-dialog {
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 8px;
          max-width: 900px;
          width: 100%;
          max-height: 85vh;
          padding: 0;
        }
        skill-detail-modal dialog.sdm-dialog[open] {
          display: flex;
          flex-direction: column;
        }
        skill-detail-modal dialog.sdm-dialog::backdrop {
          background: var(--backdrop);
        }
        skill-detail-modal .sdm-head {
          padding: 12px 16px;
          border-bottom: 1px solid var(--line);
          display: flex;
          align-items: center;
          gap: 12px;
        }
        skill-detail-modal .sdm-title {
          font-size: var(--text-sm);
          color: var(--ink);
          font-weight: 600;
        }
        skill-detail-modal .sdm-path {
          font-size: var(--text-2xs);
          color: var(--dim);
        }
        skill-detail-modal .sdm-close {
          margin-left: auto;
          background: none;
          border: 1px solid var(--line);
          color: var(--dim);
          border-radius: 5px;
          padding: 3px 9px;
          cursor: pointer;
          font: inherit;
        }
        skill-detail-modal .sdm-close:hover {
          color: var(--ink);
          border-color: var(--dim);
        }
        skill-detail-modal .sdm-body {
          padding: 14px 16px;
          overflow: auto;
        }
      </style>
      <dialog class="sdm-dialog">
        <div class="sdm-head">
          <span class="sdm-title"></span>
          <span class="sdm-path"></span>
          <button type="button" class="sdm-close">✕</button>
        </div>
        <div class="sdm-body markdown"></div>
      </dialog>
    `;
    this.#dialog = this.querySelector(".sdm-dialog");
    this.#title = this.querySelector(".sdm-title");
    this.#path = this.querySelector(".sdm-path");
    this.#content = this.querySelector(".sdm-body");

    this.querySelector(".sdm-close").addEventListener("click", () => this.close());
    this.#dialog.addEventListener("click", (event) => {
      if (event.target === this.#dialog) this.close(); // click landed on the dialog's own backdrop area
    });
  }

  async open(skillId, label) {
    this.#title.textContent = label || skillId;
    this.#path.textContent = "loading…";
    this.#content.innerHTML = "";
    this.#dialog.showModal();
    try {
      const data = await portalGetJson(
        `/api/config/source?kind=skill&id=${encodeURIComponent(skillId)}`,
      );
      if (!data.ok) {
        this.#path.textContent = "";
        this.#content.textContent = "error: " + (data.error || "failed to load");
        return;
      }
      this.#title.textContent = data.title || label || skillId;
      this.#path.textContent = data.path || "";
      this.#content.innerHTML = data.html || "";
    } catch (err) {
      this.#path.textContent = "";
      this.#content.textContent = "error: " + err.message;
    }
  }

  close() {
    this.#dialog.close();
  }
}

customElements.define("skill-detail-modal", SkillDetailModalElement);

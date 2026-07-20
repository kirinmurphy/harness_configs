// <token-chip></token-chip> — shared solid-color chip for token-cost estimates, colored by a
// low/medium/high level, with an optional ⓘ info affordance and a hover/click tooltip that can
// carry a breakdown table. One component so every page renders cost the same way.
//
// Properties (set as JS properties after creation, before/after connect both work):
//   .tokens    number  — estimated tokens (required)
//   .level     "low" | "medium" | "high" | null — null renders the muted variant
//   .detail    string  — one-line tooltip note under the header
//   .breakdown [{ label, tokens }] — tooltip table rows; a Total row is appended automatically
//   .legend    { mediumAt, highAbove } — renders a Low/Med/High range legend in the tooltip
//   .info      boolean — show the ⓘ icon (default true when there is tooltip content)
//
// Chip text is always plain "~N tokens" — never "startup"/"when loaded"/etc. When a distinction
// matters (e.g. a skill's startup vs. on-invocation cost), the caller places a text label
// ("Startup:", "When loaded:") next to the chip rather than baking it into the chip itself.
//
// Styling lives in base.css (.token-chip / .chip-tip) so light/dark stay in one palette file.

export function formatTokens(n) {
  if (!Number.isFinite(n)) return "";
  if (n >= 1000) {
    const k = n / 1000;
    return "~" + (k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")) + "k";
  }
  return "~" + Math.round(n);
}

const LEVEL_WORD = { low: "Low", medium: "Medium", high: "High" };

class TokenChipElement extends HTMLElement {
  connectedCallback() {
    // Template-cloned chips can receive property assignments before the element upgrades;
    // those land as own properties that shadow the class setters. Re-adopt them so the
    // setters (and render) actually run.
    for (const key of ["tokens", "level", "detail", "breakdown", "legend", "info"]) {
      if (Object.prototype.hasOwnProperty.call(this, key)) {
        const value = this[key];
        delete this[key];
        this[key] = value;
      }
    }
    this.render();
  }

  set tokens(value) {
    this._tokens = value;
    if (this.isConnected) this.render();
  }
  get tokens() {
    return this._tokens;
  }

  set level(value) {
    this._level = value;
    if (this.isConnected) this.render();
  }
  get level() {
    return this._level;
  }

  set detail(value) {
    this._detail = value;
    if (this.isConnected) this.render();
  }

  set breakdown(value) {
    this._breakdown = value;
    if (this.isConnected) this.render();
  }

  set legend(value) {
    this._legend = value;
    if (this.isConnected) this.render();
  }

  set info(value) {
    this._info = value;
    if (this.isConnected) this.render();
  }

  hasTip() {
    return Boolean(this._detail || (this._breakdown || []).length || this._legend || this._level);
  }

  render() {
    if (!Number.isFinite(this._tokens)) {
      this.replaceChildren();
      return;
    }
    const chip = document.createElement("span");
    chip.className = "token-chip" + (this._level ? " level-" + this._level : "");
    chip.append(formatTokens(this._tokens) + " tokens");

    const showInfo = this._info ?? this.hasTip();
    if (showInfo) {
      const icon = document.createElement("span");
      icon.className = "chip-info";
      icon.textContent = "ⓘ";
      icon.setAttribute("aria-hidden", "true");
      chip.append(icon);
    }

    if (this.hasTip()) {
      const tip = this.buildTip();
      chip.append(tip);
      chip.tabIndex = 0;
      chip.setAttribute("role", "button");
      chip.setAttribute("aria-expanded", "false");
      const show = () => {
        // position:fixed, placed from the chip's live viewport rect — this escapes any
        // ancestor's overflow:hidden/clipping (e.g. the Generated Files grid's rounded-corner
        // clip) instead of relying on absolute positioning inside the chip.
        const rect = chip.getBoundingClientRect();
        const rightAligned = rect.left + rect.width / 2 > window.innerWidth / 2;
        // Flip above the chip when there isn't roughly a tooltip's height of room below it.
        const openAbove = window.innerHeight - rect.bottom < 220;
        if (openAbove) {
          tip.style.top = "auto";
          tip.style.bottom = window.innerHeight - rect.top + 6 + "px";
        } else {
          tip.style.bottom = "auto";
          tip.style.top = rect.bottom + 6 + "px";
        }
        if (rightAligned) {
          tip.style.right = window.innerWidth - rect.right + "px";
          tip.style.left = "auto";
        } else {
          tip.style.left = rect.left + "px";
          tip.style.right = "auto";
        }
        tip.hidden = false;
        chip.setAttribute("aria-expanded", "true");
      };
      const hide = () => {
        tip.hidden = true;
        chip.setAttribute("aria-expanded", "false");
      };
      chip.addEventListener("mouseenter", show);
      chip.addEventListener("mouseleave", hide);
      chip.addEventListener("focus", show);
      chip.addEventListener("blur", hide);
      chip.addEventListener("click", () => (tip.hidden ? show() : hide()));
      chip.addEventListener("keydown", (e) => {
        if (e.key === "Escape") hide();
      });
    }

    this.replaceChildren(chip);
  }

  buildTip() {
    const tip = document.createElement("span");
    tip.className = "chip-tip";
    tip.hidden = true;

    const head = document.createElement("span");
    head.className = "chip-tip-head";
    head.textContent = Math.round(this._tokens).toLocaleString() + " tokens"
      + (this._level ? " · " + (LEVEL_WORD[this._level] || this._level) : "");
    tip.append(head);

    if (this._detail) {
      const note = document.createElement("span");
      note.className = "chip-tip-note";
      note.textContent = this._detail;
      tip.append(note);
    }

    const rows = this._breakdown || [];
    if (rows.length) {
      const table = document.createElement("span");
      table.className = "chip-tip-table";
      for (const row of rows) {
        table.append(tipCell(row.label), tipCell(Math.round(row.tokens).toLocaleString(), "num"));
      }
      table.append(tipCell("Total", "total"), tipCell(Math.round(this._tokens).toLocaleString(), "num total"));
      tip.append(table);
    }

    if (this._legend) {
      const { mediumAt, highAbove } = this._legend;
      const legend = document.createElement("span");
      legend.className = "chip-tip-legend";
      const lines = [
        ["low", `Low (<${shortCount(mediumAt)} tokens)`],
        ["medium", `Med (${shortCount(mediumAt)}–${shortCount(highAbove)} tokens)`],
        ["high", `High (>${shortCount(highAbove)} tokens)`],
      ];
      for (const [level, text] of lines) {
        const line = document.createElement("span");
        line.className = "chip-tip-legend-line" + (level === this._level ? " current" : "");
        const dot = document.createElement("span");
        dot.className = "chip-tip-dot dot-" + level;
        line.append(dot, text);
        legend.append(line);
      }
      tip.append(legend);
    }

    const foot = document.createElement("span");
    foot.className = "chip-tip-foot";
    foot.textContent = "Estimated: ~4 characters ≈ 1 token";
    tip.append(foot);
    return tip;
  }
}

function shortCount(n) {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
}

function tipCell(text, extra = "") {
  const cell = document.createElement("span");
  cell.className = ("chip-tip-cell " + extra).trim();
  cell.textContent = text;
  return cell;
}

customElements.define("token-chip", TokenChipElement);

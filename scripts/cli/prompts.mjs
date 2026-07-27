import readline from "node:readline";

const SELECTED_TEXT_STYLE = "\x1b[1;36m";
const SELECTED_TAB_STYLE = "\x1b[1;46;30m";
const RESET_STYLE = "\x1b[0m";
const DIM_STYLE = "\x1b[38;5;245m";
const SUBTLE_STYLE = "\x1b[38;5;240m";

export function makePrompter() {
  if (!process.stdin.isTTY) return { ask: null, close() {} };
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return {
    ask: (q) => new Promise((res) => rl.question(q, (a) => res(a.trim()))),
    close: () => rl.close(),
  };
}

export async function confirmYesNo(prompter, question, def = true) {
  if (!prompter.ask) return def;
  const hint = def ? "[Y/n]" : "[y/N]";
  const a = (await prompter.ask(`${question} ${hint} `)).toLowerCase();
  if (a === "") return def;
  return a === "y" || a === "yes";
}

export async function askOverrideSkip(prompter, name, fallback = "skip") {
  if (!prompter.ask) return fallback;
  for (;;) {
    const a = (
      await prompter.ask(
        `  "${name}" already exists. (o)verride or (s)kip? [s] `,
      )
    ).toLowerCase();
    if (a === "" || a === "s" || a === "skip") return "skip";
    if (a === "o" || a === "override") return "override";
  }
}

export async function waitForAnyKey(message = "Press any key to continue") {
  const tty = process.stdin.isTTY && process.stdout.isTTY;
  if (!tty) return;
  process.stdout.write(`\n\x1b[1m${message}\x1b[0m`);
  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onKey = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("keypress", onKey);
      process.stdout.write("\n");
      resolve();
    };
    process.stdin.on("keypress", onKey);
  });
}

export async function selectMenu(title, items) {
  const isHeader = (it) => Object.prototype.hasOwnProperty.call(it, "header");
  const selectable = items
    .map((it, i) => (isHeader(it) ? -1 : i))
    .filter((i) => i >= 0);
  const labelWidth = Math.max(
    ...items.filter((it) => !isHeader(it)).map((it) => it.label.length),
  );
  const columnGap = "    ";

  const tty = process.stdin.isTTY && process.stdout.isTTY;
  if (!tty) return numberedFallback(title, items, isHeader);

  return new Promise((resolve) => {
    let pos = 0;
    const out = process.stdout;
    const repaint = createRepaintRegion(out);

    const line = (it, sel, width, indent) => {
      if (isHeader(it))
        return `\x1b[38;5;67m${clipTerminalLine(`  ${it.header}`, width)}${RESET_STYLE}`;
      const pad = it.label.padEnd(labelWidth);
      const labelIndent = indent ? "  " : "";
      const marker = sel ? "> " : "  ";
      const head = `${labelIndent}${marker}${pad}`;
      const plain = clipTerminalLine(
        `${head}${it.desc ? `${columnGap}${it.desc}` : ""}`,
        width,
      );
      const headPart = plain.slice(0, head.length);
      const descPart = plain.slice(head.length);
      if (sel)
        return `${SELECTED_TEXT_STYLE}${headPart}${RESET_STYLE}${descPart ? `${DIM_STYLE}${descPart}${RESET_STYLE}` : ""}`;
      return `${headPart}${descPart ? `${DIM_STYLE}${descPart}${RESET_STYLE}` : ""}`;
    };

    const renderLines = (width) => {
      const lines = title.split("\n");
      if (lines.at(-1) === "") lines.pop();
      let indent = false;
      items.forEach((it, i) => {
        if (isHeader(it)) {
          lines.push("");
          lines.push(line(it, i === selectable[pos], width, false));
          indent = true;
          return;
        }
        lines.push(line(it, i === selectable[pos], width, indent));
      });
      return lines;
    };

    const render = () => {
      const width = terminalRenderWidth(out);
      repaint.render(renderLines(width));
    };

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    render();

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("keypress", onKey);
    };

    const onKey = (_str, key) => {
      if (!key) return;
      if (key.name === "up" || key.name === "k") {
        pos = (pos - 1 + selectable.length) % selectable.length;
        render();
      } else if (key.name === "down" || key.name === "j") {
        pos = (pos + 1) % selectable.length;
        render();
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        out.write("\n");
        resolve(items[selectable[pos]].value);
      } else if (
        key.name === "escape" ||
        key.name === "q" ||
        (key.ctrl && key.name === "c")
      ) {
        cleanup();
        out.write("\n");
        resolve(null);
      }
    };

    process.stdin.on("keypress", onKey);
  });
}

export function terminalRenderWidth(out = process.stdout) {
  // Keep one spare column. Some terminals wrap when a write reaches the final column before "\n".
  return Math.max(1, (out.columns || 80) - 1);
}

export function clipTerminalLine(text, width) {
  return text.length <= width
    ? text
    : text.slice(0, Math.max(0, width - 1)) + "…";
}

export function createRepaintRegion(out = process.stdout) {
  let saved = false;

  return {
    render(lines) {
      if (!saved) {
        out.write("\x1b7");
        saved = true;
      } else {
        out.write("\x1b8\r");
      }
      out.write("\x1b[J");
      for (const line of lines) out.write(`\r\x1b[2K${line}\n`);
    },
  };
}

function sectionTabs(steps, stepIdx, width) {
  const parts = steps.map((step, i) => {
    const label = ` ${shortStepTitle(step.title, width)} `;
    return i === stepIdx
      ? `${SELECTED_TAB_STYLE}${label}${RESET_STYLE}`
      : `${DIM_STYLE}${label}${RESET_STYLE}`;
  });
  return parts.join(" ");
}

function stepNavFooter(steps, stepIdx) {
  const prev =
    stepIdx > 0 ? `<- back to \x1b[1m${steps[stepIdx - 1].title}\x1b[0m` : "";
  const next =
    stepIdx < steps.length - 1
      ? `next to \x1b[1m${steps[stepIdx + 1].title}\x1b[0m ->`
      : "";
  return [prev, next, `Enter to \x1b[1mSave\x1b[0m`]
    .filter(Boolean)
    .join(" | ");
}

function menuLikeHeading(label) {
  const width = Math.max(44, label.length + 8);
  const side = Math.max(2, Math.floor((width - label.length - 2) / 2));
  const left = "=".repeat(side);
  const right = "=".repeat(width - label.length - side - 2);
  return `${left} ${label} ${right}`;
}

function shortStepTitle(title, width) {
  if (width < 72) {
    return (
      {
        "Token Optimization": "Token",
        "Code Conventions": "Conventions",
        "Chat-Time Output": "Chat Output",
      }[title] || title
    );
  }
  return title;
}

export function createStepWizardTemplate(options = {}) {
  const {
    title = "Package Library",
    escapeHint = "Esc - return to previous menu",
    browserCommand = "roborepo web",
    browserHint = "to do in the browser",
  } = options;

  return {
    headerLines({ steps, stepIdx, width }) {
      return [
        menuLikeHeading(`ROBOREPO : ${title}`),
        `${DIM_STYLE}${escapeHint}${RESET_STYLE}`,
        "",
        sectionTabs(steps, stepIdx, width),
        "",
        `\x1b[1m${clipTerminalLine(`Step ${stepIdx + 1}/${steps.length} · ${steps[stepIdx].title}`, width)}\x1b[0m`,
        "",
      ];
    },
    footerLines({ steps, stepIdx, width }) {
      return [
        "",
        clipTerminalLine("  --------------------", width),
        `  ${stepNavFooter(steps, stepIdx)}`,
        "",
        `${SUBTLE_STYLE}  Run ${RESET_STYLE}\x1b[1m${browserCommand}\x1b[0m${SUBTLE_STYLE} ${browserHint}${RESET_STYLE}`,
      ];
    },
  };
}

// Multi-step toggle wizard. One step (section) shown at a time; ←/→/Tab move between steps, ↑/↓ move
// the cursor within a step, Space toggles the highlighted item, Enter saves, Esc/q cancels.
//
// Space flips the item's `active` flag IN MEMORY only — instant, no I/O. The real install work is
// deferred: when the wizard exits it calls the optional `onFinish(steps)`, where the caller diffs each
// item's final `active` against its original and applies the changes in one batch. This keeps the raw-
// mode repaint loop free of blocking subprocesses and of any stray stdout (which would scroll the
// screen and break the cursor-up redraw math).
//
// steps: [{ title, hint?, readonly?, items: [{ label, description?, active, toggleable }] }]
// Read-only steps (or non-toggleable items) render but cannot flip. Non-TTY: returns immediately (the
// caller handles the headless path); the wizard is interactive-only.
//
// An item may instead be N-state (e.g. deny/ask/allow) by carrying `states: string[]` and
// `state` (current value, one of `states`) instead of `active`. Space cycles through `states` in
// order and wraps; boolean items (`active`, no `states`) are unaffected — this is a superset, not
// a replacement.
export async function wizard(steps, onFinish, options = {}) {
  const tty = process.stdin.isTTY && process.stdout.isTTY;
  if (!tty || steps.length === 0) return;

  const out = process.stdout;
  const repaint = createRepaintRegion(out);
  const template = options.template || createStepWizardTemplate(options);
  let stepIdx = 0;
  let cursor = 0;

  const cursorablePositions = (step) =>
    step.items
      .map((it, i) => (it.toggleable && !step.readonly ? i : -1))
      .filter((i) => i >= 0);

  const clampCursor = (step) => {
    const sel = cursorablePositions(step);
    if (sel.length === 0) {
      cursor = -1;
      return;
    }
    if (cursor < 0 || !sel.includes(cursor)) cursor = sel[0];
  };

  // Clip plain text to fit the terminal width so each rendered line occupies exactly one row; the
  // redraw math counts lines, not wrapped visual rows, so a wrapped line would drift the cursor.
  const render = () => {
    const step = steps[stepIdx];
    const width = terminalRenderWidth(out);
    const lines = template.headerLines({ steps, stepIdx, width });
    if (step.description) {
      lines.push(
        `\x1b[38;5;245m${clipTerminalLine(`  ${step.description}`, width)}\x1b[0m`,
      );
      lines.push("");
    }
    if (step.notice) {
      lines.push(
        `\x1b[1m${clipTerminalLine(`  ${step.notice}`, width)}\x1b[0m`,
      );
      lines.push("");
    }
    if (step.itemHeader && step.itemHeader !== step.title) {
      lines.push(
        `\x1b[1m${clipTerminalLine(`  ${step.itemHeader}`, width)}\x1b[0m`,
      );
      lines.push("");
    }
    step.items.forEach((it, i) => {
      const sel = i === cursor;
      const mark =
        !it.toggleable || step.readonly
          ? "   "
          : it.states
            ? `[${it.state}]`.padEnd(
                Math.max(...it.states.map((s) => s.length)) + 2,
              )
            : it.active
              ? "[x]"
              : "[ ]";
      // Compose the plain line first, truncate to width, then re-apply color — measuring plain text
      // keeps the visible length correct (ANSI escapes are zero-width).
      const head = `${sel ? "> " : "  "}${mark} ${it.label}`;
      const descSep = it.description ? "  " : "";
      const plain = clipTerminalLine(
        `${head}${descSep}${it.description || ""}`,
        width,
      );
      // Split back so the description stays dim and the selected row stays cyan.
      const headPart = plain.slice(0, head.length);
      const descPart = plain.slice(head.length);
      const colored = sel
        ? `${SELECTED_TEXT_STYLE}${headPart}${RESET_STYLE}${descPart ? `${DIM_STYLE}${descPart}${RESET_STYLE}` : ""}`
        : `${headPart}${descPart ? `${DIM_STYLE}${descPart}${RESET_STYLE}` : ""}`;
      lines.push(colored);
      // Blank spacer between items for legibility; skip after the last so the footnote/footer hugs.
      if (i < step.items.length - 1) lines.push("");
    });
    if (step.footnote) {
      lines.push("");
      lines.push(
        `\x1b[38;5;245m${clipTerminalLine(`  ${step.footnote}`, width)}\x1b[0m`,
      );
    }
    lines.push(...template.footerLines({ steps, stepIdx, width }));

    repaint.render(lines);
  };

  clampCursor(steps[stepIdx]);

  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    render();

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("keypress", onKey);
      out.write("\n");
    };

    let finished = false; // guard against double-finish (Enter then a queued key)
    const finish = async ({ apply }) => {
      if (finished) return;
      finished = true;
      cleanup();
      const result = apply && onFinish ? await onFinish(steps) : { applied: false, changed: false };
      resolve(result);
    };

    const onKey = (_str, key) => {
      if (!key || finished) return;
      const step = steps[stepIdx];
      const sel = cursorablePositions(step);

      if (key.name === "left" || key.name === "h") {
        stepIdx = (stepIdx - 1 + steps.length) % steps.length;
        clampCursor(steps[stepIdx]);
        render();
      } else if (
        key.name === "right" ||
        key.name === "tab" ||
        key.name === "l"
      ) {
        stepIdx = (stepIdx + 1) % steps.length;
        clampCursor(steps[stepIdx]);
        render();
      } else if (key.name === "up" || key.name === "k") {
        if (sel.length) {
          const at = sel.indexOf(cursor);
          cursor = sel[(at - 1 + sel.length) % sel.length];
          render();
        }
      } else if (key.name === "down" || key.name === "j") {
        if (sel.length) {
          const at = sel.indexOf(cursor);
          cursor = sel[(at + 1) % sel.length];
          render();
        }
      } else if (key.name === "space") {
        const it = step.items[cursor];
        if (it && it.toggleable && !step.readonly) {
          // instant in-memory flip/cycle — real work deferred to onFinish, see wizard's header comment
          if (it.states)
            it.state =
              it.states[(it.states.indexOf(it.state) + 1) % it.states.length];
          else it.active = !it.active;
          render();
        }
      } else if (key.name === "return" || key.name === "enter") {
        void finish({ apply: true });
      } else if (
        key.name === "escape" ||
        key.name === "q" ||
        (key.ctrl && key.name === "c")
      ) {
        void finish({ apply: false });
      }
    };

    process.stdin.on("keypress", onKey);
  });
}

function numberedFallback(title, items, isHeader) {
  console.log(title);
  const order = [];
  for (const it of items) {
    if (isHeader(it)) {
      console.log(`\n  ${it.header}`);
    } else {
      order.push(it);
      const desc = it.desc ? `  — ${it.desc}` : "";
      console.log(`  ${order.length}) ${it.label}${desc}`);
    }
  }
  process.stdout.write("Select a number (or blank to cancel): ");

  const interactive = process.stdin.isTTY;
  const rl = readline.createInterface({ input: process.stdin });
  return new Promise((resolve) => {
    let captured = null;
    let settled = false;
    const toValue = (l) => {
      const n = Number.parseInt(l, 10);
      return Number.isInteger(n) && n >= 1 && n <= order.length
        ? order[n - 1].value
        : null;
    };
    const finish = (val) => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(val);
    };
    rl.once("line", (l) => {
      captured = l;
      if (interactive) finish(toValue(l));
    });
    rl.once("close", () =>
      finish(captured === null ? null : toValue(captured)),
    );
  });
}

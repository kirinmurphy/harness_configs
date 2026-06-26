import readline from "node:readline";

export function makePrompter() {
  if (!process.stdin.isTTY) return { ask: null, close() {} };
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
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
      await prompter.ask(`  "${name}" already exists. (o)verride or (s)kip? [s] `)
    ).toLowerCase();
    if (a === "" || a === "s" || a === "skip") return "skip";
    if (a === "o" || a === "override") return "override";
  }
}

export async function selectMenu(title, items) {
  const isHeader = (it) => Object.prototype.hasOwnProperty.call(it, "header");
  const selectable = items.map((it, i) => (isHeader(it) ? -1 : i)).filter((i) => i >= 0);
  const labelWidth = Math.max(...items.filter((it) => !isHeader(it)).map((it) => it.label.length));

  const tty = process.stdin.isTTY && process.stdout.isTTY;
  if (!tty) return numberedFallback(title, items, isHeader);

  return new Promise((resolve) => {
    let pos = 0;
    const out = process.stdout;

    const line = (it, sel) => {
      if (isHeader(it)) return `\x1b[2K\x1b[2m${it.header}\x1b[0m\n`;
      const pad = it.label.padEnd(labelWidth);
      const desc = it.desc ? `  \x1b[2m${it.desc}\x1b[0m` : "";
      return sel ? `\x1b[2K\x1b[36m> ${pad}\x1b[0m${desc}\n` : `\x1b[2K  ${pad}${desc}\n`;
    };

    const render = (first) => {
      if (!first) out.write(`\x1b[${items.length + 1}A`);
      out.write(`\x1b[2K${title}\n`);
      items.forEach((it, i) => out.write(line(it, i === selectable[pos])));
    };

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    render(true);

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("keypress", onKey);
    };

    const onKey = (_str, key) => {
      if (!key) return;
      if (key.name === "up" || key.name === "k") {
        pos = (pos - 1 + selectable.length) % selectable.length;
        render(false);
      } else if (key.name === "down" || key.name === "j") {
        pos = (pos + 1) % selectable.length;
        render(false);
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        out.write("\n");
        resolve(items[selectable[pos]].value);
      } else if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) {
        cleanup();
        out.write("\n");
        resolve(null);
      }
    };

    process.stdin.on("keypress", onKey);
  });
}

// Multi-step toggle wizard. One step (section) shown at a time; ←/→ move between steps, ↑/↓ move the
// cursor within a step, Space toggles the highlighted item, Enter advances (Enter on the last step
// finishes), Esc/q finishes early.
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
export async function wizard(steps, onFinish) {
  const tty = process.stdin.isTTY && process.stdout.isTTY;
  if (!tty || steps.length === 0) return;

  const out = process.stdout;
  let stepIdx = 0;
  let cursor = 0;
  let lastHeight = 0; // lines drawn by the previous render, to clear before redraw

  const cursorablePositions = (step) =>
    step.items.map((it, i) => (it.toggleable && !step.readonly ? i : -1)).filter((i) => i >= 0);

  const clampCursor = (step) => {
    const sel = cursorablePositions(step);
    if (sel.length === 0) { cursor = -1; return; }
    if (cursor < 0 || !sel.includes(cursor)) cursor = sel[0];
  };

  // Clip plain text to fit the terminal width so each rendered line occupies exactly one row — the
  // redraw math counts lines, not wrapped visual rows, so a wrapped line would drift the cursor.
  const cols = () => process.stdout.columns || 80;
  const clip = (text, width) => (text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + "…");

  const render = () => {
    const step = steps[stepIdx];
    const width = cols();
    const lines = [];
    lines.push(`\x1b[1m${clip(`Step ${stepIdx + 1}/${steps.length} · ${step.title}`, width)}\x1b[0m`);
    const hint = step.hint || "←/→ sections · ↑/↓ move · Space toggle · Enter next · Esc finish";
    lines.push(`\x1b[2m${clip(`  ${hint}`, width)}\x1b[0m`);
    lines.push("");
    if (step.description) { lines.push(`\x1b[2m${clip(`  ${step.description}`, width)}\x1b[0m`); lines.push(""); }
    step.items.forEach((it, i) => {
      const sel = i === cursor;
      const mark = it.toggleable && !step.readonly ? (it.active ? "[x]" : "[ ]") : "   ";
      // Compose the plain line first, truncate to width, then re-apply color — measuring plain text
      // keeps the visible length correct (ANSI escapes are zero-width).
      const head = `${sel ? "> " : "  "}${mark} ${it.label}`;
      const descSep = it.description ? "  " : "";
      const plain = clip(`${head}${descSep}${it.description || ""}`, width);
      // Split back so the description stays dim and the selected row stays cyan.
      const headPart = plain.slice(0, head.length);
      const descPart = plain.slice(head.length);
      const colored = sel
        ? `\x1b[36m${headPart}\x1b[0m${descPart ? `\x1b[2m${descPart}\x1b[0m` : ""}`
        : `${headPart}${descPart ? `\x1b[2m${descPart}\x1b[0m` : ""}`;
      lines.push(colored);
      // Blank spacer between items for legibility; skip after the last so the footnote/footer hugs.
      if (i < step.items.length - 1) lines.push("");
    });
    if (step.footnote) { lines.push(""); lines.push(`\x1b[2m${clip(`  ${step.footnote}`, width)}\x1b[0m`); }

    if (lastHeight > 0) out.write(`\x1b[${lastHeight}A`);
    for (const l of lines) out.write(`\x1b[2K${l}\n`);
    // If this render is shorter than the last, clear the leftover lines below.
    for (let i = lines.length; i < lastHeight; i++) out.write("\x1b[2K\n");
    if (lines.length < lastHeight) out.write(`\x1b[${lastHeight - lines.length}A`);
    lastHeight = Math.max(lines.length, lastHeight);
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
    const finish = async () => {
      if (finished) return;
      finished = true;
      cleanup();
      if (onFinish) await onFinish(steps);
      resolve();
    };

    const onKey = (_str, key) => {
      if (!key || finished) return;
      const step = steps[stepIdx];
      const sel = cursorablePositions(step);

      if (key.name === "left" || key.name === "h") {
        stepIdx = (stepIdx - 1 + steps.length) % steps.length;
        clampCursor(steps[stepIdx]);
        render();
      } else if (key.name === "right" || key.name === "l") {
        stepIdx = (stepIdx + 1) % steps.length;
        clampCursor(steps[stepIdx]);
        render();
      } else if (key.name === "up" || key.name === "k") {
        if (sel.length) { const at = sel.indexOf(cursor); cursor = sel[(at - 1 + sel.length) % sel.length]; render(); }
      } else if (key.name === "down" || key.name === "j") {
        if (sel.length) { const at = sel.indexOf(cursor); cursor = sel[(at + 1) % sel.length]; render(); }
      } else if (key.name === "space") {
        const it = step.items[cursor];
        if (it && it.toggleable && !step.readonly) { it.active = !it.active; render(); } // instant in-memory flip
      } else if (key.name === "return" || key.name === "enter") {
        if (stepIdx === steps.length - 1) { void finish(); }
        else { stepIdx += 1; clampCursor(steps[stepIdx]); render(); }
      } else if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) {
        void finish();
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
      return Number.isInteger(n) && n >= 1 && n <= order.length ? order[n - 1].value : null;
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
    rl.once("close", () => finish(captured === null ? null : toValue(captured)));
  });
}

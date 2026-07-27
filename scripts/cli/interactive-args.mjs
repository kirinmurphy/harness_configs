import { loadPackageCatalog } from "./package-catalog.mjs";
import { makePrompter, selectMenu } from "./skill-lib.mjs";
import readline from "node:readline";

export async function resolveInteractiveArgs(node) {
  const needed = (node.arguments || []).filter((arg) => arg.required);
  if (needed.length === 0) return [];

  const prompter = makePrompter();
  if (!prompter.ask) {
    console.error(node.usage || "missing required arguments");
    return null;
  }
  try {
    const out = [];
    for (const arg of needed) {
      const value = await promptForArg(prompter, arg);
      if (!value) return null;
      out.push(value);
    }
    return out;
  } finally {
    prompter.close();
  }
}

async function promptForArg(prompter, arg) {
  if (arg.interactive?.source === "packages") {
    const packages = loadPackageCatalog({ includeUnavailable: true })
      .map((pkg) => ({ label: pkg.id, desc: pkg.label, value: pkg.id }));
    return selectMenu(`${arg.interactive.prompt || arg.name}:`, [
      ...packages,
      { header: "Navigation" },
      { label: "Back", desc: "Return to previous menu", value: null },
    ]);
  }
  if (arg.interactive?.choices?.length) {
    const choices = arg.interactive.choices.map((choice) => ({
      label: choice,
      value: choice,
    }));
    return selectMenu(`${arg.interactive.prompt}:`, [
      ...choices,
      { header: "Navigation" },
      { label: "Back", desc: "Return to previous menu", value: null },
    ]);
  }
  return askCancelable(prompter, `${arg.interactive?.prompt || arg.name} (blank/Esc to cancel): `);
}

async function askCancelable(prompter, prompt) {
  const tty = process.stdin.isTTY && process.stdout.isTTY;
  if (!tty) return prompter.ask(prompt);
  return new Promise((resolve) => {
    let value = "";
    const render = () => process.stdout.write(`\r\x1b[2K${prompt}${value}`);
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    render();
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("keypress", onKey);
      process.stdout.write("\n");
    };
    const onKey = (str, key) => {
      if (key?.name === "return" || key?.name === "enter") {
        cleanup();
        resolve(value.trim() || null);
      } else if (key?.name === "escape" || (key?.ctrl && key.name === "c")) {
        cleanup();
        resolve(null);
      } else if (key?.name === "backspace" || key?.name === "delete") {
        value = value.slice(0, -1);
        render();
      } else if (str && !key?.ctrl && !key?.meta) {
        value += str;
        render();
      }
    };
    process.stdin.on("keypress", onKey);
  });
}

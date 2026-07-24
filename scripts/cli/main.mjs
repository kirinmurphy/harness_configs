#!/usr/bin/env node
// roborepo CLI composition root. Command/menu/help metadata lives in the command catalog;
// command behavior stays in focused sibling modules.

import { loadCommandCatalog } from "./command-catalog.mjs";
import { executeCommand, validateExecutions } from "./command-executor.mjs";
import { resolveCommand } from "./command-resolver.mjs";
import { renderHelp } from "./help-renderer.mjs";
import { runInteractiveMenu } from "./interactive-menu.mjs";
import { maybeRunPresetOnboarding } from "./presets.mjs";

const argv = await maybeRunPresetOnboarding(process.argv.slice(2));
const catalog = loadCommandCatalog();
validateExecutions({ catalog });

async function dispatch(args) {
  const resolved = resolveCommand(catalog, args);
  if (resolved.kind === "root-menu") {
    return runInteractiveMenu({ catalog, dispatchCommand });
  }
  if (resolved.kind === "menu") {
    return runInteractiveMenu({
      catalog,
      node: resolved.node,
      tokens: resolved.tokens,
      dispatchCommand,
    });
  }
  if (resolved.kind === "help") {
    console.log(renderHelp(catalog, resolved.node, resolved.tokens));
    return;
  }
  if (resolved.kind === "command") {
    return dispatchCommand(resolved.node, resolved.tokens, resolved.args);
  }
  if (resolved.kind === "removed") {
    return removedCommandError(resolved);
  }
  return invalidCommandError(resolved);
}

async function dispatchCommand(node, tokens, args) {
  return executeCommand({ catalog, node, tokens, args });
}

function removedCommandError({ replacement }) {
  console.error(replacement.message || "command removed");
  if (replacement.replacement?.length) {
    console.error(`Try: ${catalog.commandName} ${replacement.replacement.join(" ")}`);
  }
  process.exit(2);
}

function invalidCommandError({ tokens, suggestions }) {
  console.error(`unknown command: ${tokens.join(" ")}`);
  if (suggestions.length) console.error(`Did you mean: ${suggestions.join(", ")}?`);
  console.error(catalog.helpLabels.scopedHelpHint);
  process.exit(2);
}

dispatch(argv).catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

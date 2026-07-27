import { packageMode } from "./paths.mjs";
import { runRepoCommand } from "./repo-script-runner.mjs";
import { setupCommand } from "./workspace.mjs";
import { buildCallArgs } from "./command-call-args.mjs";
import { findNode } from "./command-node-lookup.mjs";
import { loadExport } from "./module-loader.mjs";

export async function runModule({ tokens, args, execution }) {
  const fn = await loadExport({ modulePath: execution.module, exportName: execution.export });
  return fn(...buildCallArgs({ tokens, args, execution }));
}

export function runRepoScript({ catalog, args, execution }) {
  return runRepoCommand(catalog.repoScripts[execution.script], [...(execution.prependArgs || []), ...args]);
}

export async function runUpdateReport({ catalog, args, execution }) {
  if (packageMode && execution.packageModeAlias) {
    const alias = findNode({ nodes: catalog.nodes, path: execution.packageModeAlias });
    console.log(execution.packageModeMessage);
    return runConfiguredCommand({ catalog, node: alias.node, tokens: alias.tokens, args });
  }
  const { runUpdateWithReport } = await import("./update-report.mjs");
  return runUpdateWithReport(catalog.repoScripts[execution.script], args);
}

export async function runConfigApply({ catalog, args, execution }) {
  setupCommand(args.includes("--dry-run") ? ["--dry-run"] : []);
  const { runUpdateWithReport } = await import("./update-report.mjs");
  return runUpdateWithReport(catalog.repoScripts[execution.script], args);
}

export async function runBooleanExitModule({ execution }) {
  const fn = await loadExport({ modulePath: execution.module, exportName: execution.export });
  process.exit(fn() ? 0 : 1);
}

async function runConfiguredCommand({ catalog, node, tokens, args }) {
  const { executeCommand } = await import("./command-executor.mjs");
  return executeCommand({ catalog, node, tokens, args });
}

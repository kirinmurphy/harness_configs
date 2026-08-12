// `roborepo uninstall` — the public managed-cleanup workflow.
//
// Ownership boundary this command exists to express: npm owns the application files it installed;
// roborepo owns the configuration it projected into harnesses plus its own machine-local state.
// This command removes the second and tells the user how to remove the first. It deliberately does
// not invoke npm on the user's behalf — self-removal while running from the package being removed
// is ambiguous under version managers, and shelling out to a package manager hides which tool owns
// what.
//
// The actual removal is the existing shell implementation (scripts/install/uninstall.sh), whose
// ownership and drift checks are mature. This module owns argument parsing, confirmation, and
// result messaging only; policy about *what* is safe to delete stays in one place down there.

import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { repoRoot } from "./paths.mjs";
import { stateRoot, workspaceRoot } from "./roots.mjs";
import { confirmYesNo, makePrompter } from "./skill-lib.mjs";

const UNINSTALL_SCRIPT = path.join(repoRoot, "scripts", "install", "uninstall.sh");
const NPM_PACKAGE = "codethings-roborepo-alpha";

function workspaceIsNested() {
  return workspaceRoot.startsWith(stateRoot + path.sep);
}

function printBoundary({ deleteWorkspace }) {
  console.log("Managed cleanup removes RoboRepo-owned harness projections, generated rules,");
  console.log("and machine-local state. It does not remove the npm package.");
  console.log("");

  if (!fs.existsSync(workspaceRoot)) return;

  if (deleteWorkspace && workspaceIsNested()) {
    console.log(`Your workspace WILL BE DELETED: ${workspaceRoot}`);
  } else if (deleteWorkspace) {
    // Asked for, but refused: this path was chosen by the user and roborepo did not create it.
    console.log(`Your workspace will be preserved: ${workspaceRoot}`);
    console.log("  (--delete-workspace only applies to a workspace inside the RoboRepo state");
    console.log("   directory; this one lives elsewhere, so remove it yourself if you want it gone.)");
  } else {
    console.log(`Your workspace will be preserved: ${workspaceRoot}`);
  }
  console.log("");
}

function printResult({ deleted }) {
  console.log("");
  console.log("RoboRepo-managed configuration has been removed.");
  if (!deleted && fs.existsSync(workspaceRoot)) {
    console.log(`Your workspace was preserved: ${workspaceRoot}`);
  }
  console.log("");
  console.log("Remove the application with:");
  console.log(`  npm uninstall -g ${NPM_PACKAGE}`);
}

export async function uninstallCommand(args = []) {
  const known = new Set(["--dry-run", "--yes", "--delete-workspace"]);
  const invalid = args.filter((arg) => !known.has(arg));
  if (invalid.length > 0) {
    console.error(`unknown flag for uninstall: ${invalid.join(" ")}`);
    console.error("usage: roborepo uninstall [--dry-run] [--yes] [--delete-workspace]");
    process.exit(2);
  }

  const dryRun = args.includes("--dry-run");
  const assumeYes = args.includes("--yes");
  const deleteWorkspace = args.includes("--delete-workspace");
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  printBoundary({ deleteWorkspace });

  if (dryRun) {
    console.log("Dry run — nothing will be removed.");
    console.log("");
    return runScript({ dryRun: true, deleteWorkspace });
  }

  // Destructive and noninteractive requires an explicit --yes: a script that pipes to this command
  // must say out loud that it meant to delete, rather than being consented-by-default.
  if (!assumeYes) {
    if (!interactive) {
      console.error("Refusing to run a destructive uninstall without confirmation.");
      console.error("Re-run with --yes, or use --dry-run to preview.");
      process.exit(2);
    }
    const prompter = makePrompter();
    let confirmed;
    try {
      confirmed = await confirmYesNo(
        prompter,
        deleteWorkspace && workspaceIsNested()
          ? "Remove RoboRepo-managed configuration AND delete your workspace?"
          : "Remove RoboRepo-managed configuration?",
        false,
      );
    } finally {
      prompter.close();
    }
    if (!confirmed) {
      console.log("Cancelled. Nothing was removed.");
      return;
    }
  }

  const status = runScript({ dryRun: false, deleteWorkspace });
  if (status === 0) printResult({ deleted: deleteWorkspace && workspaceIsNested() });
  return status;
}

function runScript({ dryRun, deleteWorkspace }) {
  const result = spawnSync("bash", [UNINSTALL_SCRIPT, ...(dryRun ? ["--dry-run"] : [])], {
    stdio: "inherit",
    env: {
      ...process.env,
      // The shell layer owns the nested-vs-relocated decision; passing intent rather than a
      // resolved path keeps one implementation of that rule.
      ROBOREPO_UNINSTALL_DELETE_WORKSPACE: deleteWorkspace ? "1" : "0",
    },
  });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  return result.status ?? 1;
}

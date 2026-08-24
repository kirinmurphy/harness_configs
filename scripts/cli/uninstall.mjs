// `roborepo uninstall` — the public managed-cleanup workflow.
//
// Ownership boundary this command exists to express: npm owns package-mode application files;
// roborepo owns the configuration it projected into harnesses plus its own machine-local state.
// Package-mode uninstall removes both: first the managed config/state, then the npm package that
// provides the `roborepo` command. Development checkout uninstall only removes the local managed
// projections/link, because npm does not own the checkout.
//
// The actual removal is the existing shell implementation (scripts/install/uninstall.sh), whose
// ownership and drift checks are mature. This module owns argument parsing, confirmation, and
// result messaging only; policy about *what* is safe to delete stays in one place down there.

import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { packageMode, repoRoot } from "./paths.mjs";
import { stateRoot, workspaceRoot } from "./roots.mjs";
import { confirmYesNo, makePrompter } from "./skill-lib.mjs";

const UNINSTALL_SCRIPT = path.join(repoRoot, "scripts", "install", "uninstall.sh");
const NPM_PACKAGE = "codethings-roborepo-alpha";

function workspaceIsNested() {
  return workspaceRoot.startsWith(stateRoot + path.sep);
}

function printBoundary({ deleteWorkspace }) {
  console.log("Managed cleanup removes RoboRepo-owned harness projections, generated rules,");
  console.log("and machine-local state.");
  if (packageMode) console.log("It will also uninstall the npm package that provides `roborepo`.");
  else console.log("Development checkout mode: npm package removal is skipped.");
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

function printResult({ deleted, npmRemoved }) {
  console.log("");
  console.log("RoboRepo-managed configuration has been removed.");
  if (!deleted && fs.existsSync(workspaceRoot)) {
    console.log(`Your workspace was preserved: ${workspaceRoot}`);
  }
  console.log("");
  if (packageMode) {
    console.log(npmRemoved
      ? "The npm package has been uninstalled."
      : "The npm package was not uninstalled.");
  } else {
    console.log("Development checkout application files were not removed.");
  }
}

function npmPrefixForPackageRoot(root = repoRoot) {
  const parts = path.resolve(root).split(path.sep);
  const packageName = parts.at(-1);
  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  if (packageName !== NPM_PACKAGE || nodeModulesIndex < 0) return null;

  const beforeNodeModules = parts[nodeModulesIndex - 1];
  const prefixParts = beforeNodeModules === "lib"
    ? parts.slice(0, nodeModulesIndex - 1)
    : parts.slice(0, nodeModulesIndex);
  const prefix = prefixParts.join(path.sep) || path.sep;
  return prefix;
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
    if (packageMode) console.log(`Would run: ${npmUninstallCommandLabel()}`);
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
  // Deliberately NOT gated on `status === 0`. The shell script's last act is a remnant check, and a
  // leftover it reports is a reason to still remove the npm package, not a reason to keep it: the
  // binary that runs this command is the package's own. Gating here is what stranded an installed
  // package on a machine whose npm prefix collided with the shell installer's bin directory.
  const npmRemoved = packageMode ? uninstallNpmPackage() : false;
  if (status === 0) printResult({ deleted: deleteWorkspace && workspaceIsNested(), npmRemoved });
  return status;
}

// --- Portal-facing API. Same shell implementation as the CLI, so the two cannot drift on what is
// safe to remove; only the presentation differs. Workspace deletion is intentionally not
// expressible here — the portal surface is preserve-only (see portal-routes-maintenance.mjs). ---

export function uninstallPreview() {
  const result = spawnSync("bash", [UNINSTALL_SCRIPT, "--dry-run"], {
    encoding: "utf8",
    env: { ...process.env, ROBOREPO_UNINSTALL_DELETE_WORKSPACE: "0" },
  });
  const lines = (result.stdout || "").split("\n").filter(Boolean);
  return {
    ok: result.status === 0,
    workspace: fs.existsSync(workspaceRoot) ? workspaceRoot : null,
    workspacePreserved: true,
    removals: lines.filter((line) => line.startsWith("remove")),
    preserved: lines.filter((line) => line.startsWith("preserve")),
    npmCommand: packageMode ? npmUninstallCommandLabel() : null,
    stderr: result.stderr || "",
  };
}

export function uninstallExecute() {
  const result = spawnSync("bash", [UNINSTALL_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, ROBOREPO_UNINSTALL_DELETE_WORKSPACE: "0" },
  });
  // Same reasoning as the CLI path above: a reported remnant must not strand the npm package.
  const npmResult = packageMode ? runNpmUninstall({ stdio: "pipe" }) : null;
  return {
    ok: result.status === 0 && (!npmResult || npmResult.status === 0),
    workspace: fs.existsSync(workspaceRoot) ? workspaceRoot : null,
    workspacePreserved: true,
    output: (result.stdout || "").split("\n").filter(Boolean),
    npmCommand: packageMode ? npmUninstallCommandLabel() : null,
    npmRemoved: npmResult ? npmResult.status === 0 : false,
    stderr: [result.stderr || "", npmResult?.stderr || ""].filter(Boolean).join("\n"),
  };
}

function uninstallNpmPackage() {
  console.log("");
  console.log(`Running: ${npmUninstallCommandLabel()}`);
  const result = runNpmUninstall({ stdio: "inherit" });
  if (result.error) {
    console.error(`npm uninstall failed: ${result.error.message}`);
    process.exitCode = 1;
    return false;
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    return false;
  }
  return true;
}

function npmUninstallArgs() {
  const prefix = npmPrefixForPackageRoot();
  return ["uninstall", "-g", ...(prefix ? ["--prefix", prefix] : []), NPM_PACKAGE];
}

function npmUninstallCommandLabel() {
  return `npm ${npmUninstallArgs().join(" ")}`;
}

function runNpmUninstall({ stdio }) {
  return spawnSync("npm", npmUninstallArgs(), {
    stdio,
    encoding: stdio === "pipe" ? "utf8" : undefined,
  });
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

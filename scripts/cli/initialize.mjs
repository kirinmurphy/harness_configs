// `roborepo init` — the single user-facing first-run workflow.
//
// This is an orchestrator, not an implementation. Every step below already exists as a primitive
// (setup, harness refresh, the Package Library wizard, config apply); init's whole job is to run
// them in the right order, keep the initialization record honest about how far it got, and give
// the user one thing to read at the end. Any logic that belongs to a step belongs in that step's
// module, not here — otherwise `init` and the primitive drift apart and the primitive becomes the
// one nobody tests.
//
// Failure policy: the record is marked complete only after every required step returns. A throw,
// a Ctrl-C, or a process exit anywhere in between leaves it "in-progress", which is what makes a
// half-finished first run resumable instead of indistinguishable from a fresh install.

import { listHarnessProviders } from "../harnesses/registry.mjs";
import { discoverHarnessProviders } from "../harnesses/discovery.mjs";
import { readHarnessState, writeHarnessState, applyDiscoveryToState } from "../harnesses/state.mjs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { presetsOnboard } from "./presets.mjs";
import { setupCommand } from "./workspace.mjs";
import { selectMenu } from "./skill-lib.mjs";
import {
  beginInitialization,
  completeInitialization,
  initializationPhase,
  readFutureInitializationState,
} from "./initialization-state.mjs";

// Refresh discovery and return the machine cohort rather than printing the provider table.
// harnessRefresh() writes state and then dumps a tab-separated row per provider, which is the
// right output for `roborepo harness refresh` and the wrong output mid-wizard, so init shares the
// state-writing path and formats its own one-line summary.
function refreshAndSummarizeHarnesses() {
  const results = discoverHarnessProviders(listHarnessProviders());
  const next = applyDiscoveryToState(readHarnessState(), results);
  writeHarnessState(next);

  const detected = results
    .filter((entry) => entry.status === "detected")
    .map((entry) => entry.providerId);

  return { state: next, detected };
}

function describeHarnesses(detected) {
  if (detected.length === 0) {
    return [
      "No supported agent harnesses are currently detected.",
      "RoboRepo is initialized; install or launch a supported harness later, then run `roborepo harness refresh`.",
    ];
  }
  const names = detected.map((id) => listHarnessProviders().find((p) => p.id === id)?.manifest.displayName ?? id);
  const list = names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
  return [`Detected ${names.length === 1 ? "harness" : `${names.length} harnesses`}: ${list}.`];
}

function printNextActions() {
  console.log("");
  console.log("Next steps:");
  console.log("  roborepo           open the main menu");
  console.log("  roborepo library   browse and manage packages");
  console.log("  roborepo web       open the portal in a browser");
  console.log("  roborepo doctor    check installation health");
}

function printWelcome() {
  console.log("Welcome to RoboRepo.");
  console.log("Choose how you want to configure this install.");
  console.log("");
}

async function runFirstRunConfiguration({ dryRun = false } = {}) {
  if (dryRun) {
    console.log("  - choose browser or CLI configuration");
    return;
  }

  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    await presetsOnboard([]);
    return;
  }

  printWelcome();
  const choice = await selectMenu("Configure settings:", [
    {
      label: "Browser",
      value: "web",
      desc: "open roborepo web",
    },
    {
      label: "CLI",
      value: "cli",
      desc: "continue to Package Library",
    },
  ]);

  if (choice === "web") {
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, "scripts", "cli", "main.mjs"), "web", "--detach"],
      { stdio: "inherit" },
    );
    if (result.status !== 0) process.exit(result.status ?? 1);
    return;
  }

  await presetsOnboard([]);
}

// Re-running a finished init must not replay the wizard: that would re-prompt for package
// selections the user already made and re-apply configuration they may have since hand-edited.
// Report and exit instead, pointing at the commands that *do* mutate.
function reportAlreadyInitialized() {
  console.log("RoboRepo is already initialized.");
  console.log("");
  console.log("  roborepo library      change which packages are enabled");
  console.log("  roborepo config apply re-apply configuration");
  console.log("  roborepo doctor       check installation health");
}

export async function initCommand(args = []) {
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const invalid = args.filter((arg) => arg !== "--dry-run" && arg !== "--force");
  if (invalid.length > 0) {
    console.error(`unknown flag for init: ${invalid.join(" ")}`);
    process.exit(2);
  }

  // A record written by a newer RoboRepo reads as "not initialized" (this build cannot vouch for
  // its shape), which would otherwise make init replay the entire first-run workflow and overwrite
  // it. Report the downgrade and stop before touching anything — including under --force, which
  // means "re-run initialization", not "discard a newer installation's state".
  const future = readFutureInitializationState();
  if (future) {
    console.error("This installation was initialized by a newer version of RoboRepo.");
    console.error(`  record schemaVersion: ${future.schemaVersion} (this build understands 1)`);
    console.error("");
    console.error("Upgrade RoboRepo again, or remove the initialization record to start over:");
    console.error("  roborepo doctor        check installation health");
    process.exit(1);
  }

  const phase = initializationPhase();

  if (phase === "complete" && !force) {
    reportAlreadyInitialized();
    return;
  }

  if (dryRun) {
    console.log("would initialize RoboRepo:");
    console.log("  - create workspace and state directories");
    console.log("  - refresh harness discovery");
    await runFirstRunConfiguration({ dryRun: true });
    console.log(`  - mark initialization complete (currently: ${phase})`);
    return;
  }

  if (phase === "in-progress") {
    console.log("Resuming an interrupted initialization.");
    console.log("");
  }

  beginInitialization();

  setupCommand([]);

  const { detected } = refreshAndSummarizeHarnesses();
  for (const line of describeHarnesses(detected)) console.log(line);
  console.log("");

  await runFirstRunConfiguration();

  completeInitialization();

  console.log("");
  console.log("RoboRepo is initialized.");
  console.log("");
  console.log("The npm package and your RoboRepo configuration have separate lifecycles.");
  console.log("Removing the npm package does not remove your RoboRepo workspace or managed harness configuration.");
  printNextActions();
}

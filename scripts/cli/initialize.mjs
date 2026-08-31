// `roborepo init` — the explicit user-facing first-run workflow.
//
// This is an orchestrator, not an implementation. The procedural machine bootstrap (workspace/state
// roots, persisted harness discovery, the initialization record) lives in
// initialization-bootstrap.mjs's `ensureInitialized()`, which `init` and `web` share so the two
// first-run entry points cannot drift. init's whole remaining job is presentation: run the shared
// bootstrap, refresh the harness summary, hand the user to the browser or the CLI configuration
// surface, and give them one thing to read at the end.
//
// Failure policy: `ensureInitialized()` records `complete` only after the procedural steps return.
// Everything init adds after that (browser handoff, CLI config) is configuration, not required
// machine state — the portal and `roborepo library` / package commands both operate without it.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { harnessDisplayName } from "../harnesses/registry.mjs";
import { presetsOnboard } from "./presets.mjs";
import { confirmYesNo, makePrompter } from "./skill-lib.mjs";
import { ensureInitialized, describeNewerSchemaRefusal } from "./initialization-bootstrap.mjs";

const DEFAULT_PORTAL_URL = "http://127.0.0.1:4317";
const LOCAL_PORTAL_URL_RE = /http:\/\/127\.0\.0\.1:\d+/;

function describeHarnesses(detected) {
  if (detected.length === 0) {
    return [
      "No supported agent harnesses are currently detected.",
      "RoboRepo is initialized; install or launch a supported harness later, then run `roborepo harness refresh`.",
    ];
  }
  const names = detected.map((id) => harnessDisplayName(id));
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
  console.log("Opening the browser setup.");
  console.log("");
}

export function extractPortalUrl(output) {
  return output.match(LOCAL_PORTAL_URL_RE)?.[0] ?? null;
}

export function browserRedirectMessage(url, { bold = false } = {}) {
  const heading = bold ? "\x1b[1mWelcome to roborepo\x1b[0m" : "Welcome to roborepo";
  return [
    "------------------------------------------------------",
    heading,
    "The admin dashboard for your dev environment",
    "------------------------------------------------------",
    "",
    "You are being redirected to a browser window to continue your setup.",
    "",
    `If the browser window did not open, go to \`${url}\``,
    "",
    "-------------------------------",
    "",
    "Explore the CLI at `roborepo` for further functionality and agent commands.",
    "",
  ].join("\n");
}

function clearInteractiveScreen() {
  if (process.stdout.isTTY) process.stdout.write("\x1b[H\x1b[J");
}

async function offerCliMenuAfterBrowserSetup(url) {
  if (!(process.stdin.isTTY && process.stdout.isTTY)) return;

  clearInteractiveScreen();
  console.log(browserRedirectMessage(url, { bold: true }));

  const prompter = makePrompter();
  try {
    const loadCli = await confirmYesNo(prompter, "Would you like to load the CLI now?", false);
    if (!loadCli) return;
  } finally {
    prompter.close();
  }

  spawnSync(process.execPath, [path.join(repoRoot, "scripts", "cli", "main.mjs")], { stdio: "inherit" });
}

// The browser-vs-CLI decision after `web --detach` has run, as a pure function of its result.
// Split out of runFirstRunConfiguration so the routing rule is testable without a terminal (same
// pattern as resolveFirstRunRoute): the PTY side effects (welcome banner, presets onboarding,
// stdout relay) stay in the orchestrator, but which mode is selected — and, for the browser path,
// which URL to hand off — is decided here. The caller never reaches this with an empty
// spawnStatus when non-interactive: non-TTY invocations short-circuit before spawning.
export function resolveFirstRunConfigurationMode({ spawnStatus, spawnOutput }) {
  if (spawnStatus === 0) {
    return {
      mode: "browser",
      url: extractPortalUrl(spawnOutput) ?? DEFAULT_PORTAL_URL,
    };
  }
  return { mode: "cli" };
}

async function runFirstRunConfiguration({ dryRun = false } = {}) {
  if (dryRun) {
    console.log("  - open browser setup, with CLI fallback for non-interactive shells");
    return null;
  }

  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    await presetsOnboard([]);
    return { mode: "cli" };
  }

  printWelcome();
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "cli", "main.mjs"), "web", "--detach"],
    { encoding: "utf8" },
  );
  const decided = resolveFirstRunConfigurationMode({
    spawnStatus: result.status,
    spawnOutput: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  });
  if (decided.mode === "browser") {
    return decided;
  }

  console.log("");
  console.log("Browser setup did not start; continuing in the CLI.");
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  await presetsOnboard([]);
  return decided;
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

  // The entire procedural machine bootstrap — future-schema guard, phase inspection, workspace/state
  // roots, persisted harness discovery, and the completion record — runs inside this one call,
  // shared verbatim with `roborepo web`. init only decides how to present the result.
  const result = ensureInitialized({ force, dryRun });

  if (result.status === "refused") {
    for (const line of describeNewerSchemaRefusal(result.schemaVersion)) console.error(line);
    process.exit(1);
  }

  if (result.status === "noop") {
    reportAlreadyInitialized();
    return;
  }

  if (result.status === "dryrun") {
    console.log("would initialize RoboRepo:");
    console.log(`  - ${result.steps[0]}`);
    console.log(`  - ${result.steps[1]}`);
    await runFirstRunConfiguration({ dryRun: true });
    console.log(`  - ${result.steps[2]} (currently: ${result.phase})`);
    return;
  }

  // status === "bootstrapped"
  if (result.phase === "in-progress") {
    console.log("Resuming an interrupted initialization.");
    console.log("");
  }

  for (const line of describeHarnesses(result.detected)) console.log(line);
  console.log("");

  // The procedural record is already `complete` before this runs (ensureInitialized finished it),
  // so the browser handoff and CLI configuration are additive presentation — and the `web --detach`
  // spawned below sees a complete record, takes the no-op bootstrap path, and cannot race this
  // process's first-run mutation.
  const firstRunConfiguration = await runFirstRunConfiguration();

  if (firstRunConfiguration?.mode === "browser") {
    await offerCliMenuAfterBrowserSetup(firstRunConfiguration.url);
  }

  console.log("");
  console.log("RoboRepo is initialized.");
  console.log("");
  console.log("The npm package and your RoboRepo configuration have separate lifecycles.");
  console.log("Removing the npm package does not remove your RoboRepo workspace or managed harness configuration.");
  printNextActions();
}

#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Initialization state + first-run routing, per
// docs/plans/active/infra-packaging-02-install-lifecycle.md Phases 1-2.
//
// The state-record assertions run in-process against a sandboxed ROBOREPO_STATE_DIR. The routing
// assertions call the pure decision function rather than spawning a PTY: the rule under test is
// "which route does (argv, phase, tty) select", and a real terminal adds no coverage while making
// the test unrunnable in CI.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(repoRoot, "scripts/cli/main.mjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-init-lifecycle-"));
const stateDir = path.join(tmp, ".roborepo");
process.env.ROBOREPO_STATE_DIR = stateDir;

const { resolveFirstRunRoute } = await import("../cli/first-run-routing.mjs");
const {
  readInitializationState,
  writeInitializationState,
  validateInitializationState,
  beginInitialization,
  completeInitialization,
  initializationPhase,
  isInitializationComplete,
  WORKFLOW_VERSION,
} = await import("../cli/initialization-state.mjs");
const { initializationStatePath } = await import("../cli/state-paths.mjs");
const { browserRedirectMessage, extractPortalUrl } = await import("../cli/initialize.mjs");

try {
  testMissingState();
  testBeginLeavesInProgress();
  testCompleteMarksComplete();
  testResumePreservesStartedAt();
  testCorruptStateReadsAsMissing();
  testSchemaValidation();
  testStatePathIsSandboxed();
  testFirstRunRouting();
  testExplicitCommandsBypassInit();
  testAliasReachesSameImplementation();
  testNewerRecordIsNeverOverwritten();
  testBrowserRedirectMessage();
  testInitDryRunShowsConfigurationChoice();
  console.log("initialization lifecycle checks passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function resetState() {
  fs.rmSync(initializationStatePath, { force: true });
}

// --- missing: never initialized. Directory existence must NOT imply initialization, which is the
// whole reason this record exists separately from the workspace/state dirs. ---
function testMissingState() {
  resetState();
  fs.mkdirSync(path.join(stateDir, "workspace"), { recursive: true });
  assert.equal(readInitializationState(), null, "absent record reads as null");
  assert.equal(initializationPhase(), "missing", "an existing workspace dir must not imply initialization");
  assert.equal(isInitializationComplete(), false);
}

function testBeginLeavesInProgress() {
  resetState();
  const state = beginInitialization();
  assert.equal(state.status, "in-progress");
  assert.equal(state.completedAt, null, "completedAt stays null until the workflow finishes");
  assert.equal(state.workflowVersion, WORKFLOW_VERSION);
  assert.equal(initializationPhase(), "in-progress", "an interrupted run is resumable, not complete");
  assert.equal(isInitializationComplete(), false);
}

function testCompleteMarksComplete() {
  resetState();
  beginInitialization();
  const state = completeInitialization();
  assert.equal(state.status, "complete");
  assert.ok(state.completedAt, "completedAt is required once complete");
  assert.equal(initializationPhase(), "complete");
  assert.equal(isInitializationComplete(), true);
}

// --- Re-entering an interrupted init keeps the original startedAt, so the record reports when the
// user first tried rather than when they last retried. ---
function testResumePreservesStartedAt() {
  resetState();
  const first = beginInitialization({ now: () => "2020-01-01T00:00:00.000Z" });
  const resumed = beginInitialization({ now: () => "2026-01-01T00:00:00.000Z" });
  assert.equal(resumed.startedAt, first.startedAt, "resume must not reset startedAt");

  const finished = completeInitialization({ now: () => "2026-01-02T00:00:00.000Z" });
  assert.equal(finished.startedAt, first.startedAt, "completion must not reset startedAt");
  assert.equal(finished.completedAt, "2026-01-02T00:00:00.000Z");
}

// --- A broken state file must not lock a user out of their own first run: unreadable and
// never-started have the same recovery (run init), so both read as "missing". ---
function testCorruptStateReadsAsMissing() {
  resetState();
  fs.mkdirSync(path.dirname(initializationStatePath), { recursive: true });
  fs.writeFileSync(initializationStatePath, "{ not json");
  assert.equal(readInitializationState(), null, "unparseable record reads as missing");
  assert.equal(initializationPhase(), "missing");

  fs.writeFileSync(initializationStatePath, JSON.stringify({ schemaVersion: 99, status: "complete" }));
  assert.equal(readInitializationState(), null, "unknown schemaVersion reads as missing, not complete");
}

function testSchemaValidation() {
  assert.throws(() => validateInitializationState({}), /schemaVersion/);
  assert.throws(
    () => validateInitializationState({ schemaVersion: 1, workflowVersion: 1, status: "bogus", startedAt: new Date().toISOString(), completedAt: null }),
    /status must be one of/,
  );
  // completedAt is mandatory once complete — otherwise "complete" could not be distinguished from
  // an in-progress record that merely had its status flipped.
  assert.throws(
    () => validateInitializationState({ schemaVersion: 1, workflowVersion: 1, status: "complete", startedAt: new Date().toISOString(), completedAt: null }),
    /completedAt is required/,
  );
  assert.throws(
    () => writeInitializationState({ schemaVersion: 1, workflowVersion: 0, status: "in-progress", startedAt: new Date().toISOString(), completedAt: null }),
    /workflowVersion/,
  );
}

function testStatePathIsSandboxed() {
  assert.ok(
    initializationStatePath.startsWith(stateDir),
    `initialization state must honor ROBOREPO_STATE_DIR, got ${initializationStatePath}`,
  );
  assert.equal(path.basename(initializationStatePath), "initialization.json");
}

// --- Routing: only a bare interactive invocation on an uninitialized install reroutes to init. ---
function testFirstRunRouting() {
  const bareInteractive = (phase) => resolveFirstRunRoute({ args: [], phase, interactive: true }).route;
  assert.equal(bareInteractive("missing"), "init", "uninitialized bare interactive roborepo enters init");
  assert.equal(bareInteractive("in-progress"), "init", "an interrupted init is resumed, not skipped");
  assert.equal(bareInteractive("complete"), "normal", "a completed install opens the normal root menu");

  // Automation must never be dropped into a wizard it cannot answer.
  for (const phase of ["missing", "in-progress", "complete"]) {
    assert.equal(
      resolveFirstRunRoute({ args: [], phase, interactive: false }).route,
      "normal",
      `non-interactive bare invocation must not route to init (phase: ${phase})`,
    );
  }
}

function testExplicitCommandsBypassInit() {
  // Diagnostics and help stay reachable before initialization; this is the specific failure mode
  // of the old forced onboarding gate, so it is asserted rather than assumed.
  for (const args of [["doctor"], ["version"], ["--help"], ["harness", "list"], ["config", "apply"]]) {
    assert.equal(
      resolveFirstRunRoute({ args, phase: "missing", interactive: true }).route,
      "normal",
      `explicit command must run before initialization: ${args.join(" ")}`,
    );
  }
}

// --- Downgrade: an older RoboRepo must not destroy a newer installation's state. A newer-schema
// record is well-formed, just not interpretable by this build, so it reads as "not initialized"
// like a corrupt one — but writing over it is a different act entirely. Before this guard, an
// older CLI replayed the whole first-run workflow and overwrote the record with its own. ---
function testNewerRecordIsNeverOverwritten() {
  resetState();
  const newer = {
    schemaVersion: 99,
    workflowVersion: 9,
    status: "complete",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
  };
  fs.mkdirSync(path.dirname(initializationStatePath), { recursive: true });
  fs.writeFileSync(initializationStatePath, `${JSON.stringify(newer)}\n`);

  assert.equal(readInitializationState(), null, "an uninterpretable record must not read as valid");
  assert.throws(
    () => beginInitialization(),
    /newer RoboRepo/i,
    "beginInitialization must refuse rather than clobber a newer record",
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(initializationStatePath, "utf8")),
    newer,
    "the newer record must survive the refused write byte-for-byte",
  );

  // Through the real CLI, including --force: "re-run initialization" never means "discard a newer
  // installation's state". Both must exit nonzero with an explanation, not a stack trace.
  const env = { ...process.env, HOME: tmp, ROBOREPO_STATE_DIR: stateDir, ROBOREPO_PRESETS_ONBOARD: "skip" };
  for (const args of [["init"], ["init", "--force"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: repoRoot, env, encoding: "utf8", input: "" });
    assert.equal(result.status, 1, `${args.join(" ")} must refuse a newer record`);
    assert.match(result.stderr, /newer version of RoboRepo/i, `${args.join(" ")} must explain why`);
    assert.doesNotMatch(result.stderr, /at writeInitializationState/, "must not surface a raw stack trace");
    assert.deepEqual(
      JSON.parse(fs.readFileSync(initializationStatePath, "utf8")),
      newer,
      `${args.join(" ")} must leave the newer record intact`,
    );
  }
  resetState();
}

function testBrowserRedirectMessage() {
  const url = "http://127.0.0.1:9876";
  const message = browserRedirectMessage(url);
  assert.match(message, /Welcome to roborepo/, "handoff screen must introduce roborepo");
  assert.match(message, /admin dashboard/i, "handoff screen must describe the browser dashboard");
  assert.match(message, /browser window/i, "handoff screen must explain the redirect");
  assert.match(message, new RegExp(url.replaceAll(".", "\\.")), "handoff screen must include the portal URL");
  assert.match(message, /Explore the CLI at `roborepo`/, "handoff screen must point at the CLI");

  assert.equal(
    extractPortalUrl("roborepo portal: http://127.0.0.1:4319  (detached)"),
    "http://127.0.0.1:4319",
    "init must reuse the actual portal URL reported by roborepo web",
  );
}

// --- `roborepo library` and `roborepo package manage` must reach one implementation. Asserted
// through the real CLI in a sandboxed HOME so this covers dispatch, not just catalog shape. ---
function testAliasReachesSameImplementation() {
  const env = { ...process.env, HOME: tmp, ROBOREPO_STATE_DIR: stateDir };
  const run = (args) => spawnSync(process.execPath, [cli, ...args, "--help"], { cwd: repoRoot, env, encoding: "utf8" });

  const library = run(["library"]);
  const manage = run(["package", "manage"]);
  assert.equal(library.status, 0, `library --help failed:\n${library.stderr}`);
  assert.equal(manage.status, 0, `package manage --help failed:\n${manage.stderr}`);
  assert.match(library.stdout, /packages/i, "library help should describe the package workflow");
}

function testInitDryRunShowsConfigurationChoice() {
  resetState();
  const env = { ...process.env, HOME: tmp, ROBOREPO_STATE_DIR: stateDir, ROBOREPO_PRESETS_ONBOARD: "skip" };
  const result = spawnSync(process.execPath, [cli, "init", "--dry-run"], { cwd: repoRoot, env, encoding: "utf8", input: "" });
  assert.equal(result.status, 0, `init --dry-run failed:\n${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /open browser setup/i, "init must make browser setup the first-run entrypoint");
  assert.match(result.stdout, /CLI fallback/i, "init must still expose the terminal fallback");
}

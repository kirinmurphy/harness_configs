#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Managed uninstall workspace policy, per
// docs/plans/active/infra-packaging-02-install-lifecycle.md Phase 4.
//
// The behavior under test is the one that can destroy user data, so these run the real CLI and the
// real shell uninstall against sandboxed HOME/ROBOREPO_STATE_DIR fixtures rather than asserting on
// a plan object. Before this phase, remove_runtime_state() ended with `remove_path "${state_dir}"`
// — an rm -rf that took <stateRoot>/workspace with it.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(repoRoot, "scripts/cli/main.mjs");
const uninstallSh = path.join(repoRoot, "scripts/install/uninstall.sh");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-managed-uninstall-"));
let caseId = 0;
try {
  testNestedWorkspacePreservedByDefault();
  testRelocatedWorkspaceUntouched();
  testDeleteWorkspaceOptIn();
  testRelocatedNeverDeletedEvenWithOptIn();
  testNoninteractiveRefusesWithoutYes();
  testDryRunMutatesNothing();
  testRepeatedUninstallIsSafe();
  testCheckCleanToleratesPreservedWorkspace();
  console.log("managed uninstall checks passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function fixture({ relocated = false } = {}) {
  const home = path.join(tmp, `case-${++caseId}`);
  const stateDir = path.join(home, ".roborepo");
  const workspace = relocated ? path.join(home, "elsewhere", "workspace") : path.join(stateDir, "workspace");

  fs.mkdirSync(path.join(workspace, "skills"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "skills", "mine.md"), "USER AUTHORED\n");
  // Disposable machine state that managed cleanup should remove.
  fs.mkdirSync(path.join(stateDir, "telemetry"), { recursive: true });
  fs.writeFileSync(path.join(stateDir, "enabled-packages.json"), "{}\n");

  if (relocated) {
    fs.writeFileSync(
      path.join(stateDir, "workspace-root.json"),
      JSON.stringify({ workspaceRoot: workspace }) + "\n",
    );
  }
  return { home, stateDir, workspace, skill: path.join(workspace, "skills", "mine.md") };
}

function env(f, extra = {}) {
  return { ...process.env, HOME: f.home, ROBOREPO_STATE_DIR: f.stateDir, ...extra };
}

function runCli(f, args, extra) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repoRoot, env: env(f, extra), encoding: "utf8", input: "",
  });
}

function testNestedWorkspacePreservedByDefault() {
  const f = fixture();
  const result = runCli(f, ["uninstall", "--yes"]);
  assert.equal(result.status, 0, `uninstall failed:\n${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(f.skill, "utf8"), "USER AUTHORED\n", "workspace bytes must survive");
  assert.ok(!fs.existsSync(path.join(f.stateDir, "telemetry")), "disposable state must be removed");
  assert.ok(!fs.existsSync(path.join(f.stateDir, "enabled-packages.json")), "package registry must be removed");
  assert.match(result.stdout, /preserved/i, "result must tell the user the workspace was kept");
  assert.match(result.stdout, /npm uninstall -g codethings-roborepo-alpha/, "must print the npm removal command");
}

function testRelocatedWorkspaceUntouched() {
  const f = fixture({ relocated: true });
  const result = runCli(f, ["uninstall", "--yes"]);
  assert.equal(result.status, 0, `uninstall failed:\n${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(f.skill, "utf8"), "USER AUTHORED\n", "relocated workspace must survive");
  assert.ok(
    fs.existsSync(path.join(f.stateDir, "workspace-root.json")),
    "the pointer must survive alongside the tree it names, so a reinstall can still find it",
  );
}

function testDeleteWorkspaceOptIn() {
  const f = fixture();
  const result = runCli(f, ["uninstall", "--yes", "--delete-workspace"]);
  assert.equal(result.status, 0, `uninstall failed:\n${result.stdout}\n${result.stderr}`);
  assert.ok(!fs.existsSync(f.workspace), "explicit opt-in deletes a nested workspace");
  assert.ok(
    !fs.existsSync(path.join(f.stateDir, "workspace-root.json")),
    "the pointer goes with the tree when the tree is deleted",
  );
}

// The load-bearing safety property: a workspace the user deliberately relocated is never deleted by
// roborepo, even when deletion was explicitly requested. roborepo did not create that location.
function testRelocatedNeverDeletedEvenWithOptIn() {
  const f = fixture({ relocated: true });
  const result = runCli(f, ["uninstall", "--yes", "--delete-workspace"]);
  assert.equal(result.status, 0, `uninstall failed:\n${result.stdout}\n${result.stderr}`);
  assert.equal(
    fs.readFileSync(f.skill, "utf8"),
    "USER AUTHORED\n",
    "--delete-workspace must NOT reach a relocated workspace",
  );
  assert.match(result.stdout, /preserved/i, "and must say so rather than silently ignoring the flag");
}

function testNoninteractiveRefusesWithoutYes() {
  const f = fixture();
  const result = runCli(f, ["uninstall"]);
  assert.equal(result.status, 2, "destructive + noninteractive without --yes must refuse");
  assert.match(result.stderr, /--yes|--dry-run/, "refusal must name the way forward");
  assert.ok(fs.existsSync(f.skill), "nothing may be removed on refusal");
  assert.ok(fs.existsSync(path.join(f.stateDir, "telemetry")), "nothing may be removed on refusal");
}

function testDryRunMutatesNothing() {
  const f = fixture();
  const result = runCli(f, ["uninstall", "--dry-run"]);
  assert.equal(result.status, 0, `dry-run failed:\n${result.stdout}\n${result.stderr}`);
  assert.ok(fs.existsSync(f.skill), "dry run must not touch the workspace");
  assert.ok(fs.existsSync(path.join(f.stateDir, "telemetry")), "dry run must not remove state");

  // --dry-run wins over --delete-workspace: previewing a destructive option must not perform it.
  const f2 = fixture();
  runCli(f2, ["uninstall", "--dry-run", "--delete-workspace"]);
  assert.ok(fs.existsSync(f2.workspace), "dry run must not delete even when opt-in is passed");
}

function testRepeatedUninstallIsSafe() {
  const f = fixture();
  const first = runCli(f, ["uninstall", "--yes"]);
  assert.equal(first.status, 0, `first uninstall failed:\n${first.stderr}`);
  const second = runCli(f, ["uninstall", "--yes"]);
  assert.equal(second.status, 0, `repeated uninstall must be safe:\n${second.stdout}\n${second.stderr}`);
  assert.equal(fs.readFileSync(f.skill, "utf8"), "USER AUTHORED\n", "workspace still intact after two runs");
}

// A preserved workspace legitimately keeps the state root alive, so --check-clean must not report
// that as unclean; genuine leftovers still must fail it.
function testCheckCleanToleratesPreservedWorkspace() {
  const f = fixture();
  runCli(f, ["uninstall", "--yes"]);
  const clean = spawnSync("bash", [uninstallSh, "--check-clean"], { cwd: repoRoot, env: env(f), encoding: "utf8" });
  assert.equal(clean.status, 0, `preserved workspace must not count as a remnant:\n${clean.stderr}`);

  fs.mkdirSync(path.join(f.stateDir, "telemetry"), { recursive: true });
  const dirty = spawnSync("bash", [uninstallSh, "--check-clean"], { cwd: repoRoot, env: env(f), encoding: "utf8" });
  assert.equal(dirty.status, 1, "genuine leftover state must still be reported");
  assert.match(dirty.stderr, /remnant/, "and must name what was left behind");
}

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
  await testPortalUninstallRequiresExplicitConfirm();
  testPortalSurfaceIsPreserveOnly();
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

// --- Portal surface. Exercised through the route handler directly rather than over HTTP against a
// detached `roborepo web`: the security-relevant behavior (explicit-confirm gate, preserve-only
// semantics, error mapping) is all handler-side, and a real detached server strands a process when
// the test's sandboxed HOME does not match the one holding its PID file — which hung this suite.
// The origin+token guard runs in portal-server.mjs before dispatch and is covered by that layer.
function fakeRes() {
  const res = { statusCode: null, body: null, headers: {}, ended: false };
  res.writeHead = (status, headers) => { res.statusCode = status; Object.assign(res.headers, headers || {}); return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.end = (chunk) => { res.body = chunk ? String(chunk) : res.body; res.ended = true; return res; };
  res.write = (chunk) => { res.body = (res.body || "") + String(chunk); return true; };
  return res;
}

function fakeReq({ method, body }) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const listeners = {};
  return {
    method,
    headers: { "content-type": "application/json" },
    on(event, handler) {
      listeners[event] = handler;
      // Deliver the body synchronously on the next tick so readJsonBody's data/end wiring runs.
      if (event === "end") {
        queueMicrotask(() => {
          if (payload && listeners.data) listeners.data(Buffer.from(payload));
          handler();
        });
      }
      return this;
    },
  };
}

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function testPortalUninstallRequiresExplicitConfirm() {
  const { handleMaintenanceApi } = await import(path.join(repoRoot, "scripts/cli/portal-routes-maintenance.mjs"));
  const f = fixture();

  // Stubs, deliberately: this test is about the route's own gating, not about cleanup itself
  // (which the CLI cases above cover against real fixtures). A stub that throws if called proves
  // the unconfirmed request never reaches removal.
  const handlers = {
    uninstallPreview: () => ({ ok: true, workspacePreserved: true, removals: [], npmCommand: "npm uninstall -g x" }),
    uninstallExecute: () => { throw new Error("execute must not be reached without explicit confirm"); },
  };

  // A POST without { confirm: true } must be rejected by the handler itself, before any removal.
  const res = fakeRes();
  const handled = handleMaintenanceApi(fakeReq({ method: "POST", body: {} }), res, "/api/maintenance/uninstall", "", handlers);
  assert.equal(handled, true, "handler must claim the uninstall route");
  await settle();
  assert.equal(res.statusCode, 400, "POST without explicit confirm must be refused");
  assert.match(res.body || "", /confirm/i, "refusal must name the missing confirmation");
  assert.ok(fs.existsSync(f.skill), "refused POST must not mutate anything");

  // Unknown maintenance paths fall through so portal-server can try the next domain / 404.
  assert.equal(
    handleMaintenanceApi(fakeReq({ method: "GET" }), fakeRes(), "/api/maintenance/nope", "", handlers),
    false,
    "unmatched maintenance paths must not be claimed",
  );
}

// The portal surface can never delete a workspace: uninstallExecute pins the flag off, so there is
// no request shape that reaches workspace deletion through the browser.
function testPortalSurfaceIsPreserveOnly() {
  const source = fs.readFileSync(path.join(repoRoot, "scripts/cli/uninstall.mjs"), "utf8");
  const executeBlock = source.slice(source.indexOf("export function uninstallExecute"));
  assert.match(
    executeBlock.slice(0, executeBlock.indexOf("}\n\n")),
    /ROBOREPO_UNINSTALL_DELETE_WORKSPACE: "0"/,
    "portal execute must hard-code workspace preservation",
  );
  // Strip comments first: the module explains in prose why deletion is absent, and matching that
  // sentence would make this assert the opposite of what it means to check.
  const routes = fs.readFileSync(path.join(repoRoot, "scripts/cli/portal-routes-maintenance.mjs"), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(routes, /deleteWorkspace/, "the portal route must not expose a deletion option");
}

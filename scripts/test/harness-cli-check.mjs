#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// `roborepo harness list|inspect|refresh|enable|disable`, end to end through the real CLI
// process. See docs/plans/active/discoverable-harness-provider-architecture-plan.md Phase 2.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(repoRoot, "scripts/cli/main.mjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-harness-cli-"));
try {
  testZeroStateListIsSafe();
  testRefreshDiscoversAndEnables();
  testInspectUnknownHarnessFails();
  testEnableDisableRoundTrip();
  console.log("harness CLI checks passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function run(args) {
  const env = { ...process.env, HOME: tmp, ROBOREPO_STATE_DIR: path.join(tmp, ".roborepo") };
  return spawnSync(process.execPath, [cli, ...args], { cwd: repoRoot, env, encoding: "utf8" });
}

function testZeroStateListIsSafe() {
  const result = run(["harness", "list"]);
  assert.equal(result.status, 0, `list failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /^claude\t/m, "list must include claude even before any discovery has run");
  assert.match(result.stdout, /^codex\t/m, "list must include codex even before any discovery has run");
  assert.match(result.stdout, /disabled/, "undiscovered providers must show as disabled, not silently enabled");
}

function testRefreshDiscoversAndEnables() {
  const result = run(["harness", "refresh"]);
  assert.equal(result.status, 0, `refresh failed:\n${result.stdout}\n${result.stderr}`);
  // Whether claude/codex executables are on PATH varies by machine (e.g. CI runners have neither),
  // so this only asserts the CLI plumbing works end to end, not a specific discovery outcome —
  // discovery's actual confidence-normalization logic is covered deterministically by
  // harness-registry-check.mjs against fixture manifests, not real installed executables.
  assert.match(result.stdout, /^claude\t/m, "refresh output must list claude");
  assert.match(result.stdout, /^codex\t/m, "refresh output must list codex");
}

function testInspectUnknownHarnessFails() {
  const result = run(["harness", "inspect", "bogus-harness"]);
  assert.notEqual(result.status, 0, "inspecting an unknown harness id must fail, not silently succeed");
  assert.match(result.stderr, /unknown harness/, "must report the unknown harness by name");
}

function testEnableDisableRoundTrip() {
  let result = run(["harness", "disable", "codex"]);
  assert.equal(result.status, 0, `disable failed:\n${result.stdout}\n${result.stderr}`);

  result = run(["harness", "list"]);
  assert.match(result.stdout, /^codex\t.*\tdisabled\t/m, "codex must show disabled after explicit disable");

  // Refresh must not silently re-enable an explicit disable.
  result = run(["harness", "refresh"]);
  assert.match(result.stdout, /^codex\t.*\tdisabled\t/m, "explicit disable must survive refresh");

  result = run(["harness", "enable", "codex"]);
  assert.equal(result.status, 0, `enable failed:\n${result.stdout}\n${result.stderr}`);
  result = run(["harness", "list"]);
  assert.match(result.stdout, /^codex\t.*\tenabled\t/m, "codex must show enabled after explicit enable");
}

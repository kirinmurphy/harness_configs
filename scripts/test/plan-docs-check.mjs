#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildPlanSnapshot,
  buildPrompt,
  discoverRepositories,
  parseFrontmatter,
  readPlanDocument,
  updatePlanPriority,
  writeFrontmatterField,
  writePlanSettings,
} from "../../modules/plan-docs/index.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-plan-docs-"));
try {
  const stateRoot = path.join(tempRoot, "state");
  const projects = path.join(tempRoot, "projects");
  const repo = path.join(projects, "sample");
  fs.mkdirSync(path.join(repo, "docs", "plans", "backlog"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs", "plans", "completed"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".git"), "gitdir: nowhere\n");
  fs.writeFileSync(path.join(repo, "docs", "plans", "backlog", "ready.md"), `---
id: ready-plan
priority: high
next_action: Add the portal view
blocked_by: []
depends_on: []
related: []
reviewed_commit:
---
# Ready Plan

## Summary

Build the thing.

## Context

Current implementation exists.

## Goals

Make plans visible.

## Proposed design

Use Markdown as source of truth.

## Implementation plan

- [ ] Add page
- [x] Add schema

## Validation

Run targeted checks.
`);
  fs.writeFileSync(path.join(repo, "docs", "plans", "root.md"), "# Root Plan\n");
  fs.writeFileSync(path.join(repo, "docs", "plans", "backlog", "no-priority.md"), `---
id: no-priority-plan
next_action: Add the portal view
blocked_by: []
depends_on: []
related: []
reviewed_commit:
---
# No Priority Plan

## Summary

Plan with no priority frontmatter key at all (not just an empty value) — renders as "none" in
the UI via buildPlanRecord's fallback, and must still be settable through the priority endpoint.

## Context

Current implementation exists.

## Goals

Make plans visible.

## Proposed design

Use Markdown as source of truth.

## Implementation plan

- [ ] Add page

## Validation

Run targeted checks.
`);
  writePlanSettings({ stateRoot, discoveryRoots: [projects] });

  const snapshot = buildPlanSnapshot({ stateRoot, packageState: { available: true, enabled: false, status: "disabled" } });
  assert.equal(snapshot.repositories.length, 1);
  assert.equal(snapshot.plans.length, 3);
  const ready = snapshot.plans.find((item) => item.plan.id === "ready-plan");
  assert.ok(ready);
  assert.equal(ready.plan.lifecycle, "backlog");
  assert.equal(ready.plan.readiness, "ready");
  assert.equal(ready.plan.taskCounts.remaining, 1);
  const root = snapshot.plans.find((item) => item.plan.relativePath.endsWith("root.md"));
  assert.equal(root.plan.lifecycle, "unclassified");
  assert.match(root.plan.validation.warnings.join("\n"), /unclassified/);

  const doc = readPlanDocument(snapshot, ready.key);
  assert.match(doc.html, /Ready Plan/);
  assert.doesNotMatch(JSON.stringify(doc.plan), new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(JSON.stringify(doc.parsed), new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const prompt = buildPrompt("start", [ready], { mode: "repository-aware" });
  assert.match(prompt, /\/plan-docs start/);
  assert.match(prompt, /docs\/plans\/backlog\/ready.md/);
  const portablePrompt = buildPrompt("next", [ready], { mode: "portable" });
  assert.match(portablePrompt, /\/plan-docs next/);
  assert.match(portablePrompt, /Use this bounded portable plan context/);

  const parsed = parseFrontmatter("---\nid: bad\nblocked_by: [x]\n---\n# T\n");
  assert.match(parsed.warnings.join("\n"), /Unsupported inline array/);

  // --- writeFrontmatterField: patches one scalar key, preserves everything else -----------------
  const rewritten = writeFrontmatterField(
    "---\nid: foo\npriority: low\nnext_action: do it\n---\n# Body\n\ntext\n",
    "priority",
    "high",
  );
  assert.match(rewritten, /priority: high/);
  assert.doesNotMatch(rewritten, /priority: low/);
  assert.match(rewritten, /id: foo/);
  assert.match(rewritten, /next_action: do it/);
  assert.match(rewritten, /# Body\n\ntext\n$/);
  assert.throws(() => writeFrontmatterField("no frontmatter", "priority", "high"), /missing frontmatter/);

  // Missing key entirely (not just an empty value) must be appended, not throw — a plan with no
  // `priority:` line renders the same "none" fallback as an empty one (buildPlanRecord's
  // `parsed.frontmatter.priority || "none"`), so the writer must be able to turn either into a
  // real on-disk value or the UI's "none" option would be unusable.
  const appended = writeFrontmatterField("---\nid: foo\n---\nbody", "priority", "high");
  assert.match(appended, /id: foo\npriority: high/);
  assert.match(appended, /---\nbody$/);

  // --- updatePlanPriority: mtime-checked read-modify-write against a real plan file --------------
  const readySnapshot = buildPlanSnapshot({ stateRoot, packageState: { available: true, enabled: false, status: "disabled" } });
  const readyRecord = readySnapshot.plans.find((item) => item.plan.id === "ready-plan");
  assert.equal(readyRecord.plan.priority, "high");
  assert.ok(Number.isFinite(readyRecord.mtimeMs), "expected mtimeMs on the public plan record");

  const priorityResult = updatePlanPriority(readySnapshot, readyRecord.key, "low", readyRecord.mtimeMs);
  assert.equal(priorityResult.priority, "low");
  assert.ok(Number.isFinite(priorityResult.mtimeMs));
  const onDisk = fs.readFileSync(path.join(repo, "docs", "plans", "backlog", "ready.md"), "utf8");
  assert.match(onDisk, /priority: low/);
  assert.match(onDisk, /## Implementation plan/); // body untouched

  assert.throws(() => updatePlanPriority(readySnapshot, readyRecord.key, "not-a-priority", priorityResult.mtimeMs), /invalid priority/);

  // Conflict: stale mtime (as if another process/editor touched the file since it was loaded).
  assert.throws(() => {
    try {
      updatePlanPriority(readySnapshot, readyRecord.key, "high", readyRecord.mtimeMs /* stale, already advanced above */);
    } catch (err) {
      assert.equal(err.code, "CONFLICT");
      throw err;
    }
  }, /changed since it was loaded/);

  // Regression: a plan with no `priority:` frontmatter key at all (displays as "none" via
  // buildPlanRecord's `|| "none"` fallback) must still be settable, not throw "key not found".
  const noPriorityRecord = readySnapshot.plans.find((item) => item.plan.id === "no-priority-plan");
  assert.equal(noPriorityRecord.plan.priority, "none");
  const noPriorityResult = updatePlanPriority(readySnapshot, noPriorityRecord.key, "high", noPriorityRecord.mtimeMs);
  assert.equal(noPriorityResult.priority, "high");
  const noPriorityOnDisk = fs.readFileSync(path.join(repo, "docs", "plans", "backlog", "no-priority.md"), "utf8");
  assert.match(noPriorityOnDisk, /priority: high/);

  const portalFacing = spawnSync(process.execPath, [
    "-e",
    "import('./scripts/cli/plans.mjs').then((m) => { const snap = m.loadPlansSnapshot(); process.stdout.write(JSON.stringify(snap)); })",
  ], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
    env: {
      ...process.env,
      ROBOREPO_STATE_ROOT: stateRoot,
      ROBOREPO_PLAN_ROOTS: projects,
    },
    encoding: "utf8",
  });
  assert.equal(portalFacing.status, 0, portalFacing.stderr);
  const portalSnapshot = JSON.parse(portalFacing.stdout);
  assert.equal(portalSnapshot.repositories[0].root, undefined);
  assert.equal(portalSnapshot.plans[0].absolutePath, undefined);
  assert.equal(portalSnapshot.plans[0].repository.root, undefined);

  // Regression: planDocsPackage.enabled must track the package's real live-enabled state
  // (buildPackageLiveState, same source config.mjs's readConfigSnapshot uses), not the raw
  // catalog entry — the catalog entry never carries a `.status`/`.catalogStatus` field at all, so
  // reading those directly off it (the previous implementation) always evaluated to `enabled:
  // false` regardless of whether the package was actually enabled.
  {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-plan-docs-home-"));
    const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "cli", "main.mjs");
    fs.mkdirSync(path.join(homeDir, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(homeDir, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(homeDir, ".claude", "settings.json"), "{}");
    fs.writeFileSync(path.join(homeDir, ".codex", "config.toml"), "");
    const env = {
      ...process.env,
      HOME: homeDir,
      ROBOREPO_STATE_DIR: path.join(homeDir, ".roborepo"),
      ROBOREPO_STATE_ROOT: path.join(homeDir, ".roborepo"),
      ROBOREPO_SKIP_MCP: "1",
    };
    const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

    const readSnapshotEnabled = () => {
      const result = spawnSync(process.execPath, [
        "-e",
        "import('./scripts/cli/plans.mjs').then((m) => { process.stdout.write(JSON.stringify(m.loadPlansSnapshot().planDocsPackage)); })",
      ], { cwd, env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };

    const beforeEnable = readSnapshotEnabled();
    assert.equal(beforeEnable.enabled, false, "plan-docs starts disabled in a fresh HOME");

    spawnSync(process.execPath, [cliPath, "package", "enable", "plan-docs"], { env, stdio: "ignore" });
    const afterEnable = readSnapshotEnabled();
    assert.equal(afterEnable.enabled, true, "planDocsPackage.enabled reflects the real live-enabled state after `roborepo enable plan-docs`");

    spawnSync(process.execPath, [cliPath, "package", "disable", "plan-docs"], { env, stdio: "ignore" });
    const afterDisable = readSnapshotEnabled();
    assert.equal(afterDisable.enabled, false, "planDocsPackage.enabled reflects disabled state after `roborepo disable plan-docs`");

    fs.rmSync(homeDir, { recursive: true, force: true });
  }

  // --- repository discovery traversal (recursive walk rewrite) ---------------------------------
  const traversalRoot = path.join(tempRoot, "traversal");

  // Nested repo discovery: a repo 2+ levels deep under the discovery root must be found.
  const nested = path.join(traversalRoot, "group-a", "group-b", "nested-repo");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, ".git"), "gitdir: nowhere\n");

  // Stop-at-first-.git: a subfolder of a repo must NOT be double-counted as its own repo root,
  // even though it satisfies candidateRepository's docs/plans check.
  fs.mkdirSync(path.join(nested, "docs", "plans"), { recursive: true });
  fs.mkdirSync(path.join(nested, "vendor", "docs", "plans"), { recursive: true }); // also blacklist-covered

  // Blacklist bail-out: a repo living inside an ignored directory name must not be discovered.
  const blacklisted = path.join(traversalRoot, "node_modules", "should-not-be-found");
  fs.mkdirSync(blacklisted, { recursive: true });
  fs.writeFileSync(path.join(blacklisted, ".git"), "gitdir: nowhere\n");
  const cacheBlacklisted = path.join(traversalRoot, ".cache", "also-should-not-be-found");
  fs.mkdirSync(cacheBlacklisted, { recursive: true });
  fs.writeFileSync(path.join(cacheBlacklisted, ".git"), "gitdir: nowhere\n");

  const traversalSettings = { discoveryRoots: [traversalRoot], ignoredDirectories: undefined };
  const discovery = discoverRepositories(traversalSettings);
  assert.equal(discovery.repositories.length, 1, "expected exactly one discovered repo (nested-repo), got: " + JSON.stringify(discovery.repositories.map((r) => r.name)));
  assert.equal(discovery.repositories[0].name, "nested-repo");
  assert.equal(discovery.truncated, false);

  // Depth cap: a repo deeper than DISCOVERY_MAX_DEPTH (6) below the root must not be found.
  const deepRoot = path.join(tempRoot, "deep");
  const tooDeepSegments = Array.from({ length: 8 }, (_, i) => `d${i}`);
  const tooDeepRepo = path.join(deepRoot, ...tooDeepSegments);
  fs.mkdirSync(tooDeepRepo, { recursive: true });
  fs.writeFileSync(path.join(tooDeepRepo, ".git"), "gitdir: nowhere\n");
  const deepDiscovery = discoverRepositories({ discoveryRoots: [deepRoot], ignoredDirectories: undefined });
  assert.equal(deepDiscovery.repositories.length, 0, "repo beyond the depth cap should not be found");

  // Time-budget truncation: force the budget to ~0ms via env override so the walk's first
  // deadline check trips immediately, without needing a real slow scan or a huge synthetic tree.
  const budgetCheck = spawnSync(process.execPath, [
    "-e",
    "import('./modules/plan-docs/index.mjs').then((m) => { const d = m.discoverRepositories({ discoveryRoots: [process.env.TRAVERSAL_ROOT], ignoredDirectories: undefined }); process.stdout.write(JSON.stringify(d)); })",
  ], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
    env: { ...process.env, ROBOREPO_DISCOVERY_TIME_BUDGET_MS: "0", TRAVERSAL_ROOT: traversalRoot },
    encoding: "utf8",
  });
  assert.equal(budgetCheck.status, 0, budgetCheck.stderr);
  const budgetResult = JSON.parse(budgetCheck.stdout);
  assert.equal(budgetResult.truncated, true, "expected truncation with a ~0ms time budget");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("ok: plan docs behavior");

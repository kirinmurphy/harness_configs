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
  writePlanSettings({ stateRoot, discoveryRoots: [projects] });

  const snapshot = buildPlanSnapshot({ stateRoot, packageState: { available: true, enabled: false, status: "disabled" } });
  assert.equal(snapshot.repositories.length, 1);
  assert.equal(snapshot.plans.length, 2);
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

  // Time-budget truncation is not exercised here: a real test would need a tree slow enough to
  // exceed DISCOVERY_TIME_BUDGET_MS, which is either flaky (timing-dependent) or requires an
  // impractically large synthetic tree. Not covered — verify manually if the budget logic changes.
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("ok: plan docs behavior");

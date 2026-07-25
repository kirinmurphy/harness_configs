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
  movePlanLifecycle,
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
  fs.mkdirSync(path.join(repo, "docs", "plans", "active"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs", "plans", "completed"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs", "plans", "archived"), { recursive: true });
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
  // Fully-ready plan: satisfies backlog, active, completed, and archived destination
  // requirements at once (all tasks checked, has a Verification section, next_action can be
  // cleared before the archived-destination assertion) — used to exercise movePlanLifecycle
  // across every canonical source/destination pair without hand-writing 12 fixtures.
  fs.writeFileSync(path.join(repo, "docs", "plans", "backlog", "movable.md"), `---
id: movable-plan
priority: medium
next_action: Move this plan around in tests.
blocked_by: []
depends_on: []
related: []
reviewed_commit:
---
# Movable Plan

## Summary

Exercises lifecycle movement.

## Context

Used only by plan-docs-check.mjs.

## Goals

Prove movePlanLifecycle works for every canonical destination.

## Proposed design

N/A.

## Implementation plan

- [x] Nothing left to do

## Verification

Verified manually by the test itself.

## Validation

N/A.
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
  assert.equal(snapshot.plans.length, 4);
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

  const priorityResult = updatePlanPriority(readySnapshot, {
    id: readyRecord.plan.id,
    key: readyRecord.key,
    priority: "low",
    expectedPriority: readyRecord.plan.priority,
    mtimeMs: readyRecord.mtimeMs,
  });
  assert.equal(priorityResult.change.property, "priority");
  assert.equal(priorityResult.change.previousValue, "high");
  assert.equal(priorityResult.change.newValue, "low");
  assert.equal(priorityResult.record.plan.priority, "low", "priority returns a complete rebuilt record, not just {priority, mtimeMs}");
  assert.equal(priorityResult.record.plan.id, "ready-plan");
  assert.ok(Number.isFinite(priorityResult.record.mtimeMs));
  const onDisk = fs.readFileSync(path.join(repo, "docs", "plans", "backlog", "ready.md"), "utf8");
  assert.match(onDisk, /priority: low/);
  assert.match(onDisk, /## Implementation plan/); // body untouched

  assert.throws(
    () => updatePlanPriority(readySnapshot, { id: readyRecord.plan.id, key: readyRecord.key, priority: "not-a-priority", expectedPriority: "low", mtimeMs: priorityResult.record.mtimeMs }),
    /invalid priority/,
  );

  // Stale conflict: mtime (as if another process/editor touched the file since it was loaded).
  assert.throws(() => {
    try {
      updatePlanPriority(readySnapshot, {
        id: readyRecord.plan.id,
        key: readyRecord.key,
        priority: "high",
        expectedPriority: "low",
        mtimeMs: readyRecord.mtimeMs, // stale, already advanced above
      });
    } catch (err) {
      assert.equal(err.code, "STALE_PLAN");
      assert.equal(err.status, 409);
      throw err;
    }
  }, /changed outside the portal/);

  // Stale conflict: expectedPriority mismatch alone (mtime happens to still match current disk
  // state — e.g. a concurrent request raced and won, then this one arrives with a now-wrong
  // expectation but a fresh mtime it never actually read).
  assert.throws(() => {
    try {
      updatePlanPriority(readySnapshot, {
        id: readyRecord.plan.id,
        key: readyRecord.key,
        priority: "high",
        expectedPriority: "medium", // wrong: current on-disk priority is "low"
        mtimeMs: priorityResult.record.mtimeMs,
      });
    } catch (err) {
      assert.equal(err.code, "STALE_PLAN");
      throw err;
    }
  }, /changed outside the portal/);

  // Regression: a plan with no `priority:` frontmatter key at all (displays as "none" via
  // buildPlanRecord's `|| "none"` fallback) must still be settable, not throw "key not found".
  const noPriorityRecord = readySnapshot.plans.find((item) => item.plan.id === "no-priority-plan");
  assert.equal(noPriorityRecord.plan.priority, "none");
  const noPriorityResult = updatePlanPriority(readySnapshot, {
    id: noPriorityRecord.plan.id,
    key: noPriorityRecord.key,
    priority: "high",
    expectedPriority: noPriorityRecord.plan.priority,
    mtimeMs: noPriorityRecord.mtimeMs,
  });
  assert.equal(noPriorityResult.record.plan.priority, "high");
  const noPriorityOnDisk = fs.readFileSync(path.join(repo, "docs", "plans", "backlog", "no-priority.md"), "utf8");
  assert.match(noPriorityOnDisk, /priority: high/);

  // --- movePlanLifecycle: file movement, validation, and stale-conflict handling -----------------
  const moveSnapshot = buildPlanSnapshot({ stateRoot, packageState: { available: true, enabled: false, status: "disabled" } });
  const movable = moveSnapshot.plans.find((item) => item.plan.id === "movable-plan");
  assert.equal(movable.plan.lifecycle, "backlog");

  // Unclassified is never a valid destination.
  assert.throws(() => movePlanLifecycle(moveSnapshot, {
    id: movable.plan.id, key: movable.key, lifecycle: "unclassified", expectedLifecycle: "backlog", mtimeMs: movable.mtimeMs,
  }), (err) => err.code === "INVALID_CHANGE");

  // Same-lifecycle move is rejected rather than treated as a silent no-op.
  assert.throws(() => movePlanLifecycle(moveSnapshot, {
    id: movable.plan.id, key: movable.key, lifecycle: "backlog", expectedLifecycle: "backlog", mtimeMs: movable.mtimeMs,
  }), (err) => err.code === "INVALID_CHANGE");

  // Full tour: backlog -> active -> completed -> archived -> backlog. Each move rebuilds the
  // snapshot from disk first, mirroring how the CLI layer re-resolves cachedSnapshot per request
  // (movePlanLifecycle never mutates the snapshot object it's given — the caller is expected to
  // treat it as a point-in-time read, exactly like a real portal request cycle).
  let current = movable;
  const tour = ["active", "completed", "archived", "backlog"];
  for (const destination of tour) {
    const before = current;
    // Completed forbids next_action; archived forbids it too. Backlog/active require it. Patch
    // the on-disk field immediately before each hop so the fixture satisfies whichever
    // destination is next, mirroring a real user editing the doc between lifecycle moves.
    const currentPath = path.join(repo, "docs", "plans", before.plan.lifecycle, "movable.md");
    const currentMarkdown = fs.readFileSync(currentPath, "utf8");
    const needsNextAction = destination === "active" || destination === "backlog";
    fs.writeFileSync(currentPath, writeFrontmatterField(currentMarkdown, "next_action", needsNextAction ? "Move this plan around in tests." : ""));
    const tourSnapshot = buildPlanSnapshot({ stateRoot, packageState: { available: true, enabled: false, status: "disabled" } });
    const refreshedBefore = tourSnapshot.plans.find((item) => item.plan.id === "movable-plan");
    const moveResult = movePlanLifecycle(tourSnapshot, {
      id: refreshedBefore.plan.id,
      key: refreshedBefore.key,
      lifecycle: destination,
      expectedLifecycle: refreshedBefore.plan.lifecycle,
      mtimeMs: refreshedBefore.mtimeMs,
      repositoryId: refreshedBefore.repository.id,
    });
    assert.equal(moveResult.change.property, "lifecycle");
    assert.equal(moveResult.change.previousValue, before.plan.lifecycle);
    assert.equal(moveResult.change.newValue, destination);
    assert.equal(moveResult.record.plan.lifecycle, destination);
    assert.equal(moveResult.record.plan.id, "movable-plan", "stable id unchanged after movement");
    assert.notEqual(moveResult.record.key, before.key, "key changed after movement");
    assert.match(moveResult.record.plan.relativePath, new RegExp(`^docs/plans/${destination}/movable\\.md$`));
    assert.ok(!fs.existsSync(path.join(repo, "docs", "plans", before.plan.lifecycle, "movable.md")), "source removed");
    assert.ok(fs.existsSync(path.join(repo, "docs", "plans", destination, "movable.md")), "destination created");
    const movedOnDisk = fs.readFileSync(path.join(repo, "docs", "plans", destination, "movable.md"), "utf8");
    assert.match(movedOnDisk, /id: movable-plan/, "frontmatter unchanged by lifecycle movement");
    current = moveResult.record;
  }

  // Unclassified source -> canonical destination.
  const rootPlanBefore = moveSnapshot.plans.find((item) => item.plan.relativePath.endsWith("root.md"));
  assert.equal(rootPlanBefore.plan.lifecycle, "unclassified");
  const rootMoveResult = movePlanLifecycle(moveSnapshot, {
    id: rootPlanBefore.plan.id || undefined,
    key: rootPlanBefore.key,
    lifecycle: "backlog",
    expectedLifecycle: "unclassified",
    mtimeMs: rootPlanBefore.mtimeMs,
    skipDestinationValidation: true, // root.md has no frontmatter/headings at all
  });
  assert.equal(rootMoveResult.record.plan.lifecycle, "backlog");
  assert.ok(fs.existsSync(path.join(repo, "docs", "plans", "backlog", "root.md")));

  // Destination collision: pre-occupy the target path, confirm neither file moves.
  fs.writeFileSync(path.join(repo, "docs", "plans", "backlog", "collide-active.md"), "# placeholder\n");
  fs.mkdirSync(path.join(repo, "docs", "plans", "active"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs", "plans", "active", "collide-active.md"), "# occupies destination\n");
  const collisionSnapshot = buildPlanSnapshot({ stateRoot, packageState: { available: true, enabled: false, status: "disabled" } });
  const collideSource = collisionSnapshot.plans.find((item) => item.plan.relativePath.endsWith("collide-active.md") && item.plan.lifecycle === "backlog");
  assert.throws(() => movePlanLifecycle(collisionSnapshot, {
    id: collideSource.plan.id || undefined,
    key: collideSource.key,
    lifecycle: "active",
    expectedLifecycle: "backlog",
    mtimeMs: collideSource.mtimeMs,
    skipDestinationValidation: true,
  }), (err) => err.code === "DESTINATION_EXISTS");
  assert.ok(fs.existsSync(path.join(repo, "docs", "plans", "backlog", "collide-active.md")), "source untouched after rejected collision");
  assert.match(fs.readFileSync(path.join(repo, "docs", "plans", "active", "collide-active.md"), "utf8"), /occupies destination/, "destination untouched after rejected collision");

  // Stale conflicts: mtime, lifecycle, and key/path (via a wrong id+key combo) all rejected.
  const staleSnapshot = buildPlanSnapshot({ stateRoot, packageState: { available: true, enabled: false, status: "disabled" } });
  const staleSource = staleSnapshot.plans.find((item) => item.plan.id === "ready-plan");
  assert.throws(() => movePlanLifecycle(staleSnapshot, {
    id: staleSource.plan.id, key: staleSource.key, lifecycle: "active", expectedLifecycle: "backlog", mtimeMs: staleSource.mtimeMs - 1,
  }), (err) => err.code === "STALE_PLAN");
  assert.throws(() => movePlanLifecycle(staleSnapshot, {
    id: staleSource.plan.id, key: staleSource.key, lifecycle: "active", expectedLifecycle: "active" /* wrong: it's backlog */, mtimeMs: staleSource.mtimeMs,
  }), (err) => err.code === "STALE_PLAN");

  // File moved externally (outside the portal) between snapshot build and the mutation request:
  // the mtime/path check must catch it and report STALE_PLAN, not a generic filesystem error.
  const externalSnapshot = buildPlanSnapshot({ stateRoot, packageState: { available: true, enabled: false, status: "disabled" } });
  const externalSource = externalSnapshot.plans.find((item) => item.plan.id === "ready-plan");
  fs.renameSync(
    path.join(repo, "docs", "plans", "backlog", "ready.md"),
    path.join(repo, "docs", "plans", "archived", "ready.md"),
  );
  assert.throws(() => movePlanLifecycle(externalSnapshot, {
    id: externalSource.plan.id, key: externalSource.key, lifecycle: "active", expectedLifecycle: "backlog", mtimeMs: externalSource.mtimeMs,
  }), (err) => err.code === "STALE_PLAN");
  // Restore for subsequent assertions to keep fixture state predictable.
  fs.renameSync(
    path.join(repo, "docs", "plans", "archived", "ready.md"),
    path.join(repo, "docs", "plans", "backlog", "ready.md"),
  );

  // Lifecycle requirement errors are returned together, not fail-fast on the first violation.
  const requirementsSnapshot = buildPlanSnapshot({ stateRoot, packageState: { available: true, enabled: false, status: "disabled" } });
  const requirementsSource = requirementsSnapshot.plans.find((item) => item.plan.id === "no-priority-plan");
  assert.throws(() => {
    try {
      movePlanLifecycle(requirementsSnapshot, {
        id: requirementsSource.plan.id,
        key: requirementsSource.key,
        lifecycle: "completed",
        expectedLifecycle: "backlog",
        mtimeMs: requirementsSource.mtimeMs,
      });
    } catch (err) {
      assert.equal(err.code, "LIFECYCLE_REQUIREMENTS");
      assert.equal(err.status, 422);
      assert.ok(err.details.length > 1, `expected multiple accumulated requirement failures, got: ${JSON.stringify(err.details)}`);
      throw err;
    }
  }, /Couldn't move/);
  assert.ok(fs.existsSync(path.join(repo, "docs", "plans", "backlog", "no-priority.md")), "failed validation leaves source file unmoved");

  // Completed's Verification requirement checks for real content, not just a bare heading. A plan
  // that otherwise satisfies every Completed requirement (all tasks checked, no next_action, no
  // blockers) but whose "## Verification" section has nothing under it before the next heading
  // must still be rejected — heading presence alone used to be sufficient here.
  fs.writeFileSync(path.join(repo, "docs", "plans", "backlog", "empty-verification.md"), `---
id: empty-verification-plan
priority: medium
next_action:
blocked_by: []
depends_on: []
related: []
reviewed_commit:
---
# Empty Verification Plan

## Summary

Exercises the empty-Verification-body rejection.

## Context

Used only by plan-docs-check.mjs.

## Goals

Prove an empty Verification section fails Completed validation.

## Proposed design

N/A.

## Implementation plan

- [x] Nothing left to do

## Verification

## Validation

N/A.
`);
  const emptyVerificationSnapshot = buildPlanSnapshot({ stateRoot, packageState: { available: true, enabled: false, status: "disabled" } });
  const emptyVerificationSource = emptyVerificationSnapshot.plans.find((item) => item.plan.id === "empty-verification-plan");
  assert.throws(() => {
    try {
      movePlanLifecycle(emptyVerificationSnapshot, {
        id: emptyVerificationSource.plan.id,
        key: emptyVerificationSource.key,
        lifecycle: "completed",
        expectedLifecycle: "backlog",
        mtimeMs: emptyVerificationSource.mtimeMs,
      });
    } catch (err) {
      assert.equal(err.code, "LIFECYCLE_REQUIREMENTS");
      assert.ok(err.details.some((d) => /Verification/.test(d)), `expected a Verification requirement failure, got: ${JSON.stringify(err.details)}`);
      throw err;
    }
  }, /Couldn't move/);
  assert.ok(fs.existsSync(path.join(repo, "docs", "plans", "backlog", "empty-verification.md")), "failed validation leaves source file unmoved");

  // Filling in real content under the same heading is now sufficient to pass.
  fs.writeFileSync(
    path.join(repo, "docs", "plans", "backlog", "empty-verification.md"),
    fs.readFileSync(path.join(repo, "docs", "plans", "backlog", "empty-verification.md"), "utf8")
      .replace("## Verification\n\n## Validation", "## Verification\n\nVerified manually by the test itself.\n\n## Validation"),
  );
  const filledVerificationSnapshot = buildPlanSnapshot({ stateRoot, packageState: { available: true, enabled: false, status: "disabled" } });
  const filledVerificationSource = filledVerificationSnapshot.plans.find((item) => item.plan.id === "empty-verification-plan");
  const filledVerificationResult = movePlanLifecycle(filledVerificationSnapshot, {
    id: filledVerificationSource.plan.id,
    key: filledVerificationSource.key,
    lifecycle: "completed",
    expectedLifecycle: "backlog",
    mtimeMs: filledVerificationSource.mtimeMs,
  });
  assert.equal(filledVerificationResult.record.plan.lifecycle, "completed");

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

  // CLI-boundary check: updatePlanLifecycle/updatePlanPriority via scripts/cli/plans.mjs (not the
  // domain module directly) must strip absolutePath/repository.root from the returned record,
  // exactly like a full snapshot does — the doc's "public responses do not expose absolute paths"
  // requirement applies at this boundary, not just to buildPlanSnapshot's output.
  const noPriorityCliRecord = portalSnapshot.plans.find((item) => item.plan.id === "no-priority-plan");
  const lifecycleCliCheck = spawnSync(process.execPath, [
    "-e",
    `import('./scripts/cli/plans.mjs').then(async (m) => {
      const result = m.updatePlanLifecycle({
        id: ${JSON.stringify(noPriorityCliRecord.plan.id)},
        key: ${JSON.stringify(noPriorityCliRecord.key)},
        lifecycle: "active",
        expectedLifecycle: ${JSON.stringify(noPriorityCliRecord.plan.lifecycle)},
        mtimeMs: ${noPriorityCliRecord.mtimeMs},
      });
      process.stdout.write(JSON.stringify(result));
    })`,
  ], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
    env: { ...process.env, ROBOREPO_STATE_ROOT: stateRoot, ROBOREPO_PLAN_ROOTS: projects },
    encoding: "utf8",
  });
  assert.equal(lifecycleCliCheck.status, 0, lifecycleCliCheck.stderr);
  const lifecycleCliResult = JSON.parse(lifecycleCliCheck.stdout);
  assert.equal(lifecycleCliResult.change.newValue, "active");
  assert.equal(lifecycleCliResult.record.plan.lifecycle, "active");
  assert.equal(lifecycleCliResult.record.absolutePath, undefined, "CLI-layer lifecycle result must not expose absolutePath");
  assert.equal(lifecycleCliResult.record.repository.root, undefined, "CLI-layer lifecycle result must not expose repository.root");
  assert.ok(fs.existsSync(path.join(repo, "docs", "plans", "active", "no-priority.md")));

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

    spawnSync(process.execPath, [cliPath, "enable", "plan-docs"], { env, stdio: "ignore" });
    const afterEnable = readSnapshotEnabled();
    assert.equal(afterEnable.enabled, true, "planDocsPackage.enabled reflects the real live-enabled state after `roborepo enable plan-docs`");

    spawnSync(process.execPath, [cliPath, "disable", "plan-docs"], { env, stdio: "ignore" });
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

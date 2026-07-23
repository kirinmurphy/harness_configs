#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  emptyCohortFilter, normalizeCohortFilter, applyCohortFilter, describeCohortFilter,
  activeFilterCount, filterSessionsByTaskCategory,
} from "../cli/telemetry-cohort.mjs";

// Phase 5 of docs/plans/active/roborepo-telemetry-events-experiments-plan.md: the normalized cohort
// filter object shared by the CLI and portal (plan: "Cohort model" — "All panels must receive the
// same globally filtered event set"). Pure module over already-loaded capture/marker arrays; no fs.

testNormalizeFillsDefaults();
testNormalizeIgnoresGarbage();
testApplyFilterByHarnessModelRepo();
testApplyFilterByOperationAndPhase();
testApplyFilterByOutcomeRequiresMarkers();
testApplyFilterByOutcomeIgnoredWithoutMarkers();
testApplyFilterByTaskCategory();
testApplyFilterByTaskCategoryIgnoredWithoutMarkers();
testFilterSessionsByTaskCategory();
testDescribeCohortFilter();
testActiveFilterCount();
console.log("telemetry cohort checks passed");

function event(overrides) {
  return {
    harness: "claude",
    session_id: "s1",
    repo: { label: "roborepo" },
    ts: "2026-01-01T00:00:00Z",
    tokens: { total: 10 },
    session: { model: "sonnet" },
    ...overrides,
  };
}

function testNormalizeFillsDefaults() {
  const filter = normalizeCohortFilter(null);
  assert.deepEqual(filter, emptyCohortFilter());
}

function testNormalizeIgnoresGarbage() {
  const filter = normalizeCohortFilter({ harnesses: "not-an-array", models: [1, 2, "sonnet"], time: { range_ms: "bogus" } });
  assert.deepEqual(filter.harnesses, []);
  assert.deepEqual(filter.models, ["sonnet"]);
  assert.equal(filter.time.range_ms, null);
}

function testApplyFilterByHarnessModelRepo() {
  const events = [
    event({ harness: "claude", session: { model: "sonnet" }, repo: { label: "roborepo" } }),
    event({ harness: "codex", session: { model: "gpt" }, repo: { label: "other" } }),
  ];
  const filtered = applyCohortFilter(events, normalizeCohortFilter({ harnesses: ["claude"] }));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].harness, "claude");

  const byModel = applyCohortFilter(events, normalizeCohortFilter({ models: ["gpt"] }));
  assert.equal(byModel.length, 1);
  assert.equal(byModel[0].session.model, "gpt");

  const byRepo = applyCohortFilter(events, normalizeCohortFilter({ repos: ["other"] }));
  assert.equal(byRepo.length, 1);
}

function testApplyFilterByOperationAndPhase() {
  const events = [
    event({ operation: { category: "test" }, phase: { name: "debugging" } }),
    event({ operation: { category: "lint" }, phase: { name: "implementation" } }),
  ];
  const byOp = applyCohortFilter(events, normalizeCohortFilter({ operations: ["test"] }));
  assert.equal(byOp.length, 1);
  const byPhase = applyCohortFilter(events, normalizeCohortFilter({ phases: ["implementation"] }));
  assert.equal(byPhase.length, 1);
}

function testApplyFilterByOutcomeRequiresMarkers() {
  const events = [event({ session_id: "s1" }), event({ session_id: "s2" })];
  const markers = [
    { type: "outcome", session_id: "s1", status: "successful", ts: "2026-01-01T00:00:01Z" },
    { type: "outcome", session_id: "s2", status: "failed", ts: "2026-01-01T00:00:01Z" },
  ];
  const filtered = applyCohortFilter(events, normalizeCohortFilter({ outcomes: ["successful"] }), { markers });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].session_id, "s1");
}

function testApplyFilterByOutcomeIgnoredWithoutMarkers() {
  // Filtering by outcome with no markers passed must not silently drop everything — the plan
  // requires never inferring outcomes, so an outcome filter with no marker data degrades to a no-op
  // for that dimension rather than excluding every capture.
  const events = [event({ session_id: "s1" })];
  const filtered = applyCohortFilter(events, normalizeCohortFilter({ outcomes: ["successful"] }));
  assert.equal(filtered.length, 1);
}

function testApplyFilterByTaskCategory() {
  // task_categories must be a real per-capture filter through applyCohortFilter() (used by the
  // portal's cohort-vs-cohort analysis path), not only through the separate
  // filterSessionsByTaskCategory() helper experimentStatus() calls.
  const events = [event({ session_id: "s1" }), event({ session_id: "s2" })];
  const markers = [
    { type: "outcome", session_id: "s1", task_category: "bug-fix", ts: "2026-01-01T00:00:01Z" },
    { type: "outcome", session_id: "s2", task_category: "documentation", ts: "2026-01-01T00:00:01Z" },
  ];
  const filtered = applyCohortFilter(events, normalizeCohortFilter({ task_categories: ["bug-fix"] }), { markers });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].session_id, "s1");
}

function testApplyFilterByTaskCategoryIgnoredWithoutMarkers() {
  const events = [event({ session_id: "s1" })];
  const filtered = applyCohortFilter(events, normalizeCohortFilter({ task_categories: ["bug-fix"] }));
  assert.equal(filtered.length, 1, "task_categories filter with no marker data must not exclude everything");
}

function testFilterSessionsByTaskCategory() {
  const events = [event({ session_id: "s1" }), event({ session_id: "s2" })];
  const markers = [
    { type: "outcome", session_id: "s1", task_category: "bug-fix" },
    { type: "outcome", session_id: "s2", task_category: "documentation" },
  ];
  const filtered = filterSessionsByTaskCategory(events, ["bug-fix"], markers);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].session_id, "s1");

  const unfiltered = filterSessionsByTaskCategory(events, [], markers);
  assert.equal(unfiltered.length, 2, "empty task_categories filter must not restrict anything");
}

function testDescribeCohortFilter() {
  assert.equal(describeCohortFilter(emptyCohortFilter()), "all data");
  const described = describeCohortFilter(normalizeCohortFilter({ harnesses: ["claude"], repos: ["roborepo"] }));
  assert.match(described, /claude/);
  assert.match(described, /roborepo/);
}

function testActiveFilterCount() {
  assert.equal(activeFilterCount(emptyCohortFilter()), 0);
  assert.equal(activeFilterCount(normalizeCohortFilter({ harnesses: ["claude"], models: ["sonnet"] })), 2);
}

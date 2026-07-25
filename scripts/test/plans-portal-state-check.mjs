#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  isVisible,
  replaceRecord,
  filteredListActionFor,
  matchesFilters,
  FILTER_DEFAULTS,
} from "../../portal/plans/state.js";

// Phase 9 of docs/plans/active/plan-lifecycle-toggle-control.md: pure mutation-orchestration
// helpers (isVisible, replaceRecord, filteredListActionFor) have no DOM dependency, so this test
// drives them directly the same way telemetry-portal-state-check.mjs exercises telemetry's URL
// state helpers — no browser needed.

testLifecycleMoveMakesVisibleCardInvisible();
testPriorityChangeUnderMatchingFilterMakesInvisible();
testPriorityChangeUnderAllKeepsVisible();
testRecordNotPreviouslyVisibleStaysInvisible();
testReplaceRecordSwapsOldKeyForNew();
testReplaceRecordLeavesOtherRecordsUntouched();
testFilteredListActionForLifecycleWhenFilterMatchesPreviousValue();
testFilteredListActionForLifecycleNullWhenFilterDoesNotMatch();
testFilteredListActionForPriorityWhenFilterMatchesPreviousValue();
testFilteredListActionForPriorityNullWhenFilterDoesNotMatch();
testFilteredListActionForUnrelatedPropertyReturnsNull();
console.log("ok: plans portal state (mutation orchestration helpers) checks passed");

function record({ key = "k1", lifecycle = "backlog", priority = "high", id = "plan-1" } = {}) {
  return {
    key,
    mtimeMs: 1,
    repository: { id: "r1", name: "repo" },
    plan: {
      id,
      title: "Plan " + id,
      lifecycle,
      priority,
      relativePath: `docs/plans/${lifecycle}/${id}.md`,
      nextAction: "",
      blockers: [],
      dependencies: [],
      related: [],
      reviewedCommit: "",
      reviewState: "never-reviewed",
      modifiedAt: new Date().toISOString(),
      gitStatus: null,
      taskCounts: { total: 0, complete: 0, remaining: 0 },
      headings: [],
      excerpt: "",
      validation: { valid: true, warnings: [] },
    },
  };
}

function testLifecycleMoveMakesVisibleCardInvisible() {
  const r = record({ lifecycle: "backlog" });
  const before = isVisible(r, "backlog", FILTER_DEFAULTS);
  const moved = record({ ...r, lifecycle: "active" });
  moved.plan.lifecycle = "active";
  const after = isVisible(moved, "backlog", FILTER_DEFAULTS);
  assert.equal(before, true, "expected the original record visible on the backlog tab");
  assert.equal(after, false, "expected the moved record invisible on the backlog tab");
}

function testPriorityChangeUnderMatchingFilterMakesInvisible() {
  const filters = { ...FILTER_DEFAULTS, priority: "high" };
  const r = record({ priority: "high" });
  assert.equal(isVisible(r, "backlog", filters), true);
  const changed = record({ priority: "low" });
  assert.equal(isVisible(changed, "backlog", filters), false, "priority filter=high must exclude a record now priority=low");
}

function testPriorityChangeUnderAllKeepsVisible() {
  const filters = { ...FILTER_DEFAULTS, priority: "all" };
  const changed = record({ priority: "low" });
  assert.equal(isVisible(changed, "backlog", filters), true, "priority filter=all must keep any priority visible");
}

function testRecordNotPreviouslyVisibleStaysInvisible() {
  // A record already excluded by lifecycle tab before a priority change stays excluded after —
  // there is no removal to notify about (the doc: "a record not previously visible does not
  // generate a removal toast").
  const filters = { ...FILTER_DEFAULTS };
  const r = record({ lifecycle: "active" });
  const wasVisible = isVisible(r, "backlog", filters);
  assert.equal(wasVisible, false);
  const changed = record({ lifecycle: "active", priority: "low" });
  const nowVisible = isVisible(changed, "backlog", filters);
  assert.equal(nowVisible, false);
}

function testReplaceRecordSwapsOldKeyForNew() {
  const original = record({ key: "old-key" });
  const updated = record({ key: "new-key" });
  const plans = [record({ key: "other" }), original];
  const replaced = replaceRecord(plans, "old-key", updated);
  assert.equal(replaced.length, 2);
  assert.equal(replaced.find((item) => item.key === "new-key"), updated, "returned old key must be replaced by the new key exactly once");
  assert.equal(replaced.some((item) => item.key === "old-key"), false, "the stale old key must no longer be present");
}

function testReplaceRecordLeavesOtherRecordsUntouched() {
  const other = record({ key: "other" });
  const plans = [other, record({ key: "target" })];
  const replaced = replaceRecord(plans, "target", record({ key: "target-v2" }));
  assert.equal(replaced[0], other, "an unrelated record must be returned as the same reference, not rebuilt");
}

function testFilteredListActionForLifecycleWhenFilterMatchesPreviousValue() {
  const change = { property: "lifecycle", previousValue: "backlog", newValue: "active" };
  const state = { selectedLifecycle: "backlog", filters: { ...FILTER_DEFAULTS } };
  const action = filteredListActionFor(change, state);
  assert.ok(action, "expected an action when the current lifecycle tab equals change.previousValue");
  assert.equal(action.type, "lifecycle");
  assert.equal(action.value, "active");
}

function testFilteredListActionForLifecycleNullWhenFilterDoesNotMatch() {
  const change = { property: "lifecycle", previousValue: "backlog", newValue: "active" };
  const state = { selectedLifecycle: "completed", filters: { ...FILTER_DEFAULTS } };
  assert.equal(filteredListActionFor(change, state), null, "no action expected when the current tab does not match previousValue");
}

function testFilteredListActionForPriorityWhenFilterMatchesPreviousValue() {
  const change = { property: "priority", previousValue: "high", newValue: "low" };
  const state = { selectedLifecycle: "backlog", filters: { ...FILTER_DEFAULTS, priority: "high" } };
  const action = filteredListActionFor(change, state);
  assert.ok(action);
  assert.equal(action.type, "priority");
  assert.equal(action.value, "low");
}

function testFilteredListActionForPriorityNullWhenFilterDoesNotMatch() {
  const change = { property: "priority", previousValue: "high", newValue: "low" };
  const state = { selectedLifecycle: "backlog", filters: { ...FILTER_DEFAULTS, priority: "all" } };
  assert.equal(filteredListActionFor(change, state), null);
}

function testFilteredListActionForUnrelatedPropertyReturnsNull() {
  const change = { property: "unknown", previousValue: "x", newValue: "y" };
  const state = { selectedLifecycle: "backlog", filters: { ...FILTER_DEFAULTS } };
  assert.equal(filteredListActionFor(change, state), null);
}

// Sanity: matchesFilters is re-exported and used by isVisible internally — confirm the import
// itself resolves (would throw at module load if state.js's exports changed shape).
assert.equal(typeof matchesFilters, "function");

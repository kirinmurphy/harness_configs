#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  viewToSearchParams, viewFromSearchParams, activeFilterCountFromView,
} from "../../portal/telemetry/state.js";

// Phase 6 of docs/plans/active/roborepo-telemetry-events-experiments-plan.md: the Telemetry portal's
// global-filter <-> URL serialization (plan: "Filters must serialize into the URL so a filtered
// analysis can be copied, bookmarked, and restored after reload"). state.js's pure helpers have no
// DOM dependency (only the URLSearchParams global, available in Node), so this test drives them
// directly rather than through a browser — the "no Playwright" decision's code-level-review
// alternative for exactly this exit criterion ("URL state round-trips").

testRoundTripAllFields();
testOmitsNullFields();
testRestoresDefaultsFromEmptyParams();
testInvalidNumericFieldsFallBackToNull();
testActiveFilterCountExcludesTimeFields();
console.log("telemetry portal state (URL round-trip) checks passed");

function testRoundTripAllFields() {
  const view = { rangeMs: 604800000, panEnd: 1700000000000, harness: "claude", model: "claude-sonnet-4-6", repo: "roborepo", markerId: "mark_abc123" };
  const params = viewToSearchParams(view);
  const restored = viewFromSearchParams(params);
  assert.deepEqual(restored, view);
}

function testOmitsNullFields() {
  const view = { rangeMs: null, panEnd: null, harness: null, model: null, repo: null, markerId: null };
  const params = viewToSearchParams(view);
  assert.equal(params.toString(), "", "an all-null view must serialize to an empty querystring");
}

function testRestoresDefaultsFromEmptyParams() {
  const restored = viewFromSearchParams(new URLSearchParams(""));
  assert.deepEqual(restored, { rangeMs: null, panEnd: null, harness: null, model: null, repo: null, markerId: null });
}

function testInvalidNumericFieldsFallBackToNull() {
  const restored = viewFromSearchParams(new URLSearchParams("range=not-a-number&end=also-bad"));
  assert.equal(restored.rangeMs, null);
  assert.equal(restored.panEnd, null);
}

function testActiveFilterCountExcludesTimeFields() {
  // rangeMs/panEnd have their own always-visible range buttons — only the Phase 6 additions
  // (harness/model/repo/markerId) count toward the "active filter count" the cohort bar shows.
  const onlyTime = { rangeMs: 604800000, panEnd: null, harness: null, model: null, repo: null, markerId: null };
  assert.equal(activeFilterCountFromView(onlyTime), 0);
  const withModel = { ...onlyTime, model: "claude-sonnet-4-6" };
  assert.equal(activeFilterCountFromView(withModel), 1);
  const withThree = { ...onlyTime, harness: "claude", model: "x", markerId: "mark_1" };
  assert.equal(activeFilterCountFromView(withThree), 3);
}

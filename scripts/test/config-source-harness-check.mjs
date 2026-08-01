#!/usr/bin/env node
import assert from "node:assert/strict";
import { handleConfigApi } from "../cli/portal-routes-config.mjs";
import { loadConfigSource, readConfigSnapshot } from "../cli/config.mjs";

// Phase 7 of discoverable-harness-provider-architecture-plan.md: /api/config/source must reject a
// missing or unrecognized harness id for harness-scoped kinds (live-rules, harness-hooks,
// globals-rules, command, command-skill) instead of silently defaulting to Claude — same fix
// telemetry's /api/session got in Phase 6. Kinds that resolve the harness from `id` itself
// (config-file, skill) must keep working with no harness param at all.

testMissingHarnessRejectedForScopedKind();
testUnknownHarnessRejectedForScopedKind();
testKnownHarnessReachesLoadConfigSource();
testConfigFileKindIgnoresMissingHarness();
testSnapshotHarnessesListMatchesRegistry();
console.log("config source harness checks passed");

function fakeRes() {
  const res = { status: null, body: null };
  res.writeHead = (status) => { res.status = status; };
  res.end = (body) => { res.body = body; };
  return res;
}

function testMissingHarnessRejectedForScopedKind() {
  const result = loadConfigSource({ kind: "live-rules", id: "agent-rules", harness: null });
  assert.equal(result.ok, false);
  assert.match(result.error, /missing or unknown harness/);
}

function testUnknownHarnessRejectedForScopedKind() {
  const result = loadConfigSource({ kind: "harness-hooks", id: "hooks", harness: "timetravel" });
  assert.equal(result.ok, false);
  assert.match(result.error, /missing or unknown harness: timetravel/);
}

function testKnownHarnessReachesLoadConfigSource() {
  const result = loadConfigSource({ kind: "live-rules", id: "agent-rules", harness: "codex" });
  assert.equal(result.ok, true);
}

function testConfigFileKindIgnoresMissingHarness() {
  const res = fakeRes();
  handleConfigApi({}, res, "/api/config/source", "kind=config-file&id=claude-settings", { loadConfigSource });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).ok, true);
}

// Grid/defaults-menu column count must track whatever the registry actually has registered, not a
// hardcoded two — this is the one/two/synthetic-three-provider Config UI check's server-side half.
function testSnapshotHarnessesListMatchesRegistry() {
  const snap = readConfigSnapshot();
  assert.ok(Array.isArray(snap.harnesses));
  assert.ok(snap.harnesses.length >= 2, "expected at least claude+codex registered in this repo");
  for (const harness of snap.harnesses) {
    assert.equal(typeof harness.id, "string");
    assert.equal(typeof harness.displayName, "string");
    assert.equal(typeof harness.rulesFile, "string");
    assert.equal(typeof harness.settingsFile, "string");
    assert.equal(typeof harness.hooksFile, "string");
  }
}

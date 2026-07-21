#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateId, isValidId } from "../cli/telemetry-schemas/id.mjs";
import { generateMarkerId, validateMarker } from "../cli/telemetry-schemas/marker-schema.mjs";
import { computeSnapshotId, validateSnapshot, buildEffectiveSnapshot } from "../cli/telemetry-schemas/snapshot-schema.mjs";
import { generateExperimentId, validateExperiment } from "../cli/telemetry-schemas/experiment-schema.mjs";
import { validateCaptureV3 } from "../cli/telemetry-schemas/capture-schema-v3.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

testIdGenerator();
testMarkerValidation();
testSnapshotContentAddressing();
testExperimentValidation();
testCaptureV3Compat();
testPersistenceRoundTrip();
console.log("telemetry schema checks passed");

function testIdGenerator() {
  const a = generateId("mark");
  const b = generateId("mark");
  assert.notEqual(a, b, "generated ids must be unique");
  assert.ok(isValidId(a, "mark"), "generated id must round-trip through isValidId");
  assert.ok(!isValidId(a, "cfg"), "id must not validate against the wrong prefix");
  assert.throws(() => generateId("Bad Prefix"), /invalid id prefix/);
}

function testMarkerValidation() {
  const base = {
    schema: 1,
    marker_id: generateMarkerId(),
    ts: new Date().toISOString(),
    type: "change",
    title: "Prevent full-suite debugging loops",
  };
  assert.deepEqual(validateMarker(base), base);

  assert.throws(() => validateMarker({ ...base, type: "bogus" }), /unknown marker type/);
  assert.throws(() => validateMarker({ ...base, title: "" }), /marker title is required/);
  assert.throws(() => validateMarker({ ...base, unknown_field: 1 }), /unknown marker field/);

  const outcome = { ...base, marker_id: generateMarkerId(), type: "outcome", status: "successful" };
  assert.deepEqual(validateMarker(outcome), outcome);
  assert.throws(() => validateMarker({ ...base, type: "outcome" }), /requires a valid status/);
  assert.throws(() => validateMarker({ ...base, status: "successful" }), /status is only valid on outcome markers/);

  const phase = { ...base, marker_id: generateMarkerId(), type: "phase", phase: "debugging" };
  assert.deepEqual(validateMarker(phase), phase);
  assert.throws(() => validateMarker({ ...base, type: "phase" }), /requires a non-empty phase/);
}

function testSnapshotContentAddressing() {
  const configSnapshot = {
    packages: [{ id: "test-harness", enabled: true }, { id: "unused-pkg", enabled: false }],
    tools: [{ id: "test-harness", installed: true }],
    globals: { settings: { hooks: { PreToolUse: 2, PostToolUse: 2 } } },
  };
  const snapshotA = buildEffectiveSnapshot(configSnapshot, { harness: "claude", model: "sonnet" });
  const snapshotB = buildEffectiveSnapshot(configSnapshot, { harness: "codex", model: "gpt" });
  assert.equal(snapshotA.snapshot_id, snapshotB.snapshot_id, "identical configuration must hash to the same snapshot id regardless of harness/model");
  assert.ok(snapshotB.unavailable.includes("codex_config_toml_parsed"), "codex snapshots must flag the parsed-config.toml gap");
  assert.ok(!snapshotA.unavailable.includes("codex_config_toml_parsed"), "claude snapshots must not carry the codex-only gap");

  const changedSnapshot = buildEffectiveSnapshot(
    { ...configSnapshot, packages: [{ id: "test-harness", enabled: false }] },
    { harness: "claude" },
  );
  assert.notEqual(snapshotA.snapshot_id, changedSnapshot.snapshot_id, "different enabled-package sets must produce different snapshot ids");

  assert.equal(computeSnapshotId(snapshotA), snapshotA.snapshot_id, "computeSnapshotId must be stable/idempotent on an already-built snapshot");
  assert.throws(() => validateSnapshot({ ...snapshotA, schema: 99 }), /unsupported snapshot schema version/);
}

function testExperimentValidation() {
  const base = {
    schema: 1,
    experiment_id: generateExperimentId(),
    title: "Test-harness guidance v2",
    start_marker_id: generateMarkerId(),
    end_marker_id: null,
    primary_metric: "test.full_suite_calls_per_debug_phase",
    expected_direction: "decrease",
    guardrails: ["outcome.completion_rate"],
    eligibility: { task_categories: ["bug-fix"], minimum_sessions_per_cohort: 10 },
    comparison: "previous-equivalent-window",
  };
  assert.deepEqual(validateExperiment(base), base);
  assert.throws(() => validateExperiment({ ...base, comparison: "vibes" }), /unknown experiment comparison mode/);
  assert.throws(
    () => validateExperiment({ ...base, eligibility: { ...base.eligibility, minimum_sessions_per_cohort: 0 } }),
    /minimum_sessions_per_cohort must be a positive integer/,
  );
}

function testCaptureV3Compat() {
  const v2Record = { schema: 2, ts: new Date().toISOString(), harness: "claude", event: "PostToolUse" };
  assert.deepEqual(validateCaptureV3(v2Record), v2Record, "a plain v2 record must pass through unchanged");

  const v3Record = {
    ...v2Record,
    schema: 3,
    capture_id: generateId("cap"),
    call_id: "toolu_abc123",
    operation: { category: "test", scope: "targeted", exit_status: "pass" },
    phase: { name: "debugging", source: "inferred", confidence: 0.8 },
  };
  assert.deepEqual(validateCaptureV3(v3Record), v3Record);
  assert.throws(
    () => validateCaptureV3({ ...v3Record, operation: { ...v3Record.operation, category: "nonsense" } }),
    /unknown operation category/,
  );
  assert.throws(() => validateCaptureV3({ ...v2Record, schema: 4 }), /unsupported capture schema version/);
}

// Persistence functions import state-paths.mjs, whose stateRoot is a top-level const resolved from
// ROBOREPO_STATE_DIR at import time (see paths.mjs). Sandboxing that requires setting the env var
// on a freshly spawned node process, not inside this already-running one — same pattern as
// package-lifecycle-check.mjs's spawnSync(cli, ..., { env }).
function testPersistenceRoundTrip() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-telemetry-schemas-"));
  try {
    const script = path.join(repoRoot, "scripts/test/telemetry-schemas-persistence-child.mjs");
    const env = { ...process.env, ROBOREPO_STATE_DIR: path.join(tmp, ".roborepo") };
    const result = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
    assert.equal(result.status, 0, `persistence child process failed:\n${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

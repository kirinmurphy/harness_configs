#!/usr/bin/env node
// Runs inside an isolated ROBOREPO_STATE_DIR set by the parent (telemetry-schemas-check.mjs).
// Not a standalone test entry point — do not add this to package.json/test-roborepo.sh directly.
import assert from "node:assert/strict";
import { generateMarkerId } from "../cli/telemetry-schemas/marker-schema.mjs";
import { generateExperimentId, } from "../cli/telemetry-schemas/experiment-schema.mjs";
import { buildEffectiveSnapshot } from "../cli/telemetry-schemas/snapshot-schema.mjs";
import {
  appendMarker, readMarkers, writeSnapshot, readSnapshot, readSnapshots,
  writeExperiment, readExperiment,
} from "../cli/telemetry-schemas/persistence.mjs";

const marker = {
  schema: 1,
  marker_id: generateMarkerId(),
  ts: new Date().toISOString(),
  type: "note",
  title: "phase 1 landed",
};
appendMarker(marker);
const markers = readMarkers();
assert.equal(markers.length, 1);
assert.deepEqual(markers[0], marker);

const snapshot = buildEffectiveSnapshot(
  { packages: [{ id: "test-harness", enabled: true }], tools: [], globals: { settings: { hooks: {} } } },
  { harness: "claude" },
);
writeSnapshot(snapshot);
writeSnapshot(snapshot); // dedup: writing the identical content-addressed snapshot twice must not throw or duplicate
assert.deepEqual(readSnapshot(snapshot.snapshot_id), snapshot);
assert.equal(readSnapshots().length, 1, "identical snapshot writes must dedupe to a single file");

const experiment = {
  schema: 1,
  experiment_id: generateExperimentId(),
  title: "round trip",
  start_marker_id: marker.marker_id,
  end_marker_id: null,
  primary_metric: "test.full_suite_calls_per_debug_phase",
  expected_direction: "decrease",
  guardrails: [],
  eligibility: { task_categories: [], minimum_sessions_per_cohort: 1 },
  comparison: "midpoint",
};
writeExperiment(experiment);
assert.deepEqual(readExperiment(experiment.experiment_id), experiment);

console.log("persistence round trip passed");

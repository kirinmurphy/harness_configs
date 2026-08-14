#!/usr/bin/env node
// Bounds on the three telemetry stores that had none: the markers JSONL, the snapshots directory,
// and the experiments directory.
//
// The fixture writer runs in a child process against a sandboxed ROBOREPO_STATE_ROOT, because
// persistence.mjs resolves its paths from state-paths.mjs at import time — setting the env var
// after import would have no effect. The child lives beside this file rather than inline, so its
// source is ordinary code rather than a string that has to escape its own template syntax.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const child = path.join(here, "telemetry-store-bounds", "write-fixtures.mjs");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-store-bounds-"));
const MB = 1024 * 1024;

try {
  const result = spawnSync(process.execPath, [child], {
    env: { ...process.env, ROBOREPO_STATE_ROOT: tempRoot },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error("fixture writer failed");
  }
  const report = JSON.parse(result.stdout.trim().split("\n").pop());

  // Markers: the cap must actually bite, and the newest record must survive it.
  assert.ok(report.markerBytes <= 5 * MB, `markers stay under the cap (got ${report.markerBytes})`);
  assert.ok(report.markerCount > 0, "trimming never empties the marker log");
  assert.ok(report.markerCount < report.markersWritten, "an oversized marker log is trimmed");
  assert.equal(report.newestMarkerPresent, true, "the most recent marker survives the trim");

  // Snapshots: a directory of files is bounded by total bytes, not by record count.
  assert.ok(report.snapshotFiles > 0, "trimming never empties the snapshot set");
  assert.ok(
    report.snapshotFiles < report.snapshotsWritten,
    `oversized snapshot sets are trimmed (${report.snapshotFiles} of ${report.snapshotsWritten} kept)`,
  );
  assert.ok(report.snapshotBytes <= 5 * MB, "snapshots stay under the cap");

  // Experiments: a running experiment (no end_marker_id) must never be evicted, because its end
  // marker will reference it later. It is written first here, so it is the oldest by mtime and
  // would be the first victim if the running-guard were absent.
  assert.equal(report.runningExperimentPresent, true, "a running experiment survives eviction");
  assert.ok(
    report.experimentFiles < report.experimentsWritten,
    "finished experiments are evicted once the set is oversized",
  );

  console.log("ok: telemetry store bounds (markers, snapshots, experiments)");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

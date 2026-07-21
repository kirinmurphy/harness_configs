import fs from "node:fs";
import path from "node:path";
import {
  telemetryEventsDir, telemetryMarkersPath, telemetrySnapshotsDir, telemetryExperimentsDir,
} from "../state-paths.mjs";
import { validateMarker } from "./marker-schema.mjs";
import { validateSnapshot } from "./snapshot-schema.mjs";
import { validateExperiment } from "./experiment-schema.mjs";

// Markers are append-only JSONL, same shape as the capture spools. Corrections append a
// superseding marker (marker.supersedes) rather than editing history in place.
export function appendMarker(marker) {
  validateMarker(marker);
  fs.mkdirSync(telemetryEventsDir, { recursive: true });
  fs.appendFileSync(telemetryMarkersPath, JSON.stringify(marker) + "\n");
  return marker;
}

export function readMarkers() {
  return readJsonl(telemetryMarkersPath);
}

// Snapshots are content-addressed (see snapshot-schema.mjs computeSnapshotId), one file per
// snapshot_id, deduplicated by checking existence before writing.
export function writeSnapshot(snapshot) {
  validateSnapshot(snapshot);
  fs.mkdirSync(telemetrySnapshotsDir, { recursive: true });
  const dest = path.join(telemetrySnapshotsDir, `${snapshot.snapshot_id}.json`);
  if (fs.existsSync(dest)) return snapshot;
  fs.writeFileSync(dest, JSON.stringify(snapshot, null, 2) + "\n");
  return snapshot;
}

export function readSnapshot(snapshotId) {
  const file = path.join(telemetrySnapshotsDir, `${snapshotId}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function readSnapshots() {
  let files = [];
  try {
    files = fs.readdirSync(telemetrySnapshotsDir).filter((file) => file.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .map((file) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(telemetrySnapshotsDir, file), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Experiments are one file per experiment_id, mutable in place (status/end_marker_id update as
// the experiment progresses) — unlike markers/snapshots, an experiment definition is a live
// record, not an immutable event.
export function writeExperiment(experiment) {
  validateExperiment(experiment);
  fs.mkdirSync(telemetryExperimentsDir, { recursive: true });
  const dest = path.join(telemetryExperimentsDir, `${experiment.experiment_id}.json`);
  fs.writeFileSync(dest, JSON.stringify(experiment, null, 2) + "\n");
  return experiment;
}

export function readExperiment(experimentId) {
  const file = path.join(telemetryExperimentsDir, `${experimentId}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function readExperiments() {
  let files = [];
  try {
    files = fs.readdirSync(telemetryExperimentsDir).filter((file) => file.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .map((file) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(telemetryExperimentsDir, file), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readJsonl(filePath) {
  let lines;
  try {
    lines = fs.readFileSync(filePath, "utf8").split("\n");
  } catch {
    return [];
  }
  const records = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Ignore partial/corrupt lines, matching readSpoolEvents' tolerance in telemetry.mjs.
    }
  }
  return records;
}

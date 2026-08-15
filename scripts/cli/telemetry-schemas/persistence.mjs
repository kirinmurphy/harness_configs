import fs from "node:fs";
import path from "node:path";
import {
  telemetryEventsDir, telemetryMarkersPath, telemetrySnapshotsDir, telemetryExperimentsDir,
} from "../state-paths.mjs";
import { measureFileSet, measureLog } from "../../../modules/retention/index.mjs";
import { validateMarker } from "./marker-schema.mjs";
import { validateSnapshot } from "./snapshot-schema.mjs";
import { validateExperiment } from "./experiment-schema.mjs";

// Runaway guards, deliberately untuned. These three stores are measured in kilobytes on a real
// install — markers are user-authored, snapshots are content-addressed and deduplicated — so the
// caps exist to stop pathological growth, not to manage a steady state. A tuned value derived from
// a handful of files would be false precision. Bounds are declared identically in
// modules/retention/registry.mjs, which the reporting surfaces read.
const MARKERS_MAX_BYTES = 5 * 1024 * 1024;
const SNAPSHOTS_MAX_BYTES = 5 * 1024 * 1024;
const EXPERIMENTS_MAX_BYTES = 5 * 1024 * 1024;

// Markers are append-only JSONL, same shape as the capture spools. Corrections append a
// superseding marker (marker.supersedes) rather than editing history in place.
//
// Trimming rewrites in place. Unlike localhoster history, nothing holds a cursor into this file and
// nothing reads it incrementally — readMarkers() reads it whole every time — so the simpler write
// is safe here.
export function appendMarker(marker) {
  validateMarker(marker);
  fs.mkdirSync(telemetryEventsDir, { recursive: true });
  fs.appendFileSync(telemetryMarkersPath, JSON.stringify(marker) + "\n");
  capMarkers();
  return marker;
}

// keepFraction is what makes this cheap. Dropping only enough to reach the cap would re-trip it on
// the very next append, rewriting the whole file every time; overshooting to ~70% means a trim
// happens once per several thousand appends instead. Same reasoning as SPOOL_KEEP_FRACTION.
function capMarkers() {
  const verdict = measureLog({
    filePath: telemetryMarkersPath,
    policy: { maxAgeDays: null, maxBytes: MARKERS_MAX_BYTES, floorBytes: 0, keepFraction: 0.7 },
  });
  if (!verdict.act) return;
  try {
    const lines = fs.readFileSync(telemetryMarkersPath, "utf8").split("\n").filter((l) => l.trim());
    const keep = lines.slice(Math.min(verdict.dropCount, lines.length - 1));
    fs.writeFileSync(telemetryMarkersPath, keep.join("\n") + "\n");
  } catch {
    // Best-effort. A marker that cannot be trimmed is far less bad than a marker that fails to record.
  }
}

// Remove the oldest files until a directory is back under its cap. Shared by snapshots and
// experiments, which differ only in their directory and bound.
//
// Never throws: these run on the write path, and a store that cannot be trimmed must still accept
// the record that triggered the trim.
function capFileSet(dirPath, maxBytes, isEvictable = null) {
  // keepFraction for the same reason as capMarkers: trimming to exactly the cap would re-walk and
  // re-stat the whole directory on every subsequent write.
  const verdict = measureFileSet({
    dirPath,
    policy: { maxAgeDays: null, maxBytes, keepFraction: 0.7 },
  });
  if (!verdict.act) return;
  for (const filePath of verdict.files) {
    if (isEvictable && !isEvictable(filePath)) continue;
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Skip this file; the next write re-measures and tries again.
    }
  }
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
  capFileSet(telemetrySnapshotsDir, SNAPSHOTS_MAX_BYTES);
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
  // A running experiment (no end_marker_id) is never evictable: its end marker will reference this
  // file later, and deleting it would strand that marker. Only finished experiments can age out.
  capFileSet(telemetryExperimentsDir, EXPERIMENTS_MAX_BYTES, isFinishedExperiment);
  return experiment;
}

function isFinishedExperiment(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")).end_marker_id != null;
  } catch {
    // Unreadable or corrupt: treat as evictable. It cannot be completing an experiment either way.
    return true;
  }
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

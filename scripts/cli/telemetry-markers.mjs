import { spawnSync } from "node:child_process";
import { readConfigSnapshot } from "./config.mjs";
import { readPackageVersion } from "./workspace.mjs";
import { generateMarkerId, MARKER_TYPES, OUTCOME_STATUSES, EXPECTED_DIRECTIONS, TASK_CATEGORIES } from "./telemetry-schemas/marker-schema.mjs";
import { buildEffectiveSnapshot } from "./telemetry-schemas/snapshot-schema.mjs";
import { generateExperimentId, COMPARISON_MODES } from "./telemetry-schemas/experiment-schema.mjs";
import { inferTaskScale } from "./telemetry-task-infer.mjs";
import {
  appendMarker, readMarkers, writeSnapshot, writeExperiment, readExperiment, readExperiments,
} from "./telemetry-schemas/persistence.mjs";

// Shared marker/experiment domain functions, used by both the CLI (telemetry.mjs) and — in later
// phases — the portal's marker/experiment endpoints. Keeps repo/branch/sha resolution, snapshot
// creation, and validation in one place so CLI and portal never disagree on what a marker looks like.

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() : "";
}

// Best-effort: a marker created outside a git repo (or with git unavailable) still gets created,
// just with repo/branch/sha left null rather than the command failing.
function resolveGitIdentity(cwd) {
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const sha = git(cwd, ["rev-parse", "--short", "HEAD"]);
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  return {
    repo: root ? root.split("/").pop() : null,
    branch: branch || null,
    sha: sha || null,
  };
}

// Best-effort effective-configuration snapshot for the current machine, deduplicated by content
// hash. Markers created from a CLI invocation have no live harness/model context (unlike a
// SessionStart hook), so harness/model are left null here.
function resolveConfigSnapshotId() {
  try {
    const configSnapshot = readConfigSnapshot();
    const snapshot = buildEffectiveSnapshot(configSnapshot, { roborepoVersion: readPackageVersion() });
    writeSnapshot(snapshot);
    return snapshot.snapshot_id;
  } catch {
    return null;
  }
}

// Builds, validates, and persists a marker from CLI-supplied fields. Machine-derived identity
// (repo/branch/sha/timestamp/snapshot) is always resolved here, never accepted from the caller —
// per the plan's "automatic metadata is correct" exit criterion.
export function createMarker(fields, { cwd = process.cwd() } = {}) {
  const identity = resolveGitIdentity(cwd);
  const marker = {
    schema: 1,
    marker_id: generateMarkerId(),
    ts: new Date().toISOString(),
    type: fields.type,
    title: fields.title,
    description: fields.description ?? null,
    repo: identity.repo,
    branch: identity.branch,
    sha: identity.sha,
    config_snapshot_id: resolveConfigSnapshotId(),
    packages: fields.packages ?? [],
    skills: fields.skills ?? [],
    tags: fields.tags ?? [],
    metric: fields.metric ?? null,
    expected_direction: fields.expected_direction ?? null,
    supersedes: fields.supersedes ?? null,
    session_id: fields.session_id ?? null,
    phase: fields.phase ?? null,
    status: fields.status ?? null,
    ...taskFields(fields),
  };
  return appendMarker(marker);
}

// Task category/scale are explicit-only when set through the CLI (see telemetry.mjs's
// --task-category and friends) — task_category_source is always "explicit" here.
// telemetry-task-infer.mjs's inferTaskCategory() is for future analysis-time (Phase 5+) inference
// over accumulated session signals, not something this marker-creation path calls itself.
function taskFields(fields) {
  if (fields.task_category == null) return {};
  const hasScaleInput = fields.files_touched != null || fields.directories_touched != null
    || fields.insertions != null || fields.deletions != null;
  return {
    task_category: fields.task_category,
    task_category_source: "explicit",
    task_scale: hasScaleInput
      ? inferTaskScale({
          filesTouched: fields.files_touched ?? 0,
          directoriesTouched: fields.directories_touched ?? 0,
          insertions: fields.insertions ?? null,
          deletions: fields.deletions ?? null,
          changedFileCategories: [],
        })
      : null,
  };
}

export function listMarkers() {
  return readMarkers();
}

export { MARKER_TYPES, OUTCOME_STATUSES, EXPECTED_DIRECTIONS, COMPARISON_MODES, TASK_CATEGORIES };

// Creates an experiment definition plus its start marker in one step, per the plan's CLI design
// ("start creates both the experiment definition and its marker").
export function startExperiment(fields, { cwd = process.cwd() } = {}) {
  const startMarker = createMarker({
    type: "experiment-start",
    title: fields.title,
    metric: fields.metric,
    expected_direction: fields.expected_direction,
    tags: fields.tags,
  }, { cwd });

  const experiment = {
    schema: 1,
    experiment_id: generateExperimentId(),
    title: fields.title,
    start_marker_id: startMarker.marker_id,
    end_marker_id: null,
    primary_metric: fields.metric,
    expected_direction: fields.expected_direction,
    guardrails: fields.guardrails ?? [],
    eligibility: {
      task_categories: fields.task_categories ?? [],
      minimum_sessions_per_cohort: fields.minimum_sessions_per_cohort ?? 10,
    },
    comparison: fields.comparison ?? "previous-equivalent-window",
  };
  writeExperiment(experiment);
  return { experiment, startMarker };
}

export function endExperiment(experimentId, { cwd = process.cwd() } = {}) {
  const experiment = readExperiment(experimentId);
  if (!experiment) throw new Error(`unknown experiment: ${experimentId}`);
  if (experiment.end_marker_id) throw new Error(`experiment already ended: ${experimentId}`);

  const endMarker = createMarker({
    type: "experiment-end",
    title: `${experiment.title} (end)`,
    metric: experiment.primary_metric,
    expected_direction: experiment.expected_direction,
  }, { cwd });

  experiment.end_marker_id = endMarker.marker_id;
  writeExperiment(experiment);
  return { experiment, endMarker };
}

// Cohort sizing/readiness is Phase 5 work (metrics registry + cohort filtering do not exist yet).
// For now, status reports what is knowable from the experiment record and marker timeline alone:
// lifecycle state, definition, and elapsed time — not sample counts or a provisional winner.
export function experimentStatus(experimentId) {
  const experiments = experimentId ? [readExperiment(experimentId)].filter(Boolean) : readExperiments();
  if (experimentId && experiments.length === 0) throw new Error(`unknown experiment: ${experimentId}`);
  const markersById = new Map(readMarkers().map((m) => [m.marker_id, m]));

  return experiments.map((experiment) => {
    const startMarker = markersById.get(experiment.start_marker_id) ?? null;
    const endMarker = experiment.end_marker_id ? markersById.get(experiment.end_marker_id) ?? null : null;
    return {
      experiment_id: experiment.experiment_id,
      title: experiment.title,
      state: endMarker ? "ended" : "running",
      primary_metric: experiment.primary_metric,
      expected_direction: experiment.expected_direction,
      guardrails: experiment.guardrails,
      eligibility: experiment.eligibility,
      comparison: experiment.comparison,
      started_at: startMarker?.ts ?? null,
      ended_at: endMarker?.ts ?? null,
      ready: false,
      data_quality_warnings: ["cohort sizing not yet implemented (Phase 5)"],
    };
  });
}

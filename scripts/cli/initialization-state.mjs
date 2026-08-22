// Machine-local record of whether this RoboRepo installation has completed its first-run
// workflow. Read/write and the resumability policy live here; the resolved path lives in
// state-paths.mjs alongside every other piece of roborepo state.
//
// Why this exists as its own file rather than being inferred: `setup` is an internal primitive
// that can create workspace/state directories without the user ever seeing `roborepo init`, so
// "the workspace dir exists" is not evidence that initialization happened. Package mode makes
// that worse — npm can place the application on a machine that has never run anything at all.
// An explicit record is the only signal that distinguishes never-started from interrupted from
// finished, and interrupted is the state that has to survive a Ctrl-C.

import { readJsonState, writeJsonState, initializationStatePath } from "./state-paths.mjs";

const STATUSES = new Set(["in-progress", "complete"]);

// Bumped when the *record's* shape changes. workflowVersion below is independent: it tracks the
// initialization workflow's own content, so a future release that adds a required first-run step
// can recognize an installation completed under an older workflow without a schema migration.
const SCHEMA_VERSION = 1;
export const WORKFLOW_VERSION = 1;

/**
 * @typedef {object} InitializationState
 * @property {1} schemaVersion
 * @property {number} workflowVersion Which initialization workflow produced this record
 * @property {"in-progress"|"complete"} status
 * @property {string} startedAt ISO 8601 timestamp
 * @property {string|null} completedAt ISO 8601 timestamp, null until status is "complete"
 */

export function validateInitializationState(state) {
  const errors = [];

  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw new Error("initialization state must be an object");
  }
  if (state.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`initialization state schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (!Number.isInteger(state.workflowVersion) || state.workflowVersion < 1) {
    errors.push("initialization state workflowVersion must be a positive integer");
  }
  if (!STATUSES.has(state.status)) {
    errors.push(`initialization state status must be one of ${[...STATUSES].join(", ")}`);
  }
  if (typeof state.startedAt !== "string" || Number.isNaN(Date.parse(state.startedAt))) {
    errors.push("initialization state startedAt must be an ISO 8601 timestamp string");
  }
  if (state.completedAt !== null && (typeof state.completedAt !== "string" || Number.isNaN(Date.parse(state.completedAt)))) {
    errors.push("initialization state completedAt must be null or an ISO 8601 timestamp string");
  }
  if (state.status === "complete" && state.completedAt === null) {
    errors.push("initialization state completedAt is required when status is complete");
  }

  if (errors.length > 0) throw new Error(`invalid initialization state:\n  ${errors.join("\n  ")}`);
}

// True when the record on disk was written by a build that understands a newer schema than this
// one. Deliberately separate from "corrupt": a newer record is well-formed and meaningful, this
// build just cannot interpret all of it. Treating the two the same let an older CLI overwrite a
// newer installation's state and silently replay the whole first-run workflow (a downgrade, e.g.
// `npm install -g codethings-roborepo-alpha@older` on a machine already initialized by a newer
// release). Reads still degrade to "not initialized"; only writes are refused.
export function isFutureInitializationState(state) {
  return Number.isInteger(state?.schemaVersion) && state.schemaVersion > SCHEMA_VERSION;
}

function readRawInitializationState() {
  return readJsonState(initializationStatePath, null);
}

// The on-disk record when it is newer than this build understands, otherwise null. Callers use it
// to report the downgrade before doing any work, rather than letting writeInitializationState
// throw partway through a workflow that has already mutated other state.
export function readFutureInitializationState() {
  const state = readRawInitializationState();
  return isFutureInitializationState(state) ? state : null;
}

// Returns null when initialization has never started. A corrupt or unreadable record is treated
// as never-started rather than fatal: the recovery for both is the same (run init), and a broken
// state file must not be able to lock a user out of their own first run. A newer-schema record
// also reads as null — this build genuinely cannot vouch for it — but writeInitializationState
// refuses to clobber it, so "cannot read" never silently becomes "destroyed".
export function readInitializationState() {
  const state = readRawInitializationState();
  if (state === null) return null;
  try {
    validateInitializationState(state);
  } catch {
    return null;
  }
  return state;
}

export function writeInitializationState(state) {
  validateInitializationState(state);
  const existing = readRawInitializationState();
  if (isFutureInitializationState(existing)) {
    throw new Error(
      `refusing to overwrite initialization state written by a newer RoboRepo `
      + `(schemaVersion ${existing.schemaVersion}; this build understands ${SCHEMA_VERSION}).\n`
      + `  ${initializationStatePath}\n`
      + `Upgrade RoboRepo again, or remove that file to re-initialize from scratch.`,
    );
  }
  writeJsonState(initializationStatePath, state);
  return state;
}

// Called at the top of `init`. Re-entering an interrupted initialization preserves the original
// startedAt so the record still reports when the user first tried, not when they last retried.
export function beginInitialization({ now = () => new Date().toISOString() } = {}) {
  const previous = readInitializationState();
  return writeInitializationState({
    schemaVersion: SCHEMA_VERSION,
    workflowVersion: WORKFLOW_VERSION,
    status: "in-progress",
    startedAt: previous?.startedAt ?? now(),
    completedAt: null,
  });
}

// Only called after every required initialization step succeeded. Anything that throws or exits
// before this leaves the record "in-progress", which is what makes an interrupted run resumable.
export function completeInitialization({ now = () => new Date().toISOString() } = {}) {
  const previous = readInitializationState();
  const timestamp = now();
  return writeInitializationState({
    schemaVersion: SCHEMA_VERSION,
    workflowVersion: WORKFLOW_VERSION,
    status: "complete",
    startedAt: previous?.startedAt ?? timestamp,
    completedAt: timestamp,
  });
}

export function isInitializationComplete(state = readInitializationState()) {
  return state?.status === "complete";
}

/**
 * The three-way first-run phase, derived from the record so callers never re-implement the
 * missing/in-progress/complete distinction.
 * @returns {"missing"|"in-progress"|"complete"}
 */
export function initializationPhase(state = readInitializationState()) {
  if (state === null) return "missing";
  return state.status === "complete" ? "complete" : "in-progress";
}

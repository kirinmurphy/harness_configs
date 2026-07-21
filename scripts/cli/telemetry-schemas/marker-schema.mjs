import { generateId, isValidId } from "./id.mjs";
import { validateObjectKeys, validateStringArray } from "./validators.mjs";

export const MARKER_SCHEMA_VERSION = 1;

export const MARKER_TYPES = new Set(["change", "phase", "outcome", "experiment-start", "experiment-end", "note"]);
export const OUTCOME_STATUSES = new Set(["successful", "partial", "failed", "abandoned", "unknown"]);
export const EXPECTED_DIRECTIONS = new Set(["increase", "decrease", "no-change"]);

const ALLOWED_FIELDS = [
  "schema", "marker_id", "ts", "type", "title", "description", "repo", "branch", "sha",
  "config_snapshot_id", "packages", "skills", "tags", "metric", "expected_direction",
  "supersedes", "session_id", "phase", "status",
];

export function generateMarkerId() {
  return generateId("mark");
}

// Throws with a descriptive message on the first structural problem found. Callers that need to
// report every problem at once (e.g. a CLI batch import) should catch per-record.
export function validateMarker(marker) {
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) throw new Error("marker must be an object");
  validateObjectKeys(marker, ALLOWED_FIELDS, "marker");
  if (marker.schema !== MARKER_SCHEMA_VERSION) throw new Error(`unsupported marker schema version: ${marker.schema}`);
  if (!isValidId(marker.marker_id, "mark")) throw new Error(`invalid marker_id: ${marker.marker_id}`);
  if (typeof marker.ts !== "string" || Number.isNaN(Date.parse(marker.ts))) throw new Error("marker ts must be an ISO timestamp");
  if (!MARKER_TYPES.has(marker.type)) throw new Error(`unknown marker type: ${marker.type}`);
  if (typeof marker.title !== "string" || !marker.title.trim()) throw new Error("marker title is required");
  if (marker.description != null && typeof marker.description !== "string") throw new Error("marker description must be a string");
  if (marker.repo != null && typeof marker.repo !== "string") throw new Error("marker repo must be a string");
  if (marker.branch != null && typeof marker.branch !== "string") throw new Error("marker branch must be a string");
  if (marker.sha != null && typeof marker.sha !== "string") throw new Error("marker sha must be a string");
  // Snapshot IDs are content-addressed hashes (see snapshot-schema.mjs computeSnapshotId), not
  // generic generateId() ids — 24 hex chars, not 16 — so they need their own format check.
  if (marker.config_snapshot_id != null && !/^cfg_[a-f0-9]{24}$/.test(marker.config_snapshot_id)) {
    throw new Error(`invalid marker config_snapshot_id: ${marker.config_snapshot_id}`);
  }
  validateStringArray(marker.packages, "marker packages");
  validateStringArray(marker.skills, "marker skills");
  validateStringArray(marker.tags, "marker tags");
  if (marker.metric != null && typeof marker.metric !== "string") throw new Error("marker metric must be a string");
  if (marker.expected_direction != null && !EXPECTED_DIRECTIONS.has(marker.expected_direction)) {
    throw new Error(`unknown marker expected_direction: ${marker.expected_direction}`);
  }
  if (marker.supersedes != null && !isValidId(marker.supersedes, "mark")) {
    throw new Error(`invalid marker supersedes id: ${marker.supersedes}`);
  }
  if (marker.session_id != null && typeof marker.session_id !== "string") throw new Error("marker session_id must be a string");
  if (marker.type === "outcome") {
    if (!OUTCOME_STATUSES.has(marker.status)) throw new Error(`outcome marker requires a valid status, got: ${marker.status}`);
  } else if (marker.status != null) {
    throw new Error("marker status is only valid on outcome markers");
  }
  if (marker.type === "phase") {
    if (typeof marker.phase !== "string" || !marker.phase.trim()) throw new Error("phase marker requires a non-empty phase");
  } else if (marker.phase != null) {
    throw new Error("marker phase is only valid on phase markers");
  }
  return marker;
}

import { generateId, isValidId } from "./id.mjs";
import { validateObjectKeys } from "./validators.mjs";

export const CAPTURE_SCHEMA_V2 = 2;
export const CAPTURE_SCHEMA_V3 = 3;

export const OPERATION_CATEGORIES = new Set([
  "test", "lint", "typecheck", "build", "format", "install", "git", "serve",
  "file-read", "file-write", "search", "mcp", "other",
]);
export const OPERATION_SCOPES = new Set(["targeted", "affected", "full", "unknown"]);
export const OPERATION_EXIT_STATUSES = new Set(["pass", "fail", "blocked", "unknown"]);
export const PHASE_NAMES = new Set(["discovery", "implementation", "debugging", "verification", "finalization", "unknown"]);
export const PHASE_SOURCES = new Set(["explicit", "inferred"]);

const V3_ONLY_FIELDS = ["capture_id", "call_id", "config_snapshot_id", "operation", "phase"];

export function generateCaptureId() {
  return generateId("cap");
}

// v2 records pass through unvalidated by this module (telemetry-capture.mjs already governs their
// shape) — this function's job is only to validate the v3-additive fields when present, and to
// leave a record with schema 2 (or no v3 fields at all) alone. Schema-v2 read compatibility is a
// hard requirement from the plan doc; this validator must never reject a plain v2 record.
export function validateCaptureV3(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("capture record must be an object");
  if (record.schema !== CAPTURE_SCHEMA_V2 && record.schema !== CAPTURE_SCHEMA_V3) {
    throw new Error(`unsupported capture schema version: ${record.schema}`);
  }
  if (record.schema === CAPTURE_SCHEMA_V2) return record;

  if (record.capture_id != null && !isValidId(record.capture_id, "cap")) throw new Error(`invalid capture_id: ${record.capture_id}`);
  if (record.call_id != null && typeof record.call_id !== "string") throw new Error("capture call_id must be a string");
  if (record.config_snapshot_id != null && !isValidId(record.config_snapshot_id, "cfg")) {
    throw new Error(`invalid capture config_snapshot_id: ${record.config_snapshot_id}`);
  }
  if (record.operation != null) validateOperation(record.operation);
  if (record.phase != null) validatePhase(record.phase);
  return record;
}

function validateOperation(operation) {
  if (typeof operation !== "object" || Array.isArray(operation)) throw new Error("capture operation must be an object");
  validateObjectKeys(operation, ["category", "runner", "scope", "target", "signature", "failure_signature", "exit_status"], "capture operation");
  if (!OPERATION_CATEGORIES.has(operation.category)) throw new Error(`unknown operation category: ${operation.category}`);
  if (operation.runner != null && typeof operation.runner !== "string") throw new Error("operation runner must be a string");
  if (operation.scope != null && !OPERATION_SCOPES.has(operation.scope)) throw new Error(`unknown operation scope: ${operation.scope}`);
  if (operation.target != null && typeof operation.target !== "string") throw new Error("operation target must be a string");
  if (operation.signature != null && typeof operation.signature !== "string") throw new Error("operation signature must be a string");
  if (operation.failure_signature != null && typeof operation.failure_signature !== "string") throw new Error("operation failure_signature must be a string");
  if (operation.exit_status != null && !OPERATION_EXIT_STATUSES.has(operation.exit_status)) {
    throw new Error(`unknown operation exit_status: ${operation.exit_status}`);
  }
}

function validatePhase(phase) {
  if (typeof phase !== "object" || Array.isArray(phase)) throw new Error("capture phase must be an object");
  validateObjectKeys(phase, ["name", "source", "confidence"], "capture phase");
  if (!PHASE_NAMES.has(phase.name)) throw new Error(`unknown phase name: ${phase.name}`);
  if (!PHASE_SOURCES.has(phase.source)) throw new Error(`unknown phase source: ${phase.source}`);
  if (typeof phase.confidence !== "number" || phase.confidence < 0 || phase.confidence > 1) {
    throw new Error("phase confidence must be a number between 0 and 1");
  }
}

export const V3_ADDITIVE_FIELDS = V3_ONLY_FIELDS;

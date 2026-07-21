import { generateId, isValidId } from "./id.mjs";
import { EXPECTED_DIRECTIONS } from "./marker-schema.mjs";
import { validateObjectKeys, validateStringArray } from "./validators.mjs";

export const EXPERIMENT_SCHEMA_VERSION = 1;

export const COMPARISON_MODES = new Set(["previous-equivalent-window", "midpoint"]);

const ALLOWED_FIELDS = [
  "schema", "experiment_id", "title", "start_marker_id", "end_marker_id", "primary_metric",
  "expected_direction", "guardrails", "eligibility", "comparison",
];

const ALLOWED_ELIGIBILITY_FIELDS = ["task_categories", "minimum_sessions_per_cohort"];

export function generateExperimentId() {
  return generateId("exp");
}

export function validateExperiment(experiment) {
  if (!experiment || typeof experiment !== "object" || Array.isArray(experiment)) throw new Error("experiment must be an object");
  validateObjectKeys(experiment, ALLOWED_FIELDS, "experiment");
  if (experiment.schema !== EXPERIMENT_SCHEMA_VERSION) throw new Error(`unsupported experiment schema version: ${experiment.schema}`);
  if (!isValidId(experiment.experiment_id, "exp")) throw new Error(`invalid experiment_id: ${experiment.experiment_id}`);
  if (typeof experiment.title !== "string" || !experiment.title.trim()) throw new Error("experiment title is required");
  if (!isValidId(experiment.start_marker_id, "mark")) throw new Error(`invalid experiment start_marker_id: ${experiment.start_marker_id}`);
  if (experiment.end_marker_id != null && !isValidId(experiment.end_marker_id, "mark")) {
    throw new Error(`invalid experiment end_marker_id: ${experiment.end_marker_id}`);
  }
  if (typeof experiment.primary_metric !== "string" || !experiment.primary_metric.trim()) throw new Error("experiment primary_metric is required");
  if (!EXPECTED_DIRECTIONS.has(experiment.expected_direction)) {
    throw new Error(`unknown experiment expected_direction: ${experiment.expected_direction}`);
  }
  validateStringArray(experiment.guardrails, "experiment guardrails");
  validateEligibility(experiment.eligibility);
  if (!COMPARISON_MODES.has(experiment.comparison)) throw new Error(`unknown experiment comparison mode: ${experiment.comparison}`);
  return experiment;
}

function validateEligibility(eligibility) {
  if (!eligibility || typeof eligibility !== "object" || Array.isArray(eligibility)) throw new Error("experiment eligibility must be an object");
  validateObjectKeys(eligibility, ALLOWED_ELIGIBILITY_FIELDS, "experiment eligibility");
  validateStringArray(eligibility.task_categories, "experiment eligibility task_categories");
  if (!Number.isInteger(eligibility.minimum_sessions_per_cohort) || eligibility.minimum_sessions_per_cohort < 1) {
    throw new Error("experiment eligibility minimum_sessions_per_cohort must be a positive integer");
  }
}

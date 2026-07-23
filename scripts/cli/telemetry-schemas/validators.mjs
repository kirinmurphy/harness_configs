// Shared field-level validators for the telemetry domain schemas (marker/snapshot/experiment/
// capture-v3), following the strict-allowlist + throw-based style in
// modules/localhoster/settings-schema.mjs.
export function validateObjectKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`unknown ${label} field: ${key}`);
  }
}

export function validateStringArray(value, label) {
  if (value == null) return;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
}

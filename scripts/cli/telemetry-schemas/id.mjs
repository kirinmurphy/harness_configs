import { randomBytes } from "node:crypto";

// Stable, sortable-ish IDs for telemetry domain records (markers, snapshots, experiments,
// v3 captures). Not cryptographically significant — just unique and prefix-typed so records
// are recognizable at a glance in JSONL/JSON files.
export function generateId(prefix) {
  if (typeof prefix !== "string" || !/^[a-z][a-z0-9]{0,15}$/.test(prefix)) {
    throw new Error(`invalid id prefix: ${prefix}`);
  }
  const suffix = randomBytes(8).toString("hex");
  return `${prefix}_${suffix}`;
}

export function isValidId(value, prefix) {
  return typeof value === "string" && new RegExp(`^${prefix}_[a-f0-9]{16}$`).test(value);
}

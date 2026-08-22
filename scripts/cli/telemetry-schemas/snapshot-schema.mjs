import { privacyHash } from "./hash.mjs";
import { validateObjectKeys, validateStringArray } from "./validators.mjs";
import { hasHarnessProvider } from "../../harnesses/registry.mjs";

export const SNAPSHOT_SCHEMA_VERSION = 1;

const ALLOWED_FIELDS = [
  "schema", "snapshot_id", "created_at", "roborepo_version", "harness", "harness_version",
  "model", "packages", "rules", "skills", "hooks", "commands", "feature_flags", "unavailable",
];

// Content-addressed: the ID is a hash of the normalized fields, so two sessions with identical
// effective configuration collapse to one stored snapshot. `created_at` and `harness`/`model`
// (session-specific, not configuration-specific) are excluded from the hash on purpose.
export function computeSnapshotId(snapshot) {
  const material = JSON.stringify({
    roborepo_version: snapshot.roborepo_version ?? null,
    packages: [...(snapshot.packages || [])].sort(),
    rules: [...(snapshot.rules || [])].sort(),
    skills: [...(snapshot.skills || [])].sort(),
    hooks: snapshot.hooks || {},
    commands: snapshot.commands || {},
    feature_flags: snapshot.feature_flags || {},
  });
  return `cfg_${privacyHash(material)}`;
}

export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("snapshot must be an object");
  validateObjectKeys(snapshot, ALLOWED_FIELDS, "snapshot");
  if (snapshot.schema !== SNAPSHOT_SCHEMA_VERSION) throw new Error(`unsupported snapshot schema version: ${snapshot.schema}`);
  if (typeof snapshot.snapshot_id !== "string" || !/^cfg_[a-f0-9]{24}$/.test(snapshot.snapshot_id)) {
    throw new Error(`invalid snapshot_id: ${snapshot.snapshot_id}`);
  }
  if (typeof snapshot.created_at !== "string" || Number.isNaN(Date.parse(snapshot.created_at))) {
    throw new Error("snapshot created_at must be an ISO timestamp");
  }
  if (snapshot.roborepo_version != null && typeof snapshot.roborepo_version !== "string") throw new Error("snapshot roborepo_version must be a string");
  if (snapshot.harness != null && snapshot.harness !== "unknown" && !hasHarnessProvider(snapshot.harness)) throw new Error(`unknown snapshot harness: ${snapshot.harness}`);
  if (snapshot.harness_version != null && typeof snapshot.harness_version !== "string") throw new Error("snapshot harness_version must be a string");
  if (snapshot.model != null && typeof snapshot.model !== "string") throw new Error("snapshot model must be a string");
  validateStringArray(snapshot.packages, "snapshot packages");
  validateStringArray(snapshot.rules, "snapshot rules");
  validateStringArray(snapshot.skills, "snapshot skills");
  if (snapshot.hooks != null && (typeof snapshot.hooks !== "object" || Array.isArray(snapshot.hooks))) {
    throw new Error("snapshot hooks must be an object");
  }
  if (snapshot.commands != null && (typeof snapshot.commands !== "object" || Array.isArray(snapshot.commands))) {
    throw new Error("snapshot commands must be an object");
  }
  if (snapshot.feature_flags != null && (typeof snapshot.feature_flags !== "object" || Array.isArray(snapshot.feature_flags))) {
    throw new Error("snapshot feature_flags must be an object");
  }
  validateStringArray(snapshot.unavailable, "snapshot unavailable");
  return snapshot;
}

// Builds a snapshot from readConfigSnapshot()'s output plus session-supplied harness/model. Known
// gaps in readConfigSnapshot (full hook command strings, MCP server registration detail, parsed
// Codex config.toml) are recorded in `unavailable` rather than guessed — see Phase 0 notes in the
// plan doc for why these are gaps today.
export function buildEffectiveSnapshot(configSnapshot, { harness = null, harnessVersion = null, model = null, roborepoVersion = null } = {}) {
  const enabledPackageIds = (configSnapshot.packages || []).filter((pkg) => pkg.enabled).map((pkg) => pkg.id);
  const installedSkillIds = (configSnapshot.tools || []).filter((tool) => tool.installed).map((tool) => tool.id);
  const hookCounts = { ...(configSnapshot.globals?.settings?.hooks || {}) };

  const unavailable = ["hook_command_strings", "mcp_server_registration"];
  if (harness === "codex") unavailable.push("codex_config_toml_parsed");

  const snapshot = {
    schema: SNAPSHOT_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    roborepo_version: roborepoVersion,
    harness,
    harness_version: harnessVersion,
    model,
    packages: enabledPackageIds,
    rules: [],
    skills: installedSkillIds,
    hooks: hookCounts,
    commands: {},
    feature_flags: {},
    unavailable,
  };
  snapshot.snapshot_id = computeSnapshotId(snapshot);
  return validateSnapshot(snapshot);
}

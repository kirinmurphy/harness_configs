// Versioned schema + strict validators for the canonical repository registry. Mirrors the
// localhoster settings-schema convention exactly: a *_VERSION const, allow-list validators that
// THROW on any unknown key, no I/O in this file. See modules/localhoster/settings-schema.mjs.

export const REGISTRY_VERSION = 1;

// Lifecycle is multi-dimensional — never one mutually exclusive enum. Each dimension is validated
// independently so a repository can be e.g. visible + resolved + active + unmonitored at once.
export const VISIBILITY_STATES = ["visible", "hidden"];
export const RESOLUTION_STATES = ["resolved", "unresolved"];
export const ACTIVITY_STATES = ["active", "inactive", "unknown"];

// Domains that can be independently enrolled for ongoing monitoring/association.
export const ENROLLMENT_DOMAINS = ["plans", "localhoster", "telemetry", "agentConfig", "health"];

// Discovery sources allowed in provenance records.
export const DISCOVERY_SOURCES = ["plans", "localhoster", "telemetry", "agentConfig", "doctor", "manual"];

export const CONFIDENCE_LEVELS = ["high", "medium", "low", "suggestion"];

export function defaultRegistry() {
  return { version: REGISTRY_VERSION, revision: 1, repositories: {}, aliases: {} };
}

// A canonical repository id is either a portable git id or an opaque local id. This is deliberately
// narrower than localhoster's safeIdentity (which also accepts path:/process:/roborepo:) — only
// git: and local: may be REGISTERED as canonical repositories.
export function safeRepositoryId(value) {
  if (typeof value !== "string" || !/^(git|local):/.test(value)) throw new Error("invalid repository id");
  if (value.length > 512) throw new Error("repository id too long");
  return value;
}

export function safeIsoTimestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO-8601 timestamp`);
  return value;
}

function safeString(value, label, max = 200) {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} is invalid`);
  return value.trim().slice(0, max);
}

function safeOpaqueId(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function validateObjectKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`unknown ${label} field: ${key}`);
  }
}

export function validateRegistry(registry) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) throw new Error("registry must be an object");
  validateObjectKeys(registry, ["aliases", "repositories", "revision", "version"], "registry");
  if (registry.version !== REGISTRY_VERSION) throw new Error(`unsupported repository registry version: ${registry.version}`);
  if (!Number.isInteger(registry.revision) || registry.revision < 1) throw new Error("registry revision must be a positive integer");
  validateRepositories(registry.repositories);
  validateAliases(registry.aliases);
  return registry;
}

function validateRepositories(repositories) {
  if (!repositories || typeof repositories !== "object" || Array.isArray(repositories)) throw new Error("registry repositories must be an object");
  for (const [id, record] of Object.entries(repositories)) {
    safeRepositoryId(id);
    validateRepositoryRecord(id, record);
  }
}

export function validateRepositoryRecord(id, record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("repository record must be an object");
  validateObjectKeys(record, [
    "id", "kind", "displayName", "providerUrl", "normalizedRemote",
    "localRoots", "discoveries", "enrollments", "aliases",
    "visibility", "resolution", "activity", "createdAt", "updatedAt",
  ], "repository record");
  if (record.id !== id) throw new Error("repository record id must match its key");
  safeRepositoryId(record.id);
  if (!["git", "local"].includes(record.kind)) throw new Error("repository kind must be git or local");
  safeString(record.displayName, "repository displayName", 120);
  if (record.providerUrl != null) validateProviderUrl(record.providerUrl);
  if (record.normalizedRemote != null) safeRepositoryId(record.normalizedRemote);
  validateLocalRoots(record.localRoots);
  validateDiscoveries(record.discoveries);
  validateEnrollments(record.enrollments);
  validateRecordAliases(record.aliases);
  if (!VISIBILITY_STATES.includes(record.visibility)) throw new Error("repository visibility is invalid");
  if (!RESOLUTION_STATES.includes(record.resolution)) throw new Error("repository resolution is invalid");
  if (!ACTIVITY_STATES.includes(record.activity)) throw new Error("repository activity is invalid");
  safeIsoTimestamp(record.createdAt, "repository createdAt");
  safeIsoTimestamp(record.updatedAt, "repository updatedAt");
  return record;
}

// Only https loopback-free provider URLs for recognized-shape hosts. Never embed credentials.
function validateProviderUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("repository providerUrl must be a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("repository providerUrl must be https");
  if (url.username || url.password) throw new Error("repository providerUrl must not contain credentials");
  return value;
}

function validateLocalRoots(localRoots) {
  if (!Array.isArray(localRoots)) throw new Error("repository localRoots must be an array");
  const seen = new Set();
  for (const root of localRoots) {
    if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("localRoot must be an object");
    validateObjectKeys(root, ["rootId", "kind", "firstSeenAt", "lastSeenAt"], "localRoot");
    const rootId = safeOpaqueId(root.rootId, "localRoot rootId");
    if (seen.has(rootId)) throw new Error(`duplicate localRoot rootId: ${rootId}`);
    seen.add(rootId);
    if (!["primary", "clone", "worktree"].includes(root.kind)) throw new Error("localRoot kind is invalid");
    safeIsoTimestamp(root.firstSeenAt, "localRoot firstSeenAt");
    safeIsoTimestamp(root.lastSeenAt, "localRoot lastSeenAt");
  }
}

function validateDiscoveries(discoveries) {
  if (!Array.isArray(discoveries)) throw new Error("repository discoveries must be an array");
  for (const discovery of discoveries) {
    if (!discovery || typeof discovery !== "object" || Array.isArray(discovery)) throw new Error("discovery must be an object");
    validateObjectKeys(discovery, ["source", "firstSeenAt", "lastSeenAt", "evidence", "confidence"], "discovery");
    if (!DISCOVERY_SOURCES.includes(discovery.source)) throw new Error("discovery source is invalid");
    safeIsoTimestamp(discovery.firstSeenAt, "discovery firstSeenAt");
    safeIsoTimestamp(discovery.lastSeenAt, "discovery lastSeenAt");
    safeString(discovery.evidence, "discovery evidence", 80);
    if (!CONFIDENCE_LEVELS.includes(discovery.confidence)) throw new Error("discovery confidence is invalid");
  }
}

function validateEnrollments(enrollments) {
  if (!enrollments || typeof enrollments !== "object" || Array.isArray(enrollments)) throw new Error("repository enrollments must be an object");
  for (const [domain, enrollment] of Object.entries(enrollments)) {
    if (!ENROLLMENT_DOMAINS.includes(domain)) throw new Error(`unknown enrollment domain: ${domain}`);
    if (!enrollment || typeof enrollment !== "object" || Array.isArray(enrollment)) throw new Error("enrollment must be an object");
    validateObjectKeys(enrollment, ["enabled", "sourceId"], "enrollment");
    if (typeof enrollment.enabled !== "boolean") throw new Error("enrollment enabled must be boolean");
    if (enrollment.sourceId != null) safeOpaqueId(enrollment.sourceId, "enrollment sourceId");
  }
}

// Per-record aliases: opaque source identities (e.g. a path:/process: identity, or a legacy id)
// that have been user-confirmed to mean THIS repository. Stored on the record for provenance; the
// registry-level alias map is what resolution walks.
function validateRecordAliases(aliases) {
  if (!Array.isArray(aliases)) throw new Error("repository aliases must be an array");
  for (const alias of aliases) {
    if (typeof alias !== "string" || !alias.trim()) throw new Error("repository alias must be a non-empty string");
  }
}

// Registry-level alias map: { [fromIdentity]: canonicalRepositoryId }. Any string source id may be
// a `from`; the `to` must be a registered canonical id shape. Cycle-checked.
function validateAliases(aliases) {
  if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) throw new Error("registry aliases must be an object");
  for (const [from, to] of Object.entries(aliases)) {
    if (typeof from !== "string" || !from.trim()) throw new Error("alias source must be a non-empty string");
    safeRepositoryId(to);
    if (from === to) throw new Error("alias cannot point to itself");
  }
  assertAliasGraph(aliases);
}

export function resolveRegistryAlias(registry, identity) {
  let current = identity;
  const seen = new Set([current]);
  for (;;) {
    const next = registry?.aliases?.[current];
    if (!next) return current;
    if (seen.has(next)) throw new Error("registry aliases must not contain cycles");
    seen.add(next);
    current = next;
  }
}

export function assertAliasGraph(aliases) {
  for (const identity of Object.keys(aliases)) {
    const seen = new Set([identity]);
    let next = aliases[identity];
    while (next) {
      if (seen.has(next)) throw new Error("registry aliases must not contain cycles");
      seen.add(next);
      next = aliases[next];
    }
  }
}

// Build a fresh, valid repository record with sane lifecycle defaults.
export function newRepositoryRecord(id, { kind, displayName, now = new Date().toISOString(), providerUrl = null, normalizedRemote = null }) {
  safeRepositoryId(id);
  const record = {
    id,
    kind,
    displayName,
    providerUrl: providerUrl ?? null,
    normalizedRemote: normalizedRemote ?? null,
    localRoots: [],
    discoveries: [],
    enrollments: {},
    aliases: [],
    visibility: "visible",
    resolution: kind === "git" ? "resolved" : "unresolved",
    activity: "unknown",
    createdAt: now,
    updatedAt: now,
  };
  return validateRepositoryRecord(id, record);
}

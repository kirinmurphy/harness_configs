import fs from "node:fs";
import path from "node:path";
import {
  REGISTRY_VERSION,
  assertAliasGraph,
  defaultRegistry,
  newRepositoryRecord,
  resolveRegistryAlias,
  safeRepositoryId,
  validateRegistry,
} from "./schema.mjs";

import { LAST_SEEN_DEBOUNCE_MS } from "./config.mjs";

export {
  REGISTRY_VERSION,
  defaultRegistry,
  resolveRegistryAlias,
  validateRegistry,
};

export function registryPathFor(stateRoot) {
  return path.join(stateRoot, "repositories", "registry.json");
}

export function loadRegistry({ stateRoot, fsApi = fs } = {}) {
  const filePath = registryPathFor(stateRoot);
  try {
    const parsed = JSON.parse(fsApi.readFileSync(filePath, "utf8"));
    const migrated = migrateRegistry(parsed);
    if (parsed.version !== REGISTRY_VERSION) {
      backupRegistryFile(filePath, parsed.version, fsApi);
      writeRegistry({ stateRoot, registry: migrated, fsApi });
    }
    return validateRegistry(migrated);
  } catch (err) {
    if (err && err.code === "ENOENT") return defaultRegistry();
    if (err instanceof SyntaxError) throw new Error("repository registry contains malformed JSON");
    throw err;
  }
}

export function writeRegistry({ stateRoot, registry, fsApi = fs } = {}) {
  const filePath = registryPathFor(stateRoot);
  const dir = path.dirname(filePath);
  fsApi.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.registry.${process.pid}.${Date.now()}.tmp`);
  fsApi.writeFileSync(temp, `${JSON.stringify(validateRegistry(registry), null, 2)}\n`);
  fsApi.renameSync(temp, filePath);
  return registry;
}

// Optimistic-concurrency mutation. `mutate(registry)` mutates a clone in place; if it returns
// false the write is skipped (no-op / debounced), otherwise the revision is bumped and persisted.
export function updateRegistry({ stateRoot, mutate, expectedRevision, fsApi = fs } = {}) {
  const current = loadRegistry({ stateRoot, fsApi });
  if (expectedRevision != null && expectedRevision !== current.revision) {
    const error = new Error("repository registry revision conflict");
    error.code = "REVISION_CONFLICT";
    error.current = current;
    throw error;
  }
  const next = structuredClone(current);
  const changed = mutate(next);
  if (changed === false) return current;
  next.revision += 1;
  writeRegistry({ stateRoot, registry: next, fsApi });
  return next;
}

function migrateRegistry(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("repository registry must be an object");
  if (parsed.version === REGISTRY_VERSION) return parsed;
  // No prior versions exist yet. When v2 arrives, add a v1->v2 branch here (mirrors
  // localhoster migrateSettings) and back up the old file in loadRegistry before rewriting.
  throw new Error(`unsupported repository registry version: ${parsed.version}`);
}

function backupRegistryFile(filePath, version, fsApi) {
  const backupPath = filePath.replace(/registry\.json$/, `registry.v${version}.backup.json`);
  try {
    fsApi.accessSync(backupPath);
    return; // Never overwrite an existing backup (idempotent re-migration).
  } catch {}
  try {
    fsApi.copyFileSync(filePath, backupPath);
  } catch {}
}

// ---- In-memory mutators (operate on a registry clone; used inside updateRegistry) ----

// Shared guard: every mutator needs an existing record and fails identically without one.
function requireRecord(registry, id, action) {
  const record = registry.repositories[id];
  if (!record) throw new Error(`cannot ${action} for unknown repository: ${id}`);
  return record;
}

// Insert or refresh a canonical repository record. Idempotent: an existing record keeps its
// createdAt/discoveries/localRoots and only merges the provided metadata. Returns the record.
export function upsertRepository(registry, { id, kind, displayName, providerUrl = null, normalizedRemote = null, now = new Date().toISOString() }) {
  safeRepositoryId(id);
  const existing = registry.repositories[id];
  if (!existing) {
    const record = newRepositoryRecord(id, { kind, displayName, providerUrl, normalizedRemote, now });
    registry.repositories[id] = record;
    return record;
  }
  if (displayName && existing.displayName !== displayName) existing.displayName = displayName;
  if (providerUrl != null && existing.providerUrl !== providerUrl) existing.providerUrl = providerUrl;
  if (normalizedRemote != null && existing.normalizedRemote !== normalizedRemote) existing.normalizedRemote = normalizedRemote;
  existing.updatedAt = now;
  return existing;
}

// Append or refresh a discovery-provenance entry for one source. Idempotent per source: repeated
// discoveries from the same source only bump lastSeenAt (debounced). Returns true if anything
// changed (so updateRegistry can skip a pure-debounce write).
export function recordDiscovery(registry, id, { source, evidence, confidence, now = new Date().toISOString() }) {
  const record = requireRecord(registry, id, "record discovery");
  const existing = record.discoveries.find((d) => d.source === source);
  if (!existing) {
    record.discoveries.push({ source, firstSeenAt: now, lastSeenAt: now, evidence, confidence });
    record.updatedAt = now;
    return true;
  }
  let changed = false;
  if (existing.evidence !== evidence) { existing.evidence = evidence; changed = true; }
  if (existing.confidence !== confidence) { existing.confidence = confidence; changed = true; }
  if (Date.parse(now) - Date.parse(existing.lastSeenAt) >= LAST_SEEN_DEBOUNCE_MS) { existing.lastSeenAt = now; changed = true; }
  if (changed) record.updatedAt = now;
  return changed;
}

// Register a local on-disk root (clone or worktree) under a repository. Idempotent by rootId.
export function registerLocalRoot(registry, id, { rootId, kind = "clone", now = new Date().toISOString() }) {
  const record = requireRecord(registry, id, "register local root");
  const existing = record.localRoots.find((r) => r.rootId === rootId);
  if (!existing) {
    // First root registered becomes primary unless caller says otherwise.
    const resolvedKind = record.localRoots.length === 0 && kind === "clone" ? "primary" : kind;
    record.localRoots.push({ rootId, kind: resolvedKind, firstSeenAt: now, lastSeenAt: now });
    record.updatedAt = now;
    return true;
  }
  if (Date.parse(now) - Date.parse(existing.lastSeenAt) >= LAST_SEEN_DEBOUNCE_MS) {
    existing.lastSeenAt = now;
    record.updatedAt = now;
    return true;
  }
  return false;
}

// Set enrollment for a domain. Idempotent — returns false when nothing changed.
export function setEnrollment(registry, id, domain, { enabled, sourceId = null, now = new Date().toISOString() }) {
  const record = requireRecord(registry, id, "set enrollment");
  const existing = record.enrollments[domain];
  const next = { enabled, ...(sourceId != null ? { sourceId } : {}) };
  if (existing && existing.enabled === enabled && (existing.sourceId ?? null) === sourceId) return false;
  record.enrollments[domain] = next;
  record.updatedAt = now;
  return true;
}

export function hideRepository(registry, id, { hidden, now = new Date().toISOString() }) {
  const record = requireRecord(registry, id, "hide");
  const target = hidden ? "hidden" : "visible";
  if (record.visibility === target) return false;
  record.visibility = target;
  record.updatedAt = now;
  return true;
}

// Confirm that an opaque source identity aliases to a canonical repository. Cycle-checked before
// commit (mirrors localhoster mutateAlias). Idempotent.
export function setAlias(registry, fromIdentity, toRepositoryId, { now = new Date().toISOString() } = {}) {
  safeRepositoryId(toRepositoryId);
  if (fromIdentity === toRepositoryId) throw new Error("alias cannot point to itself");
  if (registry.aliases[fromIdentity] === toRepositoryId) return false;
  const nextAliases = { ...registry.aliases, [fromIdentity]: toRepositoryId };
  assertAliasGraph(nextAliases);
  registry.aliases = nextAliases;
  const record = registry.repositories[toRepositoryId];
  if (record && !record.aliases.includes(fromIdentity)) {
    record.aliases.push(fromIdentity);
    record.updatedAt = now;
  }
  return true;
}

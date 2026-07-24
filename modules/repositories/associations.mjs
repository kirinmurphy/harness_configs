import { canonicalRepositoryId, localRepositoryId, resolveProjectIdentity, rootId } from "./identity.mjs";
import { resolveRegistryAlias } from "./schema.mjs";

// Evidence → confidence → auto-association policy (doc §"Confidence and Evidence"). The table is
// the single source of truth for whether a piece of evidence may automatically associate a record
// with a repository, or merely power a suggestion. Name-only and prompt-text evidence NEVER
// auto-associate.
export const EVIDENCE_POLICY = {
  "git-remote": { confidence: "high", autoAssociate: true },
  "user-alias": { confidence: "high", autoAssociate: true },
  "git-root-hash": { confidence: "high", autoAssociate: true },
  "cwd-in-git-root": { confidence: "high", autoAssociate: true },
  "aliased-path": { confidence: "high", autoAssociate: true },
  "worktree-commondir": { confidence: "high", autoAssociate: true },
  "process-cwd": { confidence: "medium", autoAssociate: false },
  "name-match": { confidence: "low", autoAssociate: false },
  "prompt-text": { confidence: "suggestion", autoAssociate: false },
};

export function evidencePolicy(evidence) {
  return EVIDENCE_POLICY[evidence] || { confidence: "suggestion", autoAssociate: false };
}

// Resolve a working directory to a canonical association result. Applies registry aliases so a
// confirmed path:/process: identity maps to its canonical repository. Returns:
//   { repositoryId, rootId, kind, confidence, evidence, autoAssociate, resolved }
// repositoryId is null when the cwd is not (yet) a registerable repository (process-only, no git).
export function associateWorkingDir(cwd, commandName, { registry = null, resolveIdentity = resolveProjectIdentity, options = {} } = {}) {
  const resolved = resolveIdentity(cwd, commandName, options);
  return associateResolved(resolved, { registry });
}

// Associate an already-resolved identity object (from resolveProjectIdentity).
export function associateResolved(resolved, { registry = null } = {}) {
  const base = {
    repositoryId: null,
    rootId: resolved.projectRoot ? rootId(resolved.projectRoot) : null,
    kind: resolved.identityKind,
    confidence: resolved.confidence,
    evidence: evidenceForResolved(resolved),
    autoAssociate: false,
    resolved,
  };

  // A confirmed alias on the raw identity (e.g. path:/foo aliased to git:host/owner/repo) wins and
  // is high-confidence, user-confirmed.
  if (registry) {
    const aliased = resolveRegistryAlias(registry, resolved.identity);
    if (aliased !== resolved.identity) {
      return { ...base, repositoryId: aliased, evidence: "user-alias", confidence: "high", autoAssociate: true };
    }
  }

  const canonical = canonicalRepositoryId(resolved);
  if (!canonical) return base; // process-only: not a repository
  const policy = evidencePolicy(base.evidence);
  return { ...base, repositoryId: canonical, confidence: policy.confidence, autoAssociate: policy.autoAssociate };
}

function evidenceForResolved(resolved) {
  if (resolved.identityKind === "git") return "git-remote";
  if (resolved.identityKind === "path") return "cwd-in-git-root";
  return "process-cwd";
}

// Match a legacy telemetry record to a canonical repository using only hashes already known to the
// registry. Never fabricates an id from a name. Returns { repositoryId, provenance } where
// provenance is one of: legacy-remote-hash, legacy-root-hash, unresolved.
export function associateLegacyHashes({ normalizedRemoteHash = null, rootHash = null, hashIndex }) {
  if (normalizedRemoteHash && hashIndex.byNormalizedRemoteHash.has(normalizedRemoteHash)) {
    return { repositoryId: hashIndex.byNormalizedRemoteHash.get(normalizedRemoteHash), provenance: "legacy-remote-hash" };
  }
  if (rootHash && hashIndex.byRootHash.has(rootHash)) {
    return { repositoryId: hashIndex.byRootHash.get(rootHash), provenance: "legacy-root-hash" };
  }
  return { repositoryId: null, provenance: "unresolved" };
}

export { localRepositoryId };

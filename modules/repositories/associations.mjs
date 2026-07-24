import { canonicalRepositoryId, localRepositoryId, rootId } from "./identity.mjs";
import { resolveRegistryAlias } from "./schema.mjs";
import { EVIDENCE_POLICY } from "./config.mjs";

export { EVIDENCE_POLICY };

export function evidencePolicy(evidence) {
  return EVIDENCE_POLICY[evidence] || { confidence: "suggestion", autoAssociate: false };
}

// Associate an already-resolved identity object (from resolveProjectIdentity). Applies registry
// aliases so a confirmed path:/process: identity maps to its canonical repository. Returns:
//   { repositoryId, rootId, kind, confidence, evidence, autoAssociate, resolved }
// repositoryId is null when the cwd is not (yet) a registerable repository (process-only, no git).
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
  if (resolved.identityKind === "path") return "path-root";
  return "process-cwd";
}

// Match a legacy telemetry record to a canonical repository using the normalized-remote hash the
// registry knows about. Never fabricates an id from a name. Returns { repositoryId, provenance }
// where provenance is one of: legacy-remote-hash, unresolved.
//
// Note: there is deliberately NO legacy git-root-hash tier. The legacy raw git_root_hash is a hash
// of an absolute path, and the registry only stores opaque, salted rootIds (never the raw path), so
// it cannot reproduce that hash to index it. Legacy no-remote local repos therefore stay unresolved
// until they emit a record carrying a direct repository_id. Git repos correlate via the remote hash.
export function associateLegacyHashes({ normalizedRemoteHash = null, hashIndex }) {
  if (normalizedRemoteHash && hashIndex.byNormalizedRemoteHash.has(normalizedRemoteHash)) {
    return { repositoryId: hashIndex.byNormalizedRemoteHash.get(normalizedRemoteHash), provenance: "legacy-remote-hash" };
  }
  return { repositoryId: null, provenance: "unresolved" };
}

export { localRepositoryId };

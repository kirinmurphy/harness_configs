// Read-time canonical repository resolution for telemetry events. New records carry a canonical
// repository_id directly; older records only have legacy hashes. This resolves an event to a
// canonical repository id + provenance WITHOUT rewriting the spool (doc §"Telemetry reads and
// historical association"). Provenance is exposed so future UI can explain how a record was matched.
import { associateLegacyHashes } from "../../modules/repositories/index.mjs";

// Build a hash index from a loaded registry so legacy events can be matched to canonical ids by the
// normalized-remote hash or the git-root hash the registry knows about. `hashFn` must be the SAME
// hash used at capture time (telemetry-capture.mjs hash: sha256 hex, first 24 chars).
export function buildRepositoryHashIndex(registry, hashFn) {
  const byNormalizedRemoteHash = new Map();
  const byRootHash = new Map();
  for (const record of Object.values(registry?.repositories || {})) {
    if (record.normalizedRemote) byNormalizedRemoteHash.set(hashFn(record.normalizedRemote), record.id);
    // A registry knows opaque rootIds, not raw root paths, so it cannot reproduce the legacy raw
    // git_root_hash. Legacy root-hash matching therefore relies on a separately supplied map (e.g.
    // captured at enrollment time); absent that, root-hash matching simply yields "unresolved".
  }
  return { byNormalizedRemoteHash, byRootHash };
}

// Resolve one event to { repositoryId, provenance }. Provenance is one of:
//   direct              — the record already carries a canonical repository_id
//   legacy-remote-hash  — matched via normalized_remote_hash against the registry
//   legacy-root-hash    — matched via git_root_hash against a supplied root-hash map
//   unresolved          — no confident match; the record stays unassociated
export function repositoryRefForEvent(event, hashIndex) {
  const repo = event?.repo;
  if (!repo) return { repositoryId: null, provenance: "unresolved" };
  if (repo.repository_id) return { repositoryId: repo.repository_id, provenance: "direct" };
  if (!hashIndex) return { repositoryId: null, provenance: "unresolved" };
  return associateLegacyHashes({
    normalizedRemoteHash: repo.normalized_remote_hash || null,
    rootHash: repo.git_root_hash || null,
    hashIndex,
  });
}

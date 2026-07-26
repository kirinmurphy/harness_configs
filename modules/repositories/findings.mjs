// Shared contract for attaching (or deliberately NOT attaching) a canonical repository id to a
// finding — used by Doctor/health and Agent Config. The distinction is intentional and enforced
// here so no caller forces a global finding into a repository (doc §"Doctor and health",
// §"Agent Config"): installation-level and global-resource findings stay unassociated; only a
// finding a caller has already scoped to a specific repository carries a repositoryId.
//
// There is no repository-local Agent Config / Doctor surface in the codebase yet; this is the
// contract that future repo-scoped checks attach identity through, so association logic never gets
// re-invented per domain.

import { safeRepositoryId } from "./schema.mjs";

// Mark a finding as repository-scoped. `repositoryId` must be a canonical id; `rootId` is optional
// and retained internally when a check targeted a specific clone/worktree.
export function repositoryScopedFinding(finding, { repositoryId, rootId = null }) {
  safeRepositoryId(repositoryId);
  return { ...finding, scope: "repository", repositoryId, ...(rootId ? { rootId } : {}) };
}

// Mark a finding as global (installation-level or a global resource). Never carries a repositoryId.
export function globalFinding(finding) {
  return { ...finding, scope: "global" };
}

export function isRepositoryScoped(finding) {
  return finding?.scope === "repository" && typeof finding.repositoryId === "string";
}

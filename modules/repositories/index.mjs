// Domain-neutral canonical repository identity. Localhoster, Plans, Telemetry, Agent Config, and
// Doctor all import from here rather than owning their own resolver. Barrel re-export (mirrors
// modules/localhoster/index.mjs).

export {
  normalizeGitRemote,
  findProjectRoot,
  resolveProjectIdentity,
  canonicalRepositoryId,
  localRepositoryId,
  localRepositoryIdForRoot,
  realpathOf,
  rootId,
  resolveGitDir,
  providerUrlForRepositoryId,
} from "./identity.mjs";

export { createScanCache } from "./scan-cache.mjs";

export {
  GIT_TIMEOUT_MS,
  GIT_READONLY_COMMANDS,
  defaultRunGit,
  defaultRunGitSync,
  runGitProcess,
  runGitProcessSync,
} from "./git-exec.mjs";

export {
  collectBranchSyncFacts,
  parseBranchSyncOutput,
} from "./branch-sync.mjs";

export {
  GIT_NETWORK_TIMEOUT_MS,
  refreshRemote,
  pushBranchToUpstream,
} from "./git-remote-operations.mjs";

export {
  REGISTRY_VERSION,
  VISIBILITY_STATES,
  RESOLUTION_STATES,
  ACTIVITY_STATES,
  ENROLLMENT_DOMAINS,
  DISCOVERY_SOURCES,
  CONFIDENCE_LEVELS,
  defaultRegistry,
  validateRegistry,
  validateRepositoryRecord,
  newRepositoryRecord,
  safeRepositoryId,
  resolveRegistryAlias,
  assertAliasGraph,
} from "./schema.mjs";

export {
  registryPathFor,
  loadRegistry,
  writeRegistry,
  updateRegistry,
  upsertRepository,
  recordDiscovery,
  registerLocalRoot,
  registerLocalRootPath,
  localRootPath,
  checkoutRootsFor,
  priorRepositoryForRoot,
  setEnrollment,
  hideRepository,
  setAlias,
} from "./registry.mjs";

export {
  LIFECYCLE_STATES,
  AGE_OUT_MS,
  inspectCheckout,
  deriveLifecycle,
  lastSeenAtFor,
  ageOutCandidates,
  supersededBy,
  renamedInto,
} from "./lifecycle.mjs";

export {
  EVIDENCE_POLICY,
  evidencePolicy,
  associateResolved,
  associateLegacyHashes,
} from "./associations.mjs";

export {
  isEnrolled,
  enrollmentSourceId,
  plansSourceCoverage,
  planPlansEnrollment,
} from "./enrollment.mjs";

export {
  importLocalhosterAliases,
  canonicalizeLocalhosterIdentity,
} from "./migrate-localhoster.mjs";

export {
  repositoryScopedFinding,
  globalFinding,
  isRepositoryScoped,
} from "./findings.mjs";

export {
  repositorySummary,
  repositoryListPayload,
  repositoryDetailPayload,
} from "./summary.mjs";

// Domain-neutral canonical repository identity. Localhoster, Plans, Telemetry, Agent Config, and
// Doctor all import from here rather than owning their own resolver. Barrel re-export (mirrors
// modules/localhoster/index.mjs).

export {
  normalizeGitRemote,
  findProjectRoot,
  resolveProjectIdentity,
  canonicalRepositoryId,
  localRepositoryId,
  rootId,
  resolveGitDir,
} from "./identity.mjs";

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
  setEnrollment,
  hideRepository,
  setAlias,
} from "./registry.mjs";

export {
  EVIDENCE_POLICY,
  evidencePolicy,
  associateWorkingDir,
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

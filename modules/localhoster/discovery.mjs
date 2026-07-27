import { capabilityForPlatform } from "./capabilities.mjs";
import { resolveProjectIdentity } from "./identity.mjs";
import { canonicalRepositoryId, rootId as computeRootId } from "../repositories/identity.mjs";
import { createScanCache } from "../repositories/scan-cache.mjs";
import { defaultRunGit } from "../repositories/git-exec.mjs";
import { collectGitContext, collectGitForRoots } from "./git.mjs";
import { attachHealth, disambiguateAssociationKeys, toInstance } from "./instance-shape.mjs";
import { defaultRunCommand, discoverListenerRecords } from "./listeners.mjs";
import { originCandidatesForListener } from "./origin.mjs";
import { probeHttpCandidate } from "./http-probe.mjs";
import { resolveProjectAlias } from "./settings.mjs";

const PROBE_CONCURRENCY = 8;

export async function discoverInstances(options = {}) {
  const {
    platform = process.platform,
    runCommand = defaultRunCommand,
    probeHttp = probeHttpCandidate,
    probeConcurrency = PROBE_CONCURRENCY,
    resolveIdentity = resolveProjectIdentity,
    collectGit = collectGitContext,
    runGit = defaultRunGit,
    previousHealth = new Map(),
    now = new Date(),
    settings = null,
  } = options;
  // One cache per scan, created here and dropped when this call returns. Because
  // refreshLocalhosterSnapshot invokes discoverInstances exactly once per refresh, "per-scan" and
  // "per-call" are the same boundary. A process-lifetime cache would pin the first branch/dirty
  // reading the portal ever took and report it forever. The option exists only so tests can inspect
  // hit counts.
  const scanCache = options.scanCache || createScanCache();
  const capabilities = capabilityForPlatform(platform);
  const warnings = [];
  if (capabilities.discovery !== "supported") {
    return { capabilities, warnings, instances: [] };
  }

  const listenerProvider = await discoverListenerRecords({ platform, runCommand });
  warnings.push(...listenerProvider.warnings);
  const pending = [];
  const instances = [];

  for (const { listener, cwd } of listenerProvider.records) {
    const identity = withRepositoryFields(cwd
      ? resolveIdentity(cwd, listener.command, options)
      : {
        identity: `process:unknown:${listener.command}`,
        identityKind: "process",
        confidence: "low",
        projectRoot: null,
        evidence: "missing process working directory",
      });
    const appSettings = appSettingsForIdentity(settings, identity.identity);
    const candidates = originCandidatesForListener(listener, appSettings?.originPreference);
    pending.push({ listener, identity, candidates, cwd });
  }

  // Git collection is a separate pass over unique repository roots rather than work threaded into
  // the probe worker: the two are independent, and deduping by root means N apps in one repository
  // cost one collection. Running them concurrently keeps the scan at the cost of the slower half.
  const [probes, gitByRoot] = await Promise.all([
    probeHttp
      ? probeCandidatesForInstances(pending, probeHttp, warnings, probeConcurrency)
      : Promise.resolve(new Map()),
    collectGit
      ? collectGitForRoots(pending, { collectGit, scanCache, runGit })
      : Promise.resolve(new Map()),
  ]);

  for (const item of pending) {
    const probe = probeHttp ? probes.get(item) : null;
    if (probeHttp && !probe) continue;
    instances.push(toInstance({
      listener: item.listener,
      identity: item.identity,
      candidates: item.candidates,
      probe,
      cwd: item.cwd,
      git: gitByRoot.get(item.identity.projectRoot) || null,
    }));
  }
  disambiguateAssociationKeys(instances);
  // After disambiguation, so the previous-health lookup uses each instance's final key.
  attachHealth(instances, { previousHealth, settings, now });

  return { capabilities, warnings, instances };
}

// Attach canonical repository fields alongside the existing identity contract. repositoryId is the
// portable git id (or opaque local id) for git/path roots; null for process-only observations. A
// worktree resolves to the same repositoryId as its primary clone (readGitRemote reads commondir)
// while keeping its own rootId so worktree-specific metadata is retained. Additive — existing
// consumers of {identity, identityKind, confidence, projectRoot, evidence} are unaffected.
function withRepositoryFields(identity) {
  return {
    ...identity,
    repositoryId: canonicalRepositoryId(identity),
    rootId: identity.projectRoot ? computeRootId(identity.projectRoot) : null,
  };
}

function appSettingsForIdentity(settings, identity) {
  const resolvedIdentity = settings ? resolveProjectAlias(settings, identity) : identity;
  const project = settings?.projects?.[resolvedIdentity];
  if (!project) return null;
  return project.apps?.web || Object.values(project.apps || {})[0] || null;
}

async function probeCandidatesForInstances(items, probeHttp, warnings, concurrency) {
  const results = new Map();
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index];
      for (const candidate of item.candidates) {
        try {
          const result = await probeHttp(candidate);
          if (result?.http === true) {
            results.set(item, { ...result, origin: candidate.origin });
            break;
          }
        } catch (err) {
          warnings.push(`probe failed for ${candidate.origin}: ${err.message}`);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker));
  return results;
}

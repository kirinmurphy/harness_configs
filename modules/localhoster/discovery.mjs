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
import { discoverDockerRecords, defaultRunCommand as defaultRunDockerCommand } from "./docker.mjs";
import { collectProcessMetrics, defaultRunCommand as defaultRunPsCommand } from "./process-metrics.mjs";

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
    discoverDocker = discoverDockerRecords,
    collectProcess = collectProcessMetrics,
    // Deliberately separate from the listener `runCommand`: existing callers/tests configure
    // `runCommand` to answer `lsof`, and must not also have to answer `docker`/`ps` invocations they
    // never asked to opt into. Passing `runCommand` here only takes effect for callers who
    // explicitly provide these two options.
    runDockerCommand = defaultRunDockerCommand,
    runPsCommand = defaultRunPsCommand,
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
    // appSettings is retained (not just its originPreference) so health classification reuses this
    // alias-resolved lookup rather than re-deriving it with a different rule.
    pending.push({ listener, identity, candidates, cwd, appSettings });
  }

  // Git, Docker, and process-metrics collection are each a separate pass rather than work threaded
  // into the probe worker: all three are independent of the probe and of each other. Git dedupes by
  // repository root, Docker is one `docker ps` for the whole scan, and process metrics is one batched
  // `ps` for every discovered PID — so running them concurrently keeps the scan at the cost of the
  // slowest single pass rather than the sum of all four.
  const [probes, gitByRoot, dockerResult, processByPid] = await Promise.all([
    probeHttp
      ? probeCandidatesForInstances(pending, probeHttp, warnings, probeConcurrency)
      : Promise.resolve(new Map()),
    collectGit
      ? collectGitForRoots(pending, { collectGit, scanCache, runGit })
      : Promise.resolve(new Map()),
    discoverDocker ? discoverDocker({ platform, runCommand: runDockerCommand }) : Promise.resolve({ warnings: [], containers: [] }),
    collectProcess ? collectProcess(pending.map((item) => item.listener.pid), { platform, runCommand: runPsCommand }) : Promise.resolve(new Map()),
  ]);
  warnings.push(...dockerResult.warnings);
  const dockerByHostPort = indexDockerContainersByHostPort(dockerResult.containers);

  // A manually-associated repo (settings.composeProjects[name].repoPath — see settings-schema.mjs
  // for why this is a path rather than an identity) has to be resolved here, not in
  // buildLocalhosterSnapshot, because git collection is async and which compose projects exist is
  // only known once dockerResult above has resolved. One extra collectGit call per associated
  // project, not per container/port.
  const composeProjectGit = collectGit
    ? await collectGitForComposeProjects(dockerResult.containers, settings, { collectGit, scanCache, runGit })
    : new Map();

  // instance -> the probe and app settings that produced it. Health is classified in a later pass
  // (association keys must be final first), and this carries the inputs across rather than having
  // that pass rebuild them from the flattened instance.
  const context = new Map();
  for (const item of pending) {
    const probe = probeHttp ? probes.get(item) : null;
    const docker = dockerByHostPort.get(item.listener.port) || null;
    // A container observation is independent confirmation the listener is a real service, so it
    // substitutes for a failed/inapplicable HTTP probe (e.g. Postgres) rather than being dropped
    // alongside actual noise (ControlCenter, Dropbox) that never got Docker corroboration either.
    if (probeHttp && !probe && !docker) continue;
    const instance = toInstance({
      listener: item.listener,
      identity: item.identity,
      candidates: item.candidates,
      probe,
      cwd: item.cwd,
      git: gitByRoot.get(item.identity.projectRoot) || null,
      docker,
      processMetrics: toProcessMetricsFields(processByPid.get(item.listener.pid)),
    });
    context.set(instance, { probe, appSettings: item.appSettings });
    instances.push(instance);
  }
  disambiguateAssociationKeys(instances);
  // After disambiguation, so the previous-health lookup uses each instance's final key.
  attachHealth(instances, { previousHealth, context, now });

  return { capabilities, warnings, instances, composeProjectGit };
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

// One collectGit call per distinct associated repoPath, not per container — several compose
// projects could theoretically point at the same path, and a project with no association at all
// (the common case) costs nothing here. repositoryId is resolved alongside git so the compose
// card's repo link can reuse providerUrlForRepositoryId the same way a regular project card does.
async function collectGitForComposeProjects(containers, settings, { collectGit, scanCache, runGit }) {
  const composeProjectNames = new Set(containers.map((c) => c.composeProject).filter(Boolean));
  const byProjectName = new Map();
  await Promise.all(
    Array.from(composeProjectNames, async (name) => {
      const repoPath = settings?.composeProjects?.[name]?.repoPath;
      if (!repoPath) return;
      const identity = resolveProjectIdentity(repoPath, "docker-compose");
      byProjectName.set(name, {
        git: await collectGit(repoPath, { scanCache, runGit }),
        repositoryId: canonicalRepositoryId(identity),
      });
    }),
  );
  return byProjectName;
}

// Docker Desktop on macOS runs containers inside a Linux VM, so container PIDs are never
// comparable to host-side lsof PIDs — published host port is the only reliable correlation between
// a container and the listener it backs. A container with no published ports, or whose published
// port matches no discovered listener, never appears on any instance.
function indexDockerContainersByHostPort(containers) {
  const byHostPort = new Map();
  for (const container of containers) {
    for (const { hostPort } of container.publishedPorts) {
      if (!byHostPort.has(hostPort)) {
        byHostPort.set(hostPort, {
          containerId: container.containerId,
          name: container.name,
          image: container.image,
          composeProject: container.composeProject,
          composeService: container.composeService,
          state: container.state,
        });
      }
    }
  }
  return byHostPort;
}

// Instance records already carry pid/ppid/command via `process`; only the metrics `ps` doesn't
// overlap with are surfaced here, and only when that PID actually answered (exited-before-`ps`-ran
// PIDs are simply absent from processByPid, never backfilled with a fabricated reading).
function toProcessMetricsFields(metrics) {
  if (!metrics) return null;
  return {
    cpuPercent: metrics.cpuPercent,
    residentMemoryKb: metrics.residentMemoryKb,
    elapsedSeconds: metrics.elapsedSeconds,
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

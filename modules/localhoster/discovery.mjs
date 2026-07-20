import { createHash } from "node:crypto";
import path from "node:path";
import { capabilityForPlatform } from "./capabilities.mjs";
import { resolveProjectIdentity } from "./identity.mjs";
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
    settings = null,
  } = options;
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
    const identity = cwd
      ? resolveIdentity(cwd, listener.command, options)
      : {
        identity: `process:unknown:${listener.command}`,
        identityKind: "process",
        confidence: "low",
        projectRoot: null,
        evidence: "missing process working directory",
      };
    const appSettings = appSettingsForIdentity(settings, identity.identity);
    const candidates = originCandidatesForListener(listener, appSettings?.originPreference);
    pending.push({ listener, identity, candidates, cwd });
  }

  const probes = probeHttp
    ? await probeCandidatesForInstances(pending, probeHttp, warnings, probeConcurrency)
    : new Map();
  for (const item of pending) {
    const probe = probeHttp ? probes.get(item) : null;
    if (probeHttp && !probe) continue;
    instances.push(toInstance(item.listener, item.identity, item.candidates, probe, item.cwd));
  }
  disambiguateAssociationKeys(instances);

  return { capabilities, warnings, instances };
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

function toInstance(listener, identity, candidates, probe, cwd) {
  const origin = probe?.origin || candidates[0]?.origin || null;
  const matchSignature = buildMatchSignature(identity, listener.command, cwd, probe?.title);
  return {
    key: `${listener.pid}:${listener.address}:${listener.port}`,
    associationKey: matchSignature.key,
    matchSignature,
    origin,
    alternateOrigins: candidates.map((candidate) => candidate.origin).filter((candidate) => candidate !== origin),
    bind: {
      address: listener.address,
      port: listener.port,
      scope: listener.bindScope,
      warning: listener.bindScope === "loopback" ? null : "Listener is exposed beyond loopback.",
    },
    status: probe?.status ?? null,
    latencyMs: probe?.latencyMs ?? null,
    protocol: probe?.protocol ?? "http",
    title: probe?.title ?? null,
    process: { pid: listener.pid, command: listener.command },
    project: identity,
  };
}

function disambiguateAssociationKeys(instances) {
  const counts = new Map();
  for (const instance of instances) {
    const key = instance.matchSignature.key;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const instance of instances) {
    if (counts.get(instance.matchSignature.key) <= 1) continue;
    instance.associationKey = instance.matchSignature.titleKey;
  }
}

function buildMatchSignature(identity, command, cwd, title) {
  const relativeCwd = identity.projectRoot && cwd
    ? path.relative(identity.projectRoot, cwd) || "."
    : null;
  const parts = {
    projectIdentity: identity.identity,
    relativeCwd,
    command: safeCommand(command),
  };
  const key = "a" + createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
  const safeTitle = title ? String(title).slice(0, 120) : null;
  const titleKey = "a" + createHash("sha256").update(JSON.stringify({ ...parts, title: safeTitle })).digest("hex").slice(0, 24);
  return { key, titleKey, ...parts, title: safeTitle };
}

function safeCommand(value) {
  return String(value || "unknown").replace(/[^\w.-]/g, "_").slice(0, 80);
}

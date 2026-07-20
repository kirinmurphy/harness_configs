import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { parseCwdFieldOutput, parseLsofFieldOutput, originCandidatesForListener } from "./lsof.mjs";
import { resolveProjectIdentity } from "./identity.mjs";
import { probeHttpCandidate } from "./probe.mjs";

const execFileAsync = promisify(execFile);
const DISCOVERY_TIMEOUT_MS = 1500;

export function capabilityForPlatform(platform = process.platform) {
  if (platform === "darwin") {
    return {
      platform,
      platformLabel: "macOS",
      discovery: "supported",
      available: ["listeners", "processWorkingDirectory", "httpProbe", "projectIdentity"],
      unavailable: [],
      message: null,
    };
  }
  const label = platform === "win32" ? "Windows" : platform === "linux" ? "Linux" : platform;
  return {
    platform,
    platformLabel: label,
    discovery: "unsupported",
    available: [],
    unavailable: ["listeners", "processWorkingDirectory", "automaticProjectMatching"],
    message: `Automatic localhost discovery is not yet supported on ${label}.`,
  };
}

export async function discoverInstances(options = {}) {
  const {
    platform = process.platform,
    runCommand = defaultRunCommand,
    probeHttp = probeHttpCandidate,
    resolveIdentity = resolveProjectIdentity,
  } = options;
  const capabilities = capabilityForPlatform(platform);
  const warnings = [];
  if (capabilities.discovery !== "supported") {
    return { capabilities, warnings, instances: [] };
  }

  let listenerOutput;
  try {
    listenerOutput = await runCommand("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"], { timeoutMs: DISCOVERY_TIMEOUT_MS });
  } catch (err) {
    warnings.push(`listener discovery failed: ${err.message}`);
    return { capabilities, warnings, instances: [] };
  }

  const listeners = parseLsofFieldOutput(listenerOutput.stdout ?? listenerOutput);
  const cwdByPid = new Map();
  const instances = [];

  for (const listener of listeners) {
    if (!cwdByPid.has(listener.pid)) {
      cwdByPid.set(listener.pid, await resolvePidCwd(listener.pid, runCommand, warnings));
    }
    const cwd = cwdByPid.get(listener.pid);
    const identity = cwd
      ? resolveIdentity(cwd, listener.command, options)
      : {
        identity: `process:unknown:${listener.command}`,
        identityKind: "process",
        confidence: "low",
        projectRoot: null,
        evidence: "missing process working directory",
      };
    const candidates = originCandidatesForListener(listener);
    const probe = probeHttp ? await probeFirstHttp(candidates, probeHttp, warnings) : null;
    if (probeHttp && !probe) continue;
    instances.push(toInstance(listener, identity, candidates, probe, cwd));
  }

  return { capabilities, warnings, instances };
}

async function resolvePidCwd(pid, runCommand, warnings) {
  try {
    const result = await runCommand("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-F", "n"], { timeoutMs: DISCOVERY_TIMEOUT_MS });
    return parseCwdFieldOutput(result.stdout ?? result);
  } catch (err) {
    warnings.push(`cwd lookup failed for pid ${pid}: ${err.message}`);
    return null;
  }
}

async function probeFirstHttp(candidates, probeHttp, warnings) {
  for (const candidate of candidates) {
    try {
      const result = await probeHttp(candidate);
      if (result?.http === true) return { ...result, origin: candidate.origin };
    } catch (err) {
      warnings.push(`probe failed for ${candidate.origin}: ${err.message}`);
    }
  }
  return null;
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

function buildMatchSignature(identity, command, cwd, title) {
  const relativeCwd = identity.projectRoot && cwd
    ? path.relative(identity.projectRoot, cwd) || "."
    : null;
  const parts = {
    projectIdentity: identity.identity,
    relativeCwd,
    command: safeCommand(command),
    title: title ? String(title).slice(0, 120) : null,
  };
  const key = "a" + createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
  return { key, ...parts };
}

function safeCommand(value) {
  return String(value || "unknown").replace(/[^\w.-]/g, "_").slice(0, 80);
}

async function defaultRunCommand(command, args, { timeoutMs } = {}) {
  return execFileAsync(command, args, { timeout: timeoutMs, encoding: "utf8", maxBuffer: 1024 * 1024 });
}

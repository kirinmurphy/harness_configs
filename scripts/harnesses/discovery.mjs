// Bounded harness-provider discovery: checks a provider's declared executable names, home
// directory, and config file candidates, then normalizes the evidence into a confidence level.
// Never scans the filesystem broadly — only the locations a provider's manifest declares.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function expandHome(homeRelativePath) {
  return path.join(os.homedir(), homeRelativePath.slice(2));
}

function resolveExecutable(name) {
  const command = process.platform === "win32" ? "where" : "which";
  try {
    const output = execFileSync(command, [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const resolvedPath = output.split(/\r?\n/).find((line) => line.trim() !== "");
    return resolvedPath ? resolvedPath.trim() : null;
  } catch {
    return null;
  }
}

function collectEvidence(manifest) {
  const detection = manifest.detection;
  const evidence = [];

  for (const executable of detection.executables ?? []) {
    const resolvedPath = resolveExecutable(executable);
    if (resolvedPath) evidence.push({ kind: "executable", value: executable, resolvedPath });
  }
  for (const homeCandidate of detection.homeCandidates ?? []) {
    if (fs.existsSync(expandHome(homeCandidate))) evidence.push({ kind: "home", value: homeCandidate });
  }
  for (const configCandidate of detection.configCandidates ?? []) {
    if (fs.existsSync(expandHome(configCandidate))) evidence.push({ kind: "config", value: configCandidate });
  }
  return evidence;
}

// Confidence rules from the plan's Discovery model table: executable + recognized config/home is
// confirmed; executable-only or config-only is probable; home-only is possible; nothing is absent.
function normalizeConfidence(evidence) {
  const kinds = new Set(evidence.map((item) => item.kind));
  const hasExecutable = kinds.has("executable");
  const hasConfig = kinds.has("config");
  const hasHome = kinds.has("home");

  if (hasExecutable && (hasConfig || hasHome)) return "confirmed";
  if (hasExecutable || hasConfig) return "probable";
  if (hasHome) return "possible";
  return "absent";
}

export function detectHarnessProvider(manifest) {
  const evidence = collectEvidence(manifest);
  const confidence = normalizeConfidence(evidence);
  return {
    providerId: manifest.id,
    status: confidence === "absent" ? "absent" : "detected",
    confidence,
    evidence,
    warnings: [],
  };
}

export function discoverHarnessProviders(providers) {
  return providers.map((provider) => detectHarnessProvider(provider.manifest));
}

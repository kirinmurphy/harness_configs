// Bounded harness-provider discovery: checks a provider's declared executable names, home
// directory, and config file candidates, then normalizes the evidence into a confidence level.
// Never scans the filesystem broadly — only the locations a provider's manifest declares.

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expandHome } from "./paths.mjs";

const DEFAULT_EXECUTABLE_VALIDATION_ARGS = Object.freeze(["--version"]);
const DEFAULT_EXECUTABLE_VALIDATION_TIMEOUT_MS = 2000;
const CONFIDENCE_RANK = Object.freeze({ absent: 0, possible: 1, probable: 2, confirmed: 3 });

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

function executableValidation(detection) {
  return {
    args: detection.executableValidation?.args ?? DEFAULT_EXECUTABLE_VALIDATION_ARGS,
    timeoutMs: detection.executableValidation?.timeoutMs ?? DEFAULT_EXECUTABLE_VALIDATION_TIMEOUT_MS,
  };
}

function validatesExecutable(resolvedPath, validation) {
  try {
    execFileSync(resolvedPath, validation.args, {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
      timeout: validation.timeoutMs,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function collectEvidence(manifest) {
  const detection = manifest.detection;
  const validation = executableValidation(detection);
  const evidence = [];

  for (const executable of detection.executables ?? []) {
    const resolvedPath = resolveExecutable(executable);
    if (resolvedPath && validatesExecutable(resolvedPath, validation)) {
      evidence.push({ kind: "executable", value: executable, resolvedPath });
    }
  }
  for (const homeCandidate of detection.homeCandidates ?? []) {
    if (fs.existsSync(expandHome(homeCandidate))) evidence.push({ kind: "home", value: homeCandidate });
  }
  for (const configCandidate of detection.configCandidates ?? []) {
    if (fs.existsSync(expandHome(configCandidate))) evidence.push({ kind: "config", value: configCandidate });
  }
  return evidence;
}

// Confidence rules: a validated executable is the strongest signal — executable alone is
// probable, executable + recognized config/home is confirmed. A config file or home directory
// without the executable is only possible: harness config homes routinely outlive the tool that
// created them (a stray ~/.claude/settings.json from another tool must not register Claude Code
// as installed), so file evidence alone never clears a probable minimum.
function normalizeConfidence(evidence) {
  const kinds = new Set(evidence.map((item) => item.kind));
  const hasExecutable = kinds.has("executable");
  const hasConfig = kinds.has("config");
  const hasHome = kinds.has("home");

  if (hasExecutable && (hasConfig || hasHome)) return "confirmed";
  if (hasExecutable) return "probable";
  if (hasConfig || hasHome) return "possible";
  return "absent";
}

export function confidenceMeetsMinimum(confidence, minimumConfidence) {
  return (CONFIDENCE_RANK[confidence] ?? 0) >= (CONFIDENCE_RANK[minimumConfidence] ?? Infinity);
}

export function detectHarnessProvider(manifest) {
  const evidence = collectEvidence(manifest);
  const confidence = normalizeConfidence(evidence);
  const detected = confidenceMeetsMinimum(confidence, manifest.detection.minimumConfidence);
  return {
    providerId: manifest.id,
    status: detected ? "detected" : "absent",
    confidence,
    evidence,
    warnings: [],
  };
}

export function discoverHarnessProviders(providers) {
  return providers.map((provider) => detectHarnessProvider(provider.manifest));
}

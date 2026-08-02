import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { roborepoStateDir } from "./state-paths.mjs";
import { writeRootConfig } from "./root-config-writes.mjs";
import { getHarnessProvider } from "../harnesses/registry.mjs";
import { requireHarnessCapability } from "../harnesses/runtime.mjs";

export function runtimeAssetDestination(pkg, component) {
  const target = component.target || path.basename(component.source);
  return path.join(roborepoStateDir, "runtime", pkg.id, target);
}

export function installRuntimeAsset(pkg, component, { dryRun = false } = {}) {
  const sourcePath = path.join(repoRoot, component.source);
  const destPath = runtimeAssetDestination(pkg, component);
  if (dryRun) {
    console.log(`  [dry-run] install runtime asset ${component.source} -> ${destPath}`);
    return destPath;
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(sourcePath, destPath);
  fs.chmodSync(destPath, fs.statSync(sourcePath).mode | 0o755);
  console.log(`  runtime asset: ${destPath}`);
  return destPath;
}

export function removeRuntimeAsset(pkg, component, { dryRun = false } = {}) {
  const destPath = runtimeAssetDestination(pkg, component);
  if (dryRun) {
    console.log(`  [dry-run] remove runtime asset ${destPath}`);
    return;
  }
  try {
    fs.unlinkSync(destPath);
    console.log(`  removed runtime asset: ${destPath}`);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    console.log(`  ok: runtime asset already absent: ${destPath}`);
  }
}

export function readHarnessConfig(component, pkg) {
  const data = JSON.parse(fs.readFileSync(path.join(repoRoot, component.source), "utf8"));
  return expandRuntimeRefs(data, runtimeSubstitutions(pkg));
}

function runtimeSubstitutions(pkg) {
  return new Map(
    (pkg.components || [])
      .filter((component) => component.type === "runtime-asset")
      .map((component) => [path.basename(component.source), runtimeAssetDestination(pkg, component)])
  );
}

function expandRuntimeRefs(value, substitutions) {
  if (typeof value === "string") {
    return value.replace(/\$\{runtime:([^}]+)\}/g, (match, name) => substitutions.get(name) || match);
  }
  if (Array.isArray(value)) return value.map((entry) => expandRuntimeRefs(entry, substitutions));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, expandRuntimeRefs(entry, substitutions)]));
  }
  return value;
}

// Orchestrator only: reads the component config once, dispatches to the owning provider's
// rootConfig.mergePackageComponent/unmergePackageComponent, and performs the actual write for
// providers that return computed content rather than writing themselves (Codex's TOML path;
// Claude's JSON path writes directly via the caller-supplied writeSettings, matching how the rest
// of the Claude root-config write surface already works). Provider adapters cannot call
// writeRootConfig themselves without recreating the paths.mjs/registry.mjs import cycle this
// module already sits above.
export function mergeHarnessConfig(pkg, component, options) {
  const provider = getHarnessProvider(component.harness);
  requireHarnessCapability(provider, "package-config");
  const config = readHarnessConfig(component, pkg);
  const result = provider.adapters.rootConfig.mergePackageComponent(pkg, config, options);
  applyPackageComponentResult(component.harness, options, result, "wired");
}

export function unmergeHarnessConfig(pkg, component, options) {
  const provider = getHarnessProvider(component.harness);
  requireHarnessCapability(provider, "package-config");
  const config = readHarnessConfig(component, pkg);
  const result = provider.adapters.rootConfig.unmergePackageComponent(pkg, config, options);
  applyPackageComponentResult(component.harness, options, result, "removed");
}

// Some providers' mergePackageComponent/unmergePackageComponent return { changed, content } instead
// of writing directly (Codex's TOML path today; any future provider following that same
// convention), so there is nothing to apply here for a provider that writes inline (Claude's JSON
// path writes directly via the caller-supplied writeSettings and returns undefined). The target
// path comes from the caller-supplied `options` (keyed `<harness>ConfigPath`, e.g.
// `codexConfigPath`) rather than the registry's rootConfigActive map, since callers — including
// this file's own characterization tests — legitimately point at a path other than the real active
// root config (a scratch fixture, a roundtrip-test sandbox, etc.); the registry only knows the real
// one. Dispatches generically off the harness id for the write call and log label, mirroring
// hook-composition.mjs's writeHooksFile — the identical two-shape asymmetry, already solved there.
function applyPackageComponentResult(harness, options, result, verb) {
  if (!result) return;
  const { changed, content } = result;
  const configPath = options[`${harness}ConfigPath`];
  const label = getHarnessProvider(harness).manifest.displayName;
  if (!changed) {
    console.log(`  ok: ${label} package config unchanged -> ${configPath}`);
    return;
  }
  writeRootConfig(harness, configPath, content);
  const arrow = verb === "removed" ? "<-" : "->";
  console.log(`  ${verb}: ${label} package config ${arrow} ${configPath}`);
}

export function codexStatusLineIncludes(configText, item) {
  const match = configText.match(/^\[tui\]\s*\n([\s\S]*?)(?=^\[|\s*$)/m);
  if (!match) return false;
  const array = match[1].match(/^status_line\s*=\s*\[([^\]]*)\]/m);
  if (!array) return false;
  return [...array[1].matchAll(/"((?:\\.|[^"\\])*)"/g)]
    .map((entry) => JSON.parse(`"${entry[1]}"`))
    .includes(item);
}

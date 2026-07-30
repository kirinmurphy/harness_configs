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
  applyPackageComponentResult(options, result, "wired");
}

export function unmergeHarnessConfig(pkg, component, options) {
  const provider = getHarnessProvider(component.harness);
  requireHarnessCapability(provider, "package-config");
  const config = readHarnessConfig(component, pkg);
  const result = provider.adapters.rootConfig.unmergePackageComponent(pkg, config, options);
  applyPackageComponentResult(options, result, "removed");
}

// Codex's mergePackageComponent/unmergePackageComponent return { changed, content } instead of
// writing directly (see the comment above); Claude's write inline via writeSettings and return
// undefined, so there is nothing to apply here.
function applyPackageComponentResult({ codexConfigPath }, result, verb) {
  if (!result) return;
  const { changed, content } = result;
  if (!changed) {
    console.log(`  ok: Codex tui.status_line unchanged -> ${codexConfigPath}`);
    return;
  }
  writeRootConfig("codex", codexConfigPath, content);
  const arrow = verb === "removed" ? "<-" : "->";
  console.log(`  ${verb}: Codex tui.status_line ${arrow} ${codexConfigPath}`);
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

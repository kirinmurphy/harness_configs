// Resolves a harness provider's declarative manifest paths into absolute filesystem paths.
// Manifests declare home-relative paths ("~/.claude/settings.json") plus a kind (file|directory);
// this module is the single place that expands them, applies any platform override, and answers
// path lookups for core consumers so nothing outside a provider hardcodes ~/.claude or ~/.codex.

import os from "node:os";
import path from "node:path";

function expandHome(homeRelativePath) {
  return path.join(os.homedir(), homeRelativePath.slice(2));
}

// Platform overrides are layered onto the base path map, not replacements for it: a manifest that
// only needs a different Windows home still inherits every other declared path.
function effectivePathMap(manifest, platform = process.platform) {
  const override = manifest.platforms?.[platform]?.paths ?? {};
  return { ...manifest.paths, ...override };
}

export function resolveHarnessPaths(manifest, { platform = process.platform } = {}) {
  const map = effectivePathMap(manifest, platform);
  return Object.fromEntries(
    Object.entries(map).map(([key, entry]) => [key, { path: expandHome(entry.path), kind: entry.kind }])
  );
}

// Single named path, for the common case where a caller wants one location and should fail loudly
// (rather than get undefined) if the provider doesn't declare it.
export function resolveHarnessPath(manifest, key, { platform = process.platform } = {}) {
  const entry = effectivePathMap(manifest, platform)[key];
  if (!entry) {
    throw new Error(`harness provider "${manifest.id}" does not declare path "${key}"`);
  }
  return expandHome(entry.path);
}

export function hasHarnessPath(manifest, key, { platform = process.platform } = {}) {
  return Boolean(effectivePathMap(manifest, platform)[key]);
}

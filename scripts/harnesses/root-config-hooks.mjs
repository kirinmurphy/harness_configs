// Shared read/merge/unmerge wrapper for providers whose hooks live nested under a JSON root
// config's "hooks" key — Claude's settings.json and Gemini's settings.json share this exact shape
// (a plain object with other top-level keys alongside "hooks"), unlike Codex's dedicated hooks.json
// sidecar, whose whole file content IS the hooks map (see codex/index.mjs's own readHooksFile, a
// genuinely different shape, not folded in here).
//
// Reads the file itself (plain fs, no paths.mjs) and returns { changed, content } rather than
// writing — the orchestrator performs the actual write, same pattern as every other provider
// adapter capability in this migration.

import fs from "node:fs";
import { isHooksMap, mergeHooksMap, unmergeHooksMap } from "./hooks-merge.mjs";

export function readRootConfigHooks(settingsPath) {
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
  return { settings, hooks: isHooksMap(settings.hooks) ? settings.hooks : {} };
}

export function mergeRootConfigHooks(settingsPath, hooksFragment) {
  const { settings, hooks } = readRootConfigHooks(settingsPath);
  const { hooks: nextHooks, added } = mergeHooksMap(hooks, hooksFragment);
  const nextSettings = { ...settings, hooks: nextHooks };
  return { changed: added > 0, content: `${JSON.stringify(nextSettings, null, 2)}\n` };
}

export function unmergeRootConfigHooks(settingsPath, hooksFragment) {
  const { settings, hooks } = readRootConfigHooks(settingsPath);
  const { hooks: nextHooks, removed } = unmergeHooksMap(hooks, hooksFragment);
  const nextSettings = { ...settings };
  if (Object.keys(nextHooks).length > 0) nextSettings.hooks = nextHooks;
  else delete nextSettings.hooks;
  return { changed: removed > 0, content: `${JSON.stringify(nextSettings, null, 2)}\n` };
}

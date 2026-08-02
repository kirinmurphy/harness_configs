import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { repoRoot } from "./paths.mjs";
import { writeRootConfig } from "./root-config-writes.mjs";
import { getHarnessProvider } from "../harnesses/registry.mjs";
import {
  resolveBehaviors,
  resolveArbitraryCommands,
  renderCodexConfig,
  renderCodexRules,
  claudePermissions,
  renderClaudeSettings,
} from "../harnesses/permissions-render.mjs";
import { GENERATED_POLICY_FILENAME } from "../harnesses/gemini/policy-toml.mjs";

// Orchestration + manifest loading for agent-permission rendering. The pure render core
// (resolveBehaviors, renderClaudeSettings, renderCodexConfig, ...) lives in
// scripts/harnesses/permissions-render.mjs, re-exported here for existing consumers, so both the
// build entrypoint (scripts/build/render-agent-permissions.mjs, repo SOURCE) and the config
// controls (renderPermissionsToHome, a consumer's LIVE home config) keep importing from this one
// module. Provider adapters (scripts/harnesses/{claude,codex}/index.mjs) import the pure module
// directly instead, since this module's writeRootConfig import pulls in paths.mjs's registry-
// dependent half and would cycle back into a provider importing this file.
export { resolveBehaviors, resolveArbitraryCommands, renderCodexConfig, renderCodexRules, claudePermissions, renderClaudeSettings };

const manifestPath = path.join(repoRoot, "manifests", "inventory", "agent-permissions.json");

export function loadPermissionManifest(p = manifestPath) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Render the manifest (+ overrides) into each present harness's live config under `baseDir`.
// Always global scope — no project override. `createClaude` retained for callers that might target
// a fresh directory (e.g. a scratch/test harness home); default global-only usage never needs it.
// `overrides` is the FULL override-file shape: { behaviors: {id: bucket}, commands: {key: {tokens, bucket}} }.
//
// Dispatches through each provider's permissions.render adapter for the actual render (Claude:
// settings.json's permissions key; Codex: config.toml's generated marker block; Gemini: a whole
// roborepo-owned *.toml file inside the Policy Engine's ~/.gemini/policies/ directory) — this
// function keeps only the create/existence-gating policy, which is genuinely per-provider behavior,
// not a render concern: Claude materializes settings.json from nothing when its dir exists (or
// createClaude is set); Codex never fabricates config.toml, only rewrites one that already exists;
// Gemini writes its one owned file whenever its home dir is present, same "create on first touch"
// posture as Claude (Gemini's file is never a pre-existing user file to merge into — roborepo fully
// owns it — so there's no Codex-style "don't fabricate" concern).
export function renderPermissionsTo(baseDir, { manifest = loadPermissionManifest(), overrides = {}, createClaude = false } = {}) {
  const claudeDir = path.join(baseDir, ".claude");
  const claudeSettings = path.join(claudeDir, "settings.json");
  const codexConfig = path.join(baseDir, ".codex", "config.toml");
  const geminiDir = path.join(baseDir, ".gemini");
  const geminiPolicy = path.join(geminiDir, "policies", GENERATED_POLICY_FILENAME);
  const touched = [];

  if (createClaude || fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
    const cur = fs.existsSync(claudeSettings) ? fs.readFileSync(claudeSettings, "utf8") : "";
    const rendered = getHarnessProvider("claude").adapters.permissions.render(cur, manifest, overrides, claudeSettings);
    writeRootConfig("claude", claudeSettings, rendered);
    touched.push(claudeSettings);
  }
  if (fs.existsSync(codexConfig)) {
    // Only rewrite Codex config if it already exists — we merge into a generated marker block and
    // don't want to fabricate a config.toml from nothing.
    const cur = fs.readFileSync(codexConfig, "utf8");
    const rendered = getHarnessProvider("codex").adapters.permissions.render(cur, manifest, overrides, codexConfig);
    writeRootConfig("codex", codexConfig, rendered);
    touched.push(codexConfig);
  }
  if (fs.existsSync(geminiDir)) {
    fs.mkdirSync(path.dirname(geminiPolicy), { recursive: true });
    const rendered = getHarnessProvider("gemini").adapters.permissions.render("", manifest, overrides, geminiPolicy);
    writeRootConfig("gemini", geminiPolicy, rendered);
    touched.push(geminiPolicy);
  }
  return { touched };
}

// Back-compat shim: global-scope render into the home dir.
export function renderPermissionsToHome({ home = os.homedir(), manifest = loadPermissionManifest(), overrides = {} } = {}) {
  return renderPermissionsTo(home, { manifest, overrides });
}

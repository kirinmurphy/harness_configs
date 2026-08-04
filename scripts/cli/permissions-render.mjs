import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { repoRoot } from "./paths.mjs";
import { writeRootConfig } from "./root-config-writes.mjs";
import { listHarnessProviders } from "../harnesses/registry.mjs";
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

// Where a provider's rendered permissions land, relative to its home dir, and whether roborepo may
// create the file from nothing. Derived from the provider manifest's declared permissionsStorage
// so a new provider needs no edit here:
//
//   - "generated-file-in-directory": roborepo fully owns a dedicated file (Gemini's Policy Engine
//     TOML in ~/.gemini/policies/). Never a pre-existing user file, so always safe to create.
//   - anything else: the permissions live inside the provider's own root config, which the user
//     may also hand-edit. Created only when the harness home already exists, and (for providers
//     whose root config roborepo does not fabricate) only when the file itself already exists.
//
// The render itself is entirely the provider's business — this function owns only the
// create/existence gating, which is platform policy about not fabricating user files.
function permissionsTargetFor(manifest, baseDir) {
  const roborepo = manifest.extensions?.roborepo ?? {};
  const homeRel = manifest.paths?.home?.path?.replace(/^~\//, "");
  if (!homeRel) return null;
  const homeDir = path.join(baseDir, homeRel);

  if (roborepo.permissionsStorage === "policy-engine-toml-directory") {
    const dirRel = manifest.paths?.policies?.path?.replace(/^~\//, "");
    if (!dirRel) return null;
    return { file: path.join(baseDir, dirRel, GENERATED_POLICY_FILENAME), homeDir, mayCreate: true, seedCurrent: false };
  }

  const rootRel = manifest.paths?.rootConfig?.path?.replace(/^~\//, "");
  if (!rootRel) return null;
  // JSON root configs are materialized from nothing (Claude's settings.json); non-JSON ones are
  // only rewritten in place (Codex's config.toml is never fabricated by roborepo).
  const mayCreate = roborepo.rootConfigFormat === "json";
  return { file: path.join(baseDir, rootRel), homeDir, mayCreate, seedCurrent: true };
}

// Render the manifest (+ overrides) into each present harness's live config under `baseDir`.
// Always global scope — no project override. `createClaude` retained for callers that might target
// a fresh directory (e.g. a scratch/test harness home); default global-only usage never needs it.
// `overrides` is the FULL override-file shape: { behaviors: {id: bucket}, commands: {key: {tokens, bucket}} }.
//
// Iterates the provider registry rather than a fixed provider list, so a newly registered harness
// receives permissions without editing this function. A provider that does not declare the
// "permissions" capability is skipped by contract, not by omission.
export function renderPermissionsTo(baseDir, { manifest = loadPermissionManifest(), overrides = {}, createClaude = false } = {}) {
  const touched = [];

  for (const provider of listHarnessProviders()) {
    if (!provider.manifest.capabilities.includes("permissions")) continue;
    const target = permissionsTargetFor(provider.manifest, baseDir);
    if (!target) continue;

    // `createClaude` is a legacy caller affordance for materializing a scratch harness home; it
    // applies to whichever provider roborepo may create a root config for.
    const forceCreate = createClaude && target.mayCreate;
    const homeExists = fs.existsSync(target.homeDir);
    const fileExists = fs.existsSync(target.file);
    if (!forceCreate && !fileExists && !(homeExists && target.mayCreate)) continue;

    fs.mkdirSync(path.dirname(target.file), { recursive: true });
    const cur = target.seedCurrent && fileExists ? fs.readFileSync(target.file, "utf8") : "";
    const rendered = provider.adapters.permissions.render(cur, manifest, overrides, target.file);
    writeRootConfig(provider.id, target.file, rendered);
    touched.push(target.file);
  }

  return { touched };
}

// Back-compat shim: global-scope render into the home dir.
export function renderPermissionsToHome({ home = os.homedir(), manifest = loadPermissionManifest(), overrides = {} } = {}) {
  return renderPermissionsTo(home, { manifest, overrides });
}

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPermissionManifest,
  resolveProfile,
  renderCodexConfig,
  renderCodexRules,
  renderClaudeSettings,
} from "../cli/permissions-render.mjs";

// Build entrypoint: renders the active agent permission profile into the repo SOURCE config
// (globals/). The reusable render core lives in scripts/cli/permissions-render.mjs so the CLI stays
// self-contained; the config controls render the same logic into a consumer's LIVE home config.
// `roborepo permissions` and doctor --check run this script.

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const codexConfigPath = path.join(repoRoot, "globals", "codex", "config.toml");
const codexRulesPath = path.join(repoRoot, "globals", "codex", "rules", "default.rules");
const claudeSettingsPath = path.join(repoRoot, "globals", "claude", "settings.json");

let check = false;
let profileName;
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === "--check") check = true;
  else if (arg === "--profile") profileName = process.argv[++i];
  else if (arg.startsWith("--profile=")) profileName = arg.slice("--profile=".length);
  else {
    console.error("usage: render-agent-permissions.mjs [--check] [--profile <name>]");
    process.exit(2);
  }
}

const manifest = loadPermissionManifest();
let resolved;
try {
  resolved = resolveProfile(manifest, profileName);
} catch (err) {
  console.error(err.message);
  process.exit(2);
}
const { name, profile } = resolved;

function checkOrWrite(target, rendered, label) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (current === rendered) {
    if (check) console.log(`ok: ${label} generated permissions current`);
    return true;
  }
  if (check) {
    console.error(`fail: ${label} generated permissions drifted`);
    return false;
  }
  fs.writeFileSync(target, rendered);
  console.log(`render: ${path.relative(repoRoot, target)}`);
  return true;
}

let ok = true;
try {
  ok = checkOrWrite(codexConfigPath, renderCodexConfig(fs.readFileSync(codexConfigPath, "utf8"), profile, name, codexConfigPath), "globals/codex/config.toml") && ok;
  ok = checkOrWrite(codexRulesPath, renderCodexRules(manifest), "globals/codex/rules/default.rules") && ok;
  ok = checkOrWrite(claudeSettingsPath, renderClaudeSettings(fs.readFileSync(claudeSettingsPath, "utf8"), manifest, profile), "globals/claude/settings.json") && ok;
} catch (error) {
  console.error(error?.message || String(error));
  process.exit(1);
}
process.exit(ok ? 0 : 1);

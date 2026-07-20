#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPermissionManifest,
  resolveBehaviors,
  resolveArbitraryCommands,
  renderCodexConfig,
  renderCodexRules,
  renderClaudeSettings,
} from "../cli/permissions-render.mjs";

// Build entrypoint: renders the manifest's default behaviors into the committed generated system
// candidate (generated/). The reusable render core lives in scripts/cli/permissions-render.mjs so
// the CLI stays self-contained; the config controls render the same logic into a consumer's LIVE
// home config. `roborepo permissions` and doctor --check run this script. The generated candidate
// never carries personal overrides — it always renders the manifest's own default buckets, unmodified.

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const codexConfigPath = path.join(repoRoot, "generated", "codex", "config.toml");
const codexRulesPath = path.join(repoRoot, "generated", "codex", "rules", "default.rules");
const claudeSettingsPath = path.join(repoRoot, "generated", "claude", "settings.json");

let check = false;
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === "--check") check = true;
  else {
    console.error("usage: render-agent-permissions.mjs [--check]");
    process.exit(2);
  }
}

const manifest = loadPermissionManifest();
const behaviors = resolveBehaviors(manifest);
const arbitraryCommands = resolveArbitraryCommands(manifest);

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
  ok = checkOrWrite(codexConfigPath, renderCodexConfig(fs.readFileSync(codexConfigPath, "utf8"), behaviors, arbitraryCommands, codexConfigPath), "generated/codex/config.toml") && ok;
  ok = checkOrWrite(codexRulesPath, renderCodexRules(manifest), "generated/codex/rules/default.rules") && ok;
  ok = checkOrWrite(claudeSettingsPath, renderClaudeSettings(fs.readFileSync(claudeSettingsPath, "utf8"), manifest), "generated/claude/settings.json") && ok;
} catch (error) {
  console.error(error?.message || String(error));
  process.exit(1);
}
process.exit(ok ? 0 : 1);

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPermissionManifest } from "../cli/permissions-render.mjs";
import { renderCodexRules } from "../harnesses/permissions-render.mjs";
import { listHarnessProviders } from "../harnesses/registry.mjs";

// Build entrypoint: renders the manifest's default behaviors into the committed generated system
// candidate (generated/<provider-id>/). Per-provider rendering goes through each provider's own
// `permissions.render` adapter (scripts/harnesses/{claude,codex}/index.mjs) so this script stays
// generic over the provider registry instead of hardcoding Claude/Codex; the config controls render
// the same adapter logic into a consumer's LIVE home config. `roborepo permissions` and
// doctor --check run this script. The generated candidate never carries personal overrides — it
// always renders the manifest's own default buckets, unmodified.
//
// Codex additionally renders a `rules/default.rules` prefix-rule sidecar with no analog in Claude's
// settings.json — Codex's approval model needs an extra file the shared `permissions.render`
// capability doesn't cover, so that one output stays an explicit codex-only step below rather than
// forcing every provider's render into one shape.

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");

// Provider manifest paths are home-relative (e.g. "~/.claude/settings.json"); the generated
// candidate mirrors just the basename under generated/<provider-id>/.
function generatedRootConfigPath(provider) {
  const basename = path.basename(provider.manifest.paths.rootConfig.path);
  return path.join(repoRoot, "generated", provider.id, basename);
}

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
  for (const provider of listHarnessProviders()) {
    if (!provider.manifest.capabilities.includes("permissions")) continue;
    const target = generatedRootConfigPath(provider);
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    const rendered = provider.adapters.permissions.render(current, manifest, {}, target);
    ok = checkOrWrite(target, rendered, path.relative(repoRoot, target)) && ok;
  }

  const codexRulesPath = path.join(repoRoot, "generated", "codex", "rules", "default.rules");
  ok = checkOrWrite(codexRulesPath, renderCodexRules(manifest), "generated/codex/rules/default.rules") && ok;
} catch (error) {
  console.error(error?.message || String(error));
  process.exit(1);
}
process.exit(ok ? 0 : 1);

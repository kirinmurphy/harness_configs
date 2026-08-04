// Generic single-server add/remove for every MCP-capable provider that registers by writing its
// own config file directly (no CLI shell-out) — Codex, Gemini, and any future provider following
// the same shape. Claude stays a separate, explicit path in mcp.mjs/packages.mjs since it
// genuinely differs: it shells to the real `claude` CLI and has a permission-grant side effect
// neither Codex nor Gemini has.
//
// Split out of mcp.mjs into its own leaf module (no mcp-presets.mjs import, so no eager
// loadMcpPresets() call) so packages.mjs can use these helpers without paying for mcp.mjs's
// module-load-time preset read — packages.mjs's installMcpPreset/removeMcpPreset need these
// generic helpers but never touch mcpPresets at all.

import fs from "node:fs";
import { rootConfigActive } from "./paths.mjs";
import { displayPath } from "./mcp-config.mjs";
import { writeRootConfig } from "./root-config-writes.mjs";
import { listHarnessProviders } from "../harnesses/registry.mjs";
import { validateAdapterComputeResult } from "../harnesses/schemas.mjs";

export function configFileMcpProviders() {
  return listHarnessProviders().filter(
    (provider) => provider.id !== "claude" && provider.manifest.capabilities.includes("mcp"),
  );
}

// Log labels use a capitalized provider id (Codex, Gemini), not manifest.displayName ("Gemini CLI")
// — preserves the exact log text callers/tests already pin, independent of how a provider chooses
// to phrase its human-readable display name.
export function capitalize(id) {
  return id[0].toUpperCase() + id.slice(1);
}

export function ensureConfigFileMcp(provider, spec, { dryRun = false, configPath = rootConfigActive[provider.id] } = {}) {
  const label = capitalize(provider.id);
  if (provider.adapters.mcp.list({ configPath }).includes(spec.name)) {
    console.log(`${provider.id} MCP already present: ${spec.name}`);
    return;
  }
  const addResult = provider.adapters.mcp.addServer(spec, { configPath });
  validateAdapterComputeResult(addResult);
  const { content } = addResult;
  if (dryRun) {
    console.log(`would add ${label} MCP: ${spec.name} -> ${configPath}`);
    const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
    const preview = content.slice(existing.length).trim();
    if (preview) console.log(preview);
    return;
  }
  writeRootConfig(provider.id, configPath, content);
  console.log(`${provider.id} MCP added: ${spec.name} -> ${displayPath(configPath)}`);
}

export function removeConfigFileMcp(provider, name, { dryRun = false, configPath = rootConfigActive[provider.id] } = {}) {
  const label = capitalize(provider.id);
  const removeResult = provider.adapters.mcp.removeServer(name, { configPath });
  validateAdapterComputeResult(removeResult);
  const { changed, content } = removeResult;
  if (!changed) {
    console.log(`ok: ${label} MCP already absent: ${name}`);
    return;
  }
  if (dryRun) {
    console.log(`would remove ${label} MCP: ${name} <- ${configPath}`);
    return;
  }
  writeRootConfig(provider.id, configPath, content);
  console.log(`${provider.id} MCP removed: ${name} <- ${displayPath(configPath)}`);
}

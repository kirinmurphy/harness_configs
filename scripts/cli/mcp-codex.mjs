import fs from "node:fs";
import { ACTIVE_CODEX_CONFIG_PATH, displayPath } from "./mcp-config.mjs";
import { writeRootConfig } from "./root-config-writes.mjs";
import { addCodexMcpBlock, removeCodexMcpBlock, codexHasMcp } from "../harnesses/mcp-codex-toml.mjs";

// The pure TOML block math (addCodexMcpBlock/removeCodexMcpBlock) lives in
// scripts/harnesses/mcp-codex-toml.mjs (a leaf module with zero registry-touching imports) so the
// Codex provider adapter can call it directly; re-exported here as thin orchestrator wrappers that
// add the file read/write and console logging existing callers (mcp.mjs, packages.mjs) expect.

export function ensureCodexMcp(spec, { dryRun = false, configPath = ACTIVE_CODEX_CONFIG_PATH } = {}) {
  let configText;
  try {
    configText = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") configText = "";
    else {
      console.error(`failed to read ${configPath}: ${err.message}`);
      process.exit(1);
    }
  }

  if (codexHasMcp(configText, spec.name)) {
    console.log(`codex MCP already present: ${spec.name}`);
    return;
  }

  if (dryRun) {
    const { content } = addCodexMcpBlock(configText, spec);
    console.log(`would add Codex MCP: ${spec.name} -> ${configPath}`);
    console.log(content.slice(configText.length).trim());
    return;
  }

  const { content } = addCodexMcpBlock(configText, spec);
  writeRootConfig("codex", configPath, content);
  console.log(`codex MCP added: ${spec.name} -> ${displayPath(configPath)}`);
}

export function removeCodexMcp(serverName, { dryRun = false, configPath = ACTIVE_CODEX_CONFIG_PATH } = {}) {
  let configText = "";
  try {
    configText = fs.readFileSync(configPath, "utf8");
  } catch {
    console.log(`ok: Codex MCP already absent: ${serverName}`);
    return;
  }

  const { changed, content } = removeCodexMcpBlock(configText, serverName);
  if (!changed) {
    console.log(`ok: Codex MCP already absent: ${serverName}`);
    return;
  }
  if (dryRun) {
    console.log(`would remove Codex MCP: ${serverName} <- ${configPath}`);
    return;
  }

  writeRootConfig("codex", configPath, content);
  console.log(`codex MCP removed: ${serverName} <- ${displayPath(configPath)}`);
}

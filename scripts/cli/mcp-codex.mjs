import fs from "node:fs";
import { ACTIVE_CODEX_CONFIG_PATH, displayPath } from "./mcp-config.mjs";
import { isHttpUrl } from "./mcp-parse.mjs";
import { writeRootConfig } from "./root-config-writes.mjs";

function tomlString(value) {
  return JSON.stringify(value);
}

function tomlArray(values) {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlTableKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

function codexMcpBlock(spec) {
  const lines = [`[mcp_servers.${tomlTableKey(spec.name)}]`];
  if (isHttpUrl(spec.commandOrUrl)) {
    lines.push(`url = ${tomlString(spec.commandOrUrl)}`);
  } else {
    lines.push(`command = ${tomlString(spec.commandOrUrl)}`);
    lines.push(`args = ${tomlArray(spec.args)}`);
  }
  return lines.join("\n");
}

function codexHasMcp(configText, serverName) {
  const bare = serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quoted = tomlString(serverName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\[mcp_servers\\.(?:${bare}|${quoted})\\]$`, "m").test(configText);
}

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

  const block = codexMcpBlock(spec);
  if (dryRun) {
    console.log(`would add Codex MCP: ${spec.name} -> ${configPath}`);
    console.log(block);
    return;
  }

  const prefix = configText.endsWith("\n") ? configText : `${configText}\n`;
  writeRootConfig("codex", configPath, `${prefix}\n${block}\n`);
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

  // Header-boundary removal. A char-class scan like `[^[]*` truncates blocks whose values contain
  // `[` (TOML arrays such as `args = ["--foo"]`), so we split on top-level [section] headers and
  // drop the block whose header is `[mcp_servers.<name>]`.
  const targetHeaders = new Set([`[mcp_servers.${serverName}]`, `[mcp_servers.${JSON.stringify(serverName)}]`]);
  const lines = configText.split(/\r?\n/);
  const kept = [];
  let dropping = false;
  let removed = false;
  for (const line of lines) {
    if (/^\[[^\]]+\]\s*$/.test(line.trim())) {
      dropping = targetHeaders.has(line.trim());
      if (dropping) removed = true;
    }
    if (!dropping) kept.push(line);
  }

  if (!removed) {
    console.log(`ok: Codex MCP already absent: ${serverName}`);
    return;
  }
  if (dryRun) {
    console.log(`would remove Codex MCP: ${serverName} <- ${configPath}`);
    return;
  }

  const next = `${kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
  writeRootConfig("codex", configPath, next);
  console.log(`codex MCP removed: ${serverName} <- ${displayPath(configPath)}`);
}

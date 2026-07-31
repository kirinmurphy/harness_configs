// Pure Codex MCP TOML block read/add/remove logic, extracted from scripts/cli/mcp-codex.mjs so the
// Codex provider adapter (scripts/harnesses/codex/index.mjs) can call it without importing
// scripts/cli/mcp-codex.mjs directly — that module's mcp-config.mjs import pulls in paths.mjs's
// registry-dependent half (rootConfigActive/rootConfigBaseline) at module-load time, cycling back
// through registry.mjs into the importing provider. This module has zero such imports; isHttpUrl
// is duplicated from scripts/cli/mcp-parse.mjs rather than imported, for the same reason —
// mcp-parse.mjs's own top-level import of mcp-config.mjs pulls in the registry too.

export function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

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

export function codexHasMcp(configText, serverName) {
  const bare = serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quoted = tomlString(serverName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\[mcp_servers\\.(?:${bare}|${quoted})\\]$`, "m").test(configText);
}

// Returns { changed, content } without writing — the caller performs the actual write, same
// pattern as every other provider adapter in this migration.
export function addCodexMcpBlock(configText, spec) {
  if (codexHasMcp(configText, spec.name)) return { changed: false, content: configText };
  const block = codexMcpBlock(spec);
  const prefix = configText.endsWith("\n") || configText === "" ? configText : `${configText}\n`;
  return { changed: true, content: `${prefix}\n${block}\n` };
}

// Header-boundary removal. A char-class scan like `[^[]*` truncates blocks whose values contain
// `[` (TOML arrays such as `args = ["--foo"]`), so this splits on top-level [section] headers and
// drops the block whose header is `[mcp_servers.<name>]`.
export function removeCodexMcpBlock(configText, serverName) {
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
  if (!removed) return { changed: false, content: configText };
  const next = `${kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
  return { changed: true, content: next };
}

// Server names present in a Codex config's [mcp_servers.*] tables.
export function listCodexMcpServers(configText) {
  const names = [];
  for (const match of configText.matchAll(/^\[mcp_servers\.(.+?)\]\s*$/gm)) {
    let name = match[1];
    if (name.startsWith('"') && name.endsWith('"')) {
      try { name = JSON.parse(name); } catch { /* keep raw */ }
    }
    names.push(name);
  }
  return names;
}

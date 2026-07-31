import fs from "node:fs";
import path from "node:path";
import { loadMcpPresets } from "./mcp-presets.mjs";
import { parseMcpAdd } from "./mcp-parse.mjs";
import { claudeMcpArgs, ensureClaudeMcpPermission, shellQuote } from "./mcp-claude.mjs";
import { ensureCodexMcp } from "./mcp-codex.mjs";
import { MCP_SERVERS_PATH } from "./mcp-config.mjs";
import { initializeWorkspace, packageMode, workspaceMcpServersPath } from "./paths.mjs";
import { hasReplaceOverride, loadWorkspaceMcpServers, readWorkspaceOverrides } from "./workspace-resources.mjs";
import { getHarnessProvider } from "../harnesses/registry.mjs";

const mcpPresets = loadMcpPresets();

function readMcpServers() {
  let builtIn;
  try {
    builtIn = JSON.parse(fs.readFileSync(MCP_SERVERS_PATH, "utf8"));
  } catch {
    return { servers: [] };
  }
  if (!packageMode) return builtIn;
  return { servers: mergeWorkspaceServers(builtIn.servers || []) };
}

function mcpServersPath() {
  return packageMode ? workspaceMcpServersPath : MCP_SERVERS_PATH;
}

// The file we write records to, read raw. In package mode this is the workspace-only file — never
// the built-in+workspace merge that readMcpServers() returns, or built-ins would be copied into the
// workspace file and then trip the built-in conflict guard on the next validate/apply.
function readRecordServers() {
  try {
    return JSON.parse(fs.readFileSync(mcpServersPath(), "utf8"));
  } catch {
    return { servers: [] };
  }
}

function recordMcpServer(spec, target) {
  if (packageMode) initializeWorkspace();
  if (packageMode) assertMcpRecordAllowed(spec.name);
  const data = readRecordServers();
  const existing = data.servers.find((s) => s.name === spec.name);
  const harnesses =
    target === "only-claude" ? ["claude"] :
    target === "only-codex"  ? ["codex"] :
    ["claude", "codex"];

  if (existing) {
    existing.commandOrUrl = spec.commandOrUrl;
    existing.args = spec.args;
    existing.harnesses = harnesses;
    console.log(`mcp-servers.json updated: ${spec.name}`);
  } else {
    data.servers.push({ name: spec.name, commandOrUrl: spec.commandOrUrl, args: spec.args, harnesses });
    console.log(`mcp-servers.json recorded: ${spec.name}`);
  }
  fs.mkdirSync(path.dirname(mcpServersPath()), { recursive: true });
  fs.writeFileSync(mcpServersPath(), `${JSON.stringify(data, null, 2)}\n`);
}

function mergeWorkspaceServers(builtInServers) {
  const overrides = readWorkspaceOverrides();
  const byName = new Map(builtInServers.map((server) => [server.name, server]));
  for (const server of loadWorkspaceMcpServers({ builtInNames: new Set(byName.keys()), overrides })) {
    if (byName.has(server.name) && !hasReplaceOverride("mcp-server", server.name, overrides)) {
      throw new Error(`workspace MCP server '${server.name}' conflicts with built-in server without typed replace override`);
    }
    byName.set(server.name, server);
  }
  return [...byName.values()];
}

function assertMcpRecordAllowed(name) {
  let builtIn = [];
  try {
    builtIn = JSON.parse(fs.readFileSync(MCP_SERVERS_PATH, "utf8")).servers || [];
  } catch {
    return;
  }
  if (!builtIn.some((server) => server.name === name)) return;
  if (hasReplaceOverride("mcp-server", name)) return;
  throw new Error(`MCP server '${name}' is built in; add a typed mcp-server replace override before replacing it`);
}

function claudeHasMcp(serverName) {
  const names = getHarnessProvider("claude").adapters.mcp.list();
  return names.includes(serverName);
}

export function mcpApply({ dryRun = false } = {}) {
  const data = readMcpServers();
  for (const server of data.servers) {
    const spec = { name: server.name, commandOrUrl: server.commandOrUrl, args: server.args };
    const applyClaude = server.harnesses.includes("claude");
    const applyCodex = server.harnesses.includes("codex");
    if (dryRun) {
      if (applyClaude) console.log(`would apply Claude MCP live store: ${server.name}`);
      if (applyCodex) console.log(`would apply Codex MCP active config: ${server.name}`);
      continue;
    }
    if (applyClaude) {
      if (claudeHasMcp(spec.name)) {
        console.log(`claude MCP already present: ${server.name}`);
      } else {
        getHarnessProvider("claude").adapters.mcp.addServer(spec, { scope: "user", transport: null });
      }
    }
    if (applyCodex) ensureCodexMcp(spec);
  }
}

export function mcpAdd(rest) {
  const { opts, spec } = parseMcpAdd(rest, mcpPresets);
  const args = claudeMcpArgs(opts, spec);
  const display = ["claude", ...args].map(shellQuote).join(" ");

  if (opts.dryRun) {
    if (opts.target !== "only-codex") console.log(display);
    if (opts.target !== "only-codex" && opts.updateClaudePermission) {
      console.log(`would add permission: mcp__${spec.name} -> generated/claude/settings.json`);
    }
    if (opts.target !== "only-claude") ensureCodexMcp(spec, { dryRun: true });
    return;
  }

  if (opts.target !== "only-codex") {
    getHarnessProvider("claude").adapters.mcp.addServer(spec, { scope: opts.scope, transport: opts.transport });
    if (opts.updateClaudePermission) ensureClaudeMcpPermission(spec.name);
  }
  if (opts.target !== "only-claude") ensureCodexMcp(spec);
  // Built-in package presets already live in the app's mcp-servers.json; recording them again would
  // duplicate a built-in into the user workspace and trip assertMcpRecordAllowed. Only user-added
  // servers get a workspace record.
  if (!opts.builtIn) recordMcpServer(spec, opts.target);
  process.exit(0);
}

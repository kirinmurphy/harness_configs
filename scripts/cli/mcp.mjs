import fs from "node:fs";
import path from "node:path";
import { loadMcpPresets } from "./mcp-presets.mjs";
import { parseMcpAdd, resolveMcpHarnesses } from "./mcp-parse.mjs";
import { claudeMcpArgs, ensureClaudeMcpPermission, shellQuote } from "./mcp-claude.mjs";
import { ensureCodexMcp } from "./mcp-codex.mjs";
import { MCP_SERVERS_PATH } from "./mcp-config.mjs";
import { initializeWorkspace, packageMode, workspaceMcpServersPath, rootConfigActive } from "./paths.mjs";
import { hasReplaceOverride, loadWorkspaceMcpServers, readWorkspaceOverrides } from "./workspace-resources.mjs";
import { writeRootConfig } from "./root-config-writes.mjs";
import { getHarnessProvider } from "../harnesses/registry.mjs";

const mcpPresets = loadMcpPresets();

// Gemini, like Codex, has a real config file to write into directly (settings.json's mcpServers
// key) — no CLI shell-out like Claude needs. Its addServer adapter already returns {changed,
// content} (scripts/harnesses/gemini/index.mjs), so this is a thin orchestrator wrapper matching
// ensureCodexMcp's shape: resolve the active config path, call the adapter, write via
// writeRootConfig for drift-tracking parity with every other root-config write.
function ensureGeminiMcp(spec, { dryRun = false, configPath = rootConfigActive.gemini } = {}) {
  const provider = getHarnessProvider("gemini");
  if (provider.adapters.mcp.list({ configPath }).includes(spec.name)) {
    console.log(`gemini MCP already present: ${spec.name}`);
    return;
  }
  if (dryRun) {
    console.log(`would add Gemini MCP: ${spec.name} -> ${configPath}`);
    return;
  }
  const { content } = provider.adapters.mcp.addServer(spec, { configPath });
  writeRootConfig("gemini", configPath, content);
  console.log(`gemini MCP added: ${spec.name} -> ${configPath}`);
}

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

function recordMcpServer(spec, harnesses) {
  if (packageMode) initializeWorkspace();
  if (packageMode) assertMcpRecordAllowed(spec.name);
  const data = readRecordServers();
  const existing = data.servers.find((s) => s.name === spec.name);

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
  const harnesses = resolveMcpHarnesses(opts);
  const applyClaude = harnesses.includes("claude");
  const applyCodex = harnesses.includes("codex");
  const applyGemini = harnesses.includes("gemini");
  const args = claudeMcpArgs(opts, spec);
  const display = ["claude", ...args].map(shellQuote).join(" ");

  if (opts.dryRun) {
    if (applyClaude) console.log(display);
    if (applyClaude && opts.updateClaudePermission) {
      console.log(`would add permission: mcp__${spec.name} -> generated/claude/settings.json`);
    }
    if (applyCodex) ensureCodexMcp(spec, { dryRun: true });
    if (applyGemini) ensureGeminiMcp(spec, { dryRun: true });
    return;
  }

  if (applyClaude) {
    getHarnessProvider("claude").adapters.mcp.addServer(spec, { scope: opts.scope, transport: opts.transport });
    if (opts.updateClaudePermission) ensureClaudeMcpPermission(spec.name);
  }
  if (applyCodex) ensureCodexMcp(spec);
  if (applyGemini) ensureGeminiMcp(spec);
  // Built-in package presets already live in the app's mcp-servers.json; recording them again would
  // duplicate a built-in into the user workspace and trip assertMcpRecordAllowed. Only user-added
  // servers get a workspace record.
  if (!opts.builtIn) recordMcpServer(spec, harnesses);
  process.exit(0);
}

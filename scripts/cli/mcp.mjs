import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { loadMcpPresets } from "./mcp-presets.mjs";
import { parseMcpAdd } from "./mcp-parse.mjs";
import { claudeMcpArgs, ensureClaudeMcpPermission, runClaudeMcpAdd, shellQuote } from "./mcp-claude.mjs";
import { ensureCodexMcp } from "./mcp-codex.mjs";
import { MCP_SERVERS_PATH } from "./mcp-config.mjs";

const mcpPresets = loadMcpPresets();

function readMcpServers() {
  try {
    return JSON.parse(fs.readFileSync(MCP_SERVERS_PATH, "utf8"));
  } catch {
    return { servers: [] };
  }
}

function recordMcpServer(spec, target) {
  const data = readMcpServers();
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
  fs.writeFileSync(MCP_SERVERS_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

function claudeHasMcp(serverName) {
  try {
    const result = spawnSync("claude", ["mcp", "list"], { encoding: "utf8" });
    if (result.error || result.status !== 0) return false;
    return result.stdout.includes(`${serverName}:`);
  } catch {
    return false;
  }
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
        const args = claudeMcpArgs({ scope: "user", transport: null }, spec);
        runClaudeMcpAdd(args);
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
      console.log(`would add permission: mcp__${spec.name} -> globals/claude/settings.json`);
    }
    if (opts.target !== "only-claude") ensureCodexMcp(spec, { dryRun: true });
    return;
  }

  if (opts.target !== "only-codex") {
    runClaudeMcpAdd(args);
    if (opts.updateClaudePermission) ensureClaudeMcpPermission(spec.name);
  }
  if (opts.target !== "only-claude") ensureCodexMcp(spec);
  recordMcpServer(spec, opts.target);
  process.exit(0);
}

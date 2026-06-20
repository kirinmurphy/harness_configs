import path from "node:path";
import { repoRoot } from "./paths.mjs";

export const MCP_PRESETS_PATH = path.join(repoRoot, "manifests", "inventory", "mcp-presets.json");
export const MCP_SERVERS_PATH = path.join(repoRoot, "manifests", "inventory", "mcp-servers.json");
export const CLAUDE_SETTINGS_PATH = path.join(repoRoot, "globals", "claude", "settings.json");
export const CODEX_CONFIG_PATH = path.join(repoRoot, "globals", "codex", "config.toml");

export const MCP_SCOPES = ["user", "local", "project"];
export const MCP_TRANSPORTS = ["stdio", "sse", "http"];

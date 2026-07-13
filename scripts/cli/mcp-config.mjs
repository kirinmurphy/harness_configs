import path from "node:path";
import { repoRoot, rootConfigActive, rootConfigBaseline } from "./paths.mjs";

export const MCP_PRESETS_PATH = path.join(repoRoot, "manifests", "inventory", "mcp-presets.json");
export const MCP_SERVERS_PATH = path.join(repoRoot, "manifests", "inventory", "mcp-servers.json");
export const CLAUDE_SETTINGS_PATH = rootConfigBaseline.claude;
export const CODEX_CONFIG_PATH = rootConfigBaseline.codex;
export const ACTIVE_CODEX_CONFIG_PATH = rootConfigActive.codex;

export const MCP_SCOPES = ["user", "local", "project"];
export const MCP_TRANSPORTS = ["stdio", "sse", "http"];

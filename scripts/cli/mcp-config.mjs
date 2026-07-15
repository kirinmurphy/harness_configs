import path from "node:path";
import { repoRoot, rootConfigActive, rootConfigBaseline } from "./paths.mjs";

export const MCP_PRESETS_PATH = path.join(repoRoot, "manifests", "inventory", "mcp-presets.json");
export const MCP_SERVERS_PATH = path.join(repoRoot, "manifests", "inventory", "mcp-servers.json");
export const CODEX_CONFIG_PATH = rootConfigBaseline.codex;
export const ACTIVE_CODEX_CONFIG_PATH = rootConfigActive.codex;

export const MCP_SCOPES = ["user", "local", "project"];
export const MCP_TRANSPORTS = ["stdio", "sse", "http"];

// Render a config path relative to the repo when it lives inside it (dev checkout), else absolute
// (package mode / user home). Shared by the Claude + Codex MCP writers for consistent log output.
export function displayPath(filePath) {
  const rel = path.relative(repoRoot, filePath);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : filePath;
}

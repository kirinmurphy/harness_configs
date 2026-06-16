import fs from "node:fs";

// Reads a harness transcript (JSONL) and derives the session-level context that explains token
// spikes: cumulative token usage, turn/tool counts, and which tools/MCP servers were exercised.
// Pure local file read — never throws to callers (telemetry hooks must not fail a session).

const MCP_TOOL_PREFIX = "mcp__";

export function transcriptStats(transcriptPath) {
  if (typeof transcriptPath !== "string" || !transcriptPath) return null;
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return null; // No transcript yet (e.g. SessionStart) or unreadable; capture metadata only.
  }
  const tokens = { input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0 };
  const toolCounts = new Map();
  const mcpServers = new Map();
  let assistantTurns = 0;
  let toolCalls = 0;
  let mcpCalls = 0;
  let maxOutputTokens = 0;
  let model = null;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // Skip partial/streaming lines; a half-written tail must not break capture.
    }
    const message = entry.message;
    if (entry.type !== "assistant" || !message) continue;
    assistantTurns += 1;
    if (message.model) model = message.model;
    addUsage(tokens, message.usage);
    if (message.usage) maxOutputTokens = Math.max(maxOutputTokens, message.usage.output_tokens || 0);
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block.type !== "tool_use" || typeof block.name !== "string") continue;
      toolCalls += 1;
      bump(toolCounts, block.name);
      const server = mcpServerOf(block.name);
      if (server) {
        mcpCalls += 1;
        bump(mcpServers, server);
      }
    }
  }
  tokens.total = tokens.input + tokens.output + tokens.cache_creation + tokens.cache_read;

  return {
    model,
    tokens,
    max_output_tokens: maxOutputTokens,
    assistant_turns: assistantTurns,
    tool_calls: toolCalls,
    mcp_calls: mcpCalls,
    tools: Object.fromEntries(toolCounts),
    mcp_servers: Object.fromEntries(mcpServers),
  };
}

export function mcpServerOf(toolName) {
  if (typeof toolName !== "string" || !toolName.startsWith(MCP_TOOL_PREFIX)) return null;
  return toolName.slice(MCP_TOOL_PREFIX.length).split("__")[0] || null;
}

function addUsage(tokens, usage) {
  if (!usage) return;
  tokens.input += usage.input_tokens || 0;
  tokens.output += usage.output_tokens || 0;
  tokens.cache_creation += usage.cache_creation_input_tokens || 0;
  tokens.cache_read += usage.cache_read_input_tokens || 0;
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

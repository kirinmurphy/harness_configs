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

  // Spike attribution: a capture's token delta is driven by what most recently landed in the
  // context window — almost always the previous tool's *result* (a big file Read, an MCP bundle,
  // an unbounded Bash log). We can't see that from tool_use args alone, so we size each tool_result
  // and remember which tool produced it. `toolNameById` links a result back to the call that made
  // it; `lastResult` is the freshest result (the likely cause of *this* capture's delta) and
  // `biggestResult` is the heaviest result in the session (the likely cause of the session's worst
  // spike). Sizes only — never content — so the hash-only privacy model holds.
  const toolNameById = new Map();
  let lastResult = null;
  let biggestResult = null;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // Skip partial/streaming lines; a half-written tail must not break capture.
    }
    const message = entry.message;
    if (!message) continue;

    if (entry.type === "assistant") {
      assistantTurns += 1;
      if (message.model) model = message.model;
      addUsage(tokens, message.usage);
      if (message.usage) maxOutputTokens = Math.max(maxOutputTokens, message.usage.output_tokens || 0);
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block.type !== "tool_use" || typeof block.name !== "string") continue;
        toolCalls += 1;
        bump(toolCounts, block.name);
        if (typeof block.id === "string") toolNameById.set(block.id, block.name);
        const server = mcpServerOf(block.name);
        if (server) {
          mcpCalls += 1;
          bump(mcpServers, server);
        }
      }
      continue;
    }

    // tool_result blocks come back on `user` entries, keyed to the tool_use that produced them.
    if (entry.type === "user") {
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block.type !== "tool_result") continue;
        const tool = toolNameById.get(block.tool_use_id) ?? null;
        const result = { tool, chars: resultChars(block.content), is_error: block.is_error === true };
        lastResult = result;
        if (!biggestResult || result.chars > biggestResult.chars) biggestResult = result;
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
    last_result: lastResult,
    biggest_result: biggestResult,
  };
}

// Size a tool_result's content without retaining it: results are either a plain string or an array
// of content blocks (text/image). We count characters of text and approximate non-text blocks by
// their serialized length, so an oversized result is visible even if it isn't plain prose.
function resultChars(content) {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    return content.reduce((sum, block) => sum + (typeof block?.text === "string" ? block.text.length : safeLen(block)), 0);
  }
  return safeLen(content);
}

function safeLen(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

// Bare MCP tool names → server. Codex logs MCP tools two ways: prefixed (mcp__jcodemunch__foo) AND
// bare (foo). Claude always prefixes, but Codex transcripts often drop the prefix, so a bare name
// like "search_symbols" or "get_file_content" would otherwise be misattributed to a native group.
// This table maps the known jcodemunch/jdocmunch tool names so attribution is correct for both
// harnesses. Sourced from globals/codex/config.toml MCP tool declarations.
const BARE_MCP_TOOLS = {
  jcodemunch: new Set([
    "resolve_repo", "search_text", "search_symbols", "find_references", "get_file_content",
    "get_file_outline", "get_file_tree", "get_repo_outline", "get_context_bundle", "get_ranked_context",
    "get_symbol_source", "get_symbol_importance", "get_related_symbols", "get_changed_symbols",
    "get_project_intel", "get_session_context", "get_watch_status", "get_pr_risk_profile",
    "index_file", "index_folder", "index_repo", "register_edit", "plan_turn", "list_repos",
    "audit_agent_config", "link_code_to_symbols", "load_workspace_dependencies",
  ]),
  jdocmunch: new Set([
    "search_sections", "get_section", "get_sections", "get_section_context", "get_toc", "get_toc_tree",
    "get_document_outline", "get_doc_coverage", "get_broken_links", "doc_list_repos", "list_docs",
    "list_repo_groups", "index_local", "index_repo", "delete_index",
  ]),
};

// The MCP server a tool belongs to, or null for a native tool. Handles both the prefixed wire name
// (mcp__server__tool) and bare jcodemunch/jdocmunch tool names that Codex logs without the prefix.
export function mcpServerOf(toolName) {
  if (typeof toolName !== "string" || !toolName) return null;
  if (toolName.startsWith(MCP_TOOL_PREFIX)) return toolName.slice(MCP_TOOL_PREFIX.length).split("__")[0] || null;
  for (const [server, tools] of Object.entries(BARE_MCP_TOOLS)) {
    if (tools.has(toolName)) return server;
  }
  return null;
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

#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { transcriptStats } from "../cli/telemetry-transcript.mjs";
import { analyzeTelemetry } from "../cli/telemetry-analyze.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-telemetry-correctness-"));

try {
  testClaudeTranscript();
  testCodexTranscript();
  testAnalyzerWarnings();
  console.log("telemetry correctness checks passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function testClaudeTranscript() {
  const file = path.join(tmp, "claude.jsonl");
  writeJsonl(file, [
    {
      type: "assistant",
      message: {
        model: "claude-test",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 5,
          cache_read_input_tokens: 10,
        },
        content: [{ type: "tool_use", id: "t1", name: "Read" }],
      },
    },
    {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t1", content: "x".repeat(120) }],
      },
    },
  ]);

  const stats = transcriptStats(file, { sessionId: "claude-session", collectorDir: tmp });
  assert.equal(stats.tokens.total, 135);
  assert.equal(stats.model, "claude-test");
  assert.equal(stats.tool_calls, 1);
  assert.equal(stats.last_result.tool, "Read");
  assert.equal(stats.last_result.chars, 120);
}

function testCodexTranscript() {
  const file = path.join(tmp, "codex.jsonl");
  writeJsonl(file, [
    {
      type: "event_msg",
      name: "token_count",
      payload: {
        info: {
          total_token_usage: {
            total_tokens: 500,
            input_tokens: 300,
            cached_input_tokens: 80,
            output_tokens: 120,
            reasoning_output_tokens: 40,
          },
        },
        rate_limits: [{ name: "weekly", used_percent: 12.5, window_minutes: 10080 }],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "function_call",
        call_id: "c1",
        name: "mcp__jcodemunch__get_context_bundle",
      },
    },
    {
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "c1",
        output: "bundle output",
      },
    },
  ]);

  const stats = transcriptStats(file, { sessionId: "codex-session", collectorDir: tmp });
  assert.equal(stats.tokens.total, 500);
  assert.equal(stats.tokens.input, 220);
  assert.equal(stats.tokens.cache_read, 80);
  assert.equal(stats.tokens.output, 120);
  assert.equal(stats.mcp_calls, 1);
  assert.equal(stats.mcp_servers.jcodemunch, 1);
  assert.equal(stats.last_result.tool, "mcp__jcodemunch__get_context_bundle");
  assert.equal(stats.details.codex_reasoning_output_tokens, 40);
  assert.equal(stats.details.codex_rate_limits[0].used_percent, 12.5);
}

function testAnalyzerWarnings() {
  const events = [
    baseEvent({ session_id: "doc-session", tool: tool("Read", ".md", "doc-hash"), chars: 12000 }),
    baseEvent({ session_id: "doc-session", tool: tool("Read", ".md", "doc-hash"), chars: 11000 }),
    baseEvent({ session_id: "doc-session", tool: tool("Read", ".md", "large-hash"), chars: 25000 }),
    baseEvent({ session_id: "code-session", tool: tool("mcp__jcodemunch__get_context_bundle", null, null), chars: 2000 }),
    baseEvent({ session_id: "code-session", tool: tool("Read", ".js", "a"), chars: 1000 }),
    baseEvent({ session_id: "code-session", tool: tool("Read", ".js", "b"), chars: 1000 }),
    baseEvent({ session_id: "code-session", tool: tool("Read", ".ts", "c"), chars: 1000 }),
    baseEvent({ session_id: "code-session", tool: tool("Bash", null, null, 20), chars: 1000 }),
    {
      schema: 2,
      ts: "2026-01-01T00:00:09.000Z",
      harness: "codex",
      event: "PostToolUse",
      session_id: "bad-session",
      tokens: { total: 0 },
      details: { unsupported_usage_seen: true },
    },
  ];

  const report = analyzeTelemetry(events);
  assert(report.read_warnings.some((warning) => warning.type === "repeated_document_read"));
  assert(report.read_warnings.some((warning) => warning.type === "large_document_read"));
  assert(report.read_warnings.some((warning) => warning.type === "stale_doc_lookup"));
  assert(report.read_warnings.some((warning) => warning.type === "mixed_code_lookup"));
  assert(report.data_quality_warnings.some((warning) => warning.type === "unsupported_usage_schema"));
}

function baseEvent({ session_id, tool, chars }) {
  return {
    schema: 2,
    ts: "2026-01-01T00:00:00.000Z",
    harness: "codex",
    event: "PostToolUse",
    session_id,
    repo: { label: "repo" },
    tool,
    tokens: { total: 100, input: 80, output: 20, cache_creation: 0, cache_read: 0 },
    delta_tokens: 10,
    session: { tool_calls: 1, mcp_calls: tool.is_mcp ? 1 : 0 },
    last_result: { tool: tool.name, chars, is_error: false },
  };
}

function tool(name, ext, hash, commandChars = 0) {
  const parts = typeof name === "string" ? name.split("__") : [];
  return {
    name,
    is_mcp: name?.startsWith("mcp__") || false,
    mcp_server: parts.length > 2 ? parts[1] : null,
    mcp_tool: parts.length > 2 ? parts.slice(2).join("__") : null,
    file_ext: ext,
    file_path_hash: hash,
    command_chars: commandChars,
  };
}

function writeJsonl(file, records) {
  fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

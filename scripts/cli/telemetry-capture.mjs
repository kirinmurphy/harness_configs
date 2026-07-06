import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { telemetryCollectorDir, telemetryDir, telemetrySpoolDir } from "./state-paths.mjs";
import { mcpServerOf, transcriptStats } from "./telemetry-transcript.mjs";

// Minimal-import capture path, split out of telemetry.mjs so the hot hook (fires on every
// PreToolUse/PostToolUse) doesn't pay to load portal-server/config/presets/telemetry-analyze/
// telemetry-insights just to append one JSONL line. Keep this file's import graph small.

const SCHEMA_VERSION = 2;

export function telemetryCaptureCommand(args) {
  const options = parseCaptureArgs(args);
  const state = readTelemetryState();
  if (state.enabled !== true) return;
  let input = {};
  try {
    const raw = fs.readFileSync(0, "utf8");
    input = raw ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const sessionId = input.session_id || input.conversation_id || null;
  const transcriptPath = input.transcript_path || input.transcriptPath || null;
  const stats = transcriptStats(transcriptPath, { sessionId, collectorDir: telemetryCollectorDir });
  const event = options.event || input.hook_event_name || input.hookEventName || "unknown";
  const tool = toolMetadata(input);
  const record = {
    schema: SCHEMA_VERSION,
    ts: new Date().toISOString(),
    harness: options.harness,
    event,
    session_id: sessionId,
    cwd_hash: hash(cwd),
    // Trailing path segment of the working dir — orients "where" without exposing the full path
    // (which stays hashed in cwd_hash).
    cwd_name: path.basename(cwd),
    repo: repoMetadata(cwd),
    tool,
    // Wall-clock tool latency: PreToolUse stamps a start cursor, PostToolUse reads it back. Null for
    // non-tool events or an unmatched pair. Helps spot slow tools independent of token cost.
    duration_ms: toolDuration(event, sessionId, tool.name),
    prompt: promptMetadata(input),
    tokens: stats ? stats.tokens : null,
    delta_tokens: stats ? deltaTokens(sessionId, stats.tokens.total) : null,
    session: stats
      ? {
          model: stats.model,
          assistant_turns: stats.assistant_turns,
          tool_calls: stats.tool_calls,
          mcp_calls: stats.mcp_calls,
          max_output_tokens: stats.max_output_tokens,
        }
      : null,
    // Likely driver of this capture's delta (freshest tool result to enter context) and the
    // heaviest result seen all session. Sizes/tool names only — no result content is stored.
    last_result: stats ? stats.last_result : null,
    biggest_result: stats ? stats.biggest_result : null,
  };
  ensureTelemetryDirs();
  const spoolFile = path.join(telemetrySpoolDir, `${options.harness}.jsonl`);
  fs.appendFileSync(spoolFile, JSON.stringify(record) + "\n");
  capSpool(spoolFile);
}

// Spool files are append-only and grow forever otherwise. Cap each harness file so an enabled,
// long-lived install can't fill the disk: when it exceeds SPOOL_MAX_BYTES, drop the oldest lines and
// keep the newest tail (records are chronological). Cheap — only reads/rewrites when over the cap,
// which is rare relative to per-event appends.
const SPOOL_MAX_BYTES = 25 * 1024 * 1024; // ~25 MB per harness (tens of thousands of records)
const SPOOL_KEEP_FRACTION = 0.7; // on trim, keep the newest ~70% so trims are infrequent
function capSpool(spoolFile) {
  let size;
  try {
    size = fs.statSync(spoolFile).size;
  } catch {
    return;
  }
  if (size <= SPOOL_MAX_BYTES) return;
  try {
    const lines = fs.readFileSync(spoolFile, "utf8").split("\n").filter((l) => l.trim());
    const keep = lines.slice(Math.floor(lines.length * (1 - SPOOL_KEEP_FRACTION)));
    fs.writeFileSync(spoolFile, keep.join("\n") + "\n");
  } catch {
    // Best-effort: a failed trim just means the file stays large until the next successful capture.
  }
}

function ensureTelemetryDirs() {
  fs.mkdirSync(telemetrySpoolDir, { recursive: true });
  fs.mkdirSync(telemetryCollectorDir, { recursive: true });
}

function telemetryStatePath() {
  return `${telemetryDir}/state.json`;
}

function readTelemetryState() {
  try {
    return JSON.parse(fs.readFileSync(telemetryStatePath(), "utf8"));
  } catch {
    return { enabled: false };
  }
}

function parseCaptureArgs(args) {
  const options = { harness: "unknown", event: "" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--harness") {
      options.harness = args[++i] || "unknown";
    } else if (arg.startsWith("--harness=")) {
      options.harness = arg.slice("--harness=".length);
    } else if (arg === "--event") {
      options.event = args[++i] || "";
    } else if (arg.startsWith("--event=")) {
      options.event = arg.slice("--event=".length);
    }
  }
  return options;
}

function repoMetadata(cwd) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const remote = git(cwd, ["remote", "get-url", "origin"]);
  const sha = git(cwd, ["rev-parse", "--short", "HEAD"]);
  return {
    label: root ? path.basename(root) : path.basename(cwd),
    git_root_hash: root ? hash(root) : null,
    remote_hash: remote ? hash(remote) : null,
    branch: branch || null,
    // Short SHA correlates a spike to the code state it happened on; safe to keep in the clear.
    sha: sha || null,
  };
}

function toolMetadata(input) {
  const toolInput = input.tool_input || input.toolInput || {};
  const name = input.tool_name || input.toolName || input.tool || null;
  const command = typeof toolInput.command === "string" ? toolInput.command : null;
  const mcpServer = mcpServerOf(name);
  // For MCP tools the wire name is `mcp__<server>__<tool>`; expose the bare tool so the dashboard
  // can attribute spikes to a specific call (e.g. get_context_bundle) instead of just the server.
  const mcpTool = mcpServer && typeof name === "string" ? name.split("__").slice(2).join("__") || null : null;
  // File path of a Read/Write/Edit-style tool, if any. Path itself is content-sensitive so it is
  // hashed; only the extension is kept in the clear — enough to say "spikes come from .jsonl reads".
  const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : typeof toolInput.path === "string" ? toolInput.path : null;
  return {
    name,
    is_mcp: mcpServer !== null,
    mcp_server: mcpServer,
    mcp_tool: mcpTool,
    command_hash: command ? hash(command) : null,
    command_chars: command ? command.length : 0,
    command_lines: command ? command.split("\n").length : 0,
    file_ext: filePath ? fileExt(filePath) : null,
    file_path_hash: filePath ? hash(filePath) : null,
  };
}

// Lowercase extension without the dot, or null. Used as a clear-text spike dimension while the full
// path stays hashed.
function fileExt(filePath) {
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  return ext || null;
}

// Max characters of a user prompt kept in the clear. Enough to identify what a session was about
// ("fix the telemetry dashboard alignment") without storing whole pasted blocks. The full prompt is
// never stored — only this leading slice plus a hash for dedup/length.
const PROMPT_PREVIEW_CHARS = 200;

function promptMetadata(input) {
  const prompt = typeof input.prompt === "string" ? input.prompt : typeof input.user_prompt === "string" ? input.user_prompt : null;
  return {
    chars: prompt ? prompt.length : 0,
    hash: prompt ? hash(prompt) : null,
    // Single-line leading slice so sessions are identifiable in the dashboard. Newlines collapsed so
    // it renders as one tidy title; truncation marked with an ellipsis.
    preview: prompt ? promptPreview(prompt) : null,
  };
}

function promptPreview(prompt) {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  return oneLine.length > PROMPT_PREVIEW_CHARS ? oneLine.slice(0, PROMPT_PREVIEW_CHARS) + "…" : oneLine;
}

// Tokens consumed since the previous capture in the same session — the spike signal. Transcript
// totals are cumulative, so the per-capture delta is what distinguishes a heavy turn from a quiet
// one. Cursors live in the collector dir keyed by session; a missing/new session yields the full
// total as its first delta.
function deltaTokens(sessionId, cumulativeTotal) {
  if (!sessionId || typeof cumulativeTotal !== "number") return null;
  const cursorPath = path.join(telemetryCollectorDir, `cursor-${hash(sessionId)}.json`);
  let previous = 0;
  try {
    previous = JSON.parse(fs.readFileSync(cursorPath, "utf8")).total || 0;
  } catch {
    previous = 0;
  }
  try {
    fs.writeFileSync(cursorPath, JSON.stringify({ total: cumulativeTotal }));
  } catch {
    // Cursor write is best-effort; a failure just means the next delta restarts from this point.
  }
  return Math.max(0, cumulativeTotal - previous);
}

// Wall-clock latency of a single tool call. PreToolUse writes a start stamp into a per-session
// cursor; PostToolUse reads and clears it, returning the elapsed ms. Best-effort: a missing start
// (hook race, restart) yields null rather than a bogus duration. Cursor keyed by session so
// concurrent sessions do not collide.
function toolDuration(event, sessionId, toolName) {
  if (!sessionId) return null;
  const cursorPath = path.join(telemetryCollectorDir, `tool-${hash(sessionId)}.json`);
  if (event === "PreToolUse") {
    try {
      fs.writeFileSync(cursorPath, JSON.stringify({ start: Date.now(), tool: toolName }));
    } catch {
      // Best-effort; a failed write just means the matching PostToolUse reports null.
    }
    return null;
  }
  if (event === "PostToolUse") {
    let start = null;
    try {
      start = JSON.parse(fs.readFileSync(cursorPath, "utf8")).start;
      fs.rmSync(cursorPath, { force: true });
    } catch {
      return null;
    }
    return typeof start === "number" ? Math.max(0, Date.now() - start) : null;
  }
  return null;
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() : "";
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

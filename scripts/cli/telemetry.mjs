import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { markTelemetrySelected, presetsApply } from "./presets.mjs";
import { telemetryCollectorDir, telemetryDbPath, telemetryDir, telemetrySpoolDir } from "./state-paths.mjs";
import { mcpServerOf, transcriptStats } from "./telemetry-transcript.mjs";
import { analyzeTelemetry } from "./telemetry-analyze.mjs";
import { startTelemetryServer } from "./telemetry-serve.mjs";

// Record shape version. v1 records (no `schema` key) are metadata-only and predate token capture;
// readers treat missing token/session fields as zero so old spool files keep reporting.
const SCHEMA_VERSION = 2;

export function telemetryCommand(rest) {
  const [sub, ...args] = rest;
  switch (sub) {
    case "enable":
      return telemetryEnable(args);
    case "disable":
      return telemetryDisable(args);
    case "status":
      return telemetryStatus(args);
    case "report":
      return telemetryReport(args);
    case "export":
      return telemetryExport(args);
    case "serve":
      return telemetryServe(args);
    case "purge":
      return telemetryPurge(args);
    case "capture":
      return telemetryCapture(args);
    default:
      console.error("usage: roborepo telemetry enable|disable|status|report|export|serve|purge");
      process.exit(2);
  }
}

function telemetryEnable(args) {
  rejectArgs(args);
  ensureTelemetryDirs();
  writeTelemetryState({ enabled: true });
  presetsApply(["telemetry"]);
  console.log("telemetry: enabled");
  telemetryStatus([]);
}

function telemetryDisable(args) {
  rejectArgs(args);
  ensureTelemetryDirs();
  writeTelemetryState({ enabled: false });
  markTelemetrySelected(false);
  console.log("telemetry: disabled");
}

function telemetryStatus(args) {
  rejectArgs(args);
  const state = readTelemetryState();
  console.log(`enabled: ${state.enabled === true ? "yes" : "no"}`);
  console.log(`database: ${telemetryDbPath}`);
  console.log(`spool:    ${telemetrySpoolDir}`);
  console.log(`collector:${telemetryCollectorDir}`);
}

function telemetryReport(args) {
  rejectSupportedReportArgs(args);
  const state = readTelemetryState();
  const events = readSpoolEvents();
  if (events.length === 0) {
    console.log("No telemetry events yet.");
    console.log(`Capture enabled: ${state.enabled === true ? "yes" : "no"}`);
    return;
  }
  const report = analyzeTelemetry(events);
  console.log(`events: ${report.event_count}  (with token data: ${report.capture_count})`);
  printTop("repos", countBy(events, (event) => event.repo?.label ?? "unknown"));
  printTop("tools/events", countBy(events, (event) => event.tool?.name ?? event.event ?? "unknown"));
  if (report.capture_count === 0) {
    console.log("\n(no token-bearing records yet — start a session with telemetry enabled to populate spike analysis)");
    return;
  }
  printSessions(report.sessions);
  printSpikes(report);
  printTokenContributors("token by repo", report.top_repos);
  printTokenContributors("token by tool", report.top_tools);
  printTokenContributors("token by MCP server", report.top_mcp);
  printComparison(report.comparison);
}

function printSessions(sessions) {
  console.log("\nsessions (by total tokens):");
  for (const session of sessions.slice(0, 8)) {
    const label = `${session.repo}/${shortId(session.session_id)}`;
    console.log(`  ${label.padEnd(28)} ${fmt(session.total_tokens).padStart(10)} tok  ${session.tool_calls} tools  ${session.mcp_calls} mcp`);
  }
}

function printSpikes(report) {
  console.log(`\ntoken spikes (delta >= ${fmt(report.spike_threshold)} tok):`);
  if (report.spikes.length === 0) {
    console.log("  none — no capture exceeded the spike threshold");
    return;
  }
  for (const spike of report.spikes.slice(0, 8)) {
    const where = `${spike.repo}/${shortId(spike.session_id)}`;
    console.log(`  ${spike.ts.slice(0, 19)}  ${where.padEnd(24)} +${fmt(spike.delta_tokens).padStart(8)} tok  ${spike.event}${spike.tool ? ` (${spike.tool})` : ""}`);
  }
}

function printTokenContributors(label, rows) {
  if (rows.length === 0) return;
  console.log(`\n${label}:`);
  for (const row of rows.slice(0, 8)) {
    console.log(`  ${String(row.key).padEnd(24)} ${fmt(row.tokens).padStart(10)} tok  (${row.captures})`);
  }
}

function printComparison(comparison) {
  console.log("\nspike vs normal captures:");
  for (const [label, stats] of [["spike", comparison.spike], ["normal", comparison.normal]]) {
    console.log(`  ${label.padEnd(8)} n=${String(stats.count).padEnd(4)} avg Δ=${fmt(stats.avg_delta).padStart(8)} tok  avg tools=${stats.avg_tool_calls}  mcp rate=${stats.mcp_rate}`);
  }
}

function telemetryExport(args) {
  rejectSupportedReportArgs(args);
  console.log(JSON.stringify(readSpoolEvents(), null, 2));
}

function telemetryServe(args) {
  const options = parseServeArgs(args);
  if (readTelemetryState().enabled !== true) {
    console.log("telemetry is disabled; serving whatever is already in the spool.");
  }
  // The server re-reads the spool on each request so a running dashboard reflects live captures.
  startTelemetryServer({ port: options.port, loadAnalysis: () => analyzeTelemetry(readSpoolEvents()) });
}

function parseServeArgs(args) {
  const options = { port: 4317 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port") options.port = Number(args[++i]);
    else if (arg.startsWith("--port=")) options.port = Number(arg.slice("--port=".length));
    else rejectArgs([arg]);
  }
  if (!Number.isInteger(options.port) || options.port <= 0) {
    console.error("usage: roborepo telemetry serve [--port <n>]");
    process.exit(2);
  }
  return options;
}

function telemetryPurge(args) {
  if (args.length !== 1 || args[0] !== "--all") {
    console.error("usage: roborepo telemetry purge --all");
    process.exit(2);
  }
  fs.rmSync(telemetryDir, { recursive: true, force: true });
  markTelemetrySelected(false);
  console.log(`purged: ${telemetryDir}`);
}

function telemetryCapture(args) {
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
  const stats = transcriptStats(transcriptPath);
  const record = {
    schema: SCHEMA_VERSION,
    ts: new Date().toISOString(),
    harness: options.harness,
    event: options.event || input.hook_event_name || input.hookEventName || "unknown",
    session_id: sessionId,
    cwd_hash: hash(cwd),
    repo: repoMetadata(cwd),
    tool: toolMetadata(input),
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
  };
  ensureTelemetryDirs();
  fs.appendFileSync(path.join(telemetrySpoolDir, `${options.harness}.jsonl`), JSON.stringify(record) + "\n");
}

function ensureTelemetryDirs() {
  fs.mkdirSync(telemetrySpoolDir, { recursive: true });
  fs.mkdirSync(telemetryCollectorDir, { recursive: true });
}

function telemetryStatePath() {
  return `${telemetryDir}/state.json`;
}

function readSpoolEvents() {
  const events = [];
  let files = [];
  try {
    files = fs.readdirSync(telemetrySpoolDir).filter((file) => file.endsWith(".jsonl"));
  } catch {
    return events;
  }
  for (const file of files) {
    const fullPath = path.join(telemetrySpoolDir, file);
    for (const line of fs.readFileSync(fullPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // Ignore partial/corrupt lines; hooks must never make reports fragile.
      }
    }
  }
  return events;
}

function countBy(events, keyFor) {
  const counts = new Map();
  for (const event of events) {
    const key = keyFor(event);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function printTop(label, entries) {
  console.log(`${label}:`);
  for (const [key, count] of entries.slice(0, 8)) {
    console.log(`  ${String(key).padEnd(24)} ${count}`);
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
  return {
    label: root ? path.basename(root) : path.basename(cwd),
    git_root_hash: root ? hash(root) : null,
    remote_hash: remote ? hash(remote) : null,
    branch: branch || null,
  };
}

function toolMetadata(input) {
  const toolInput = input.tool_input || input.toolInput || {};
  const name = input.tool_name || input.toolName || input.tool || null;
  const command = typeof toolInput.command === "string" ? toolInput.command : null;
  const mcpServer = mcpServerOf(name);
  return {
    name,
    is_mcp: mcpServer !== null,
    mcp_server: mcpServer,
    command_hash: command ? hash(command) : null,
    command_chars: command ? command.length : 0,
    command_lines: command ? command.split("\n").length : 0,
  };
}

function promptMetadata(input) {
  const prompt = typeof input.prompt === "string" ? input.prompt : typeof input.user_prompt === "string" ? input.user_prompt : null;
  return {
    chars: prompt ? prompt.length : 0,
    hash: prompt ? hash(prompt) : null,
  };
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

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() : "";
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

function fmt(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function shortId(id) {
  return id && id !== "unknown" ? String(id).slice(0, 8) : "unknown";
}

function readTelemetryState() {
  try {
    return JSON.parse(fs.readFileSync(telemetryStatePath(), "utf8"));
  } catch {
    return { enabled: false };
  }
}

function writeTelemetryState(patch) {
  ensureTelemetryDirs();
  const state = { ...readTelemetryState(), ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(telemetryStatePath(), JSON.stringify(state, null, 2) + "\n");
}

function rejectArgs(args) {
  if (args.length > 0) {
    console.error(`unknown argument: ${args[0]}`);
    process.exit(2);
  }
}

function rejectSupportedReportArgs(args) {
  const allowed = new Set(["--since", "--repo", "--group", "--format"]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.includes("=")) {
      if (!allowed.has(arg.split("=")[0])) rejectArgs([arg]);
      continue;
    }
    if (!allowed.has(arg)) rejectArgs([arg]);
    i++;
  }
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import net from "node:net";
import { spawnSync, spawn } from "node:child_process";
import { markTelemetrySelected, presetsApply } from "./presets.mjs";
import { repoRoot } from "./paths.mjs";
import { portalPidPath, legacyTelemetryPidPath, telemetryBackupDir, telemetryCollectorDir, telemetryDbPath, telemetryDir, telemetrySpoolDir } from "./state-paths.mjs";
import { mcpServerOf, transcriptStats } from "./telemetry-transcript.mjs";
import { analyzeTelemetry } from "./telemetry-analyze.mjs";
import { startPortalServer } from "./portal-server.mjs";
import { readConfigSnapshot, loadConfigSource } from "./config.mjs";
import { mutatePackage, setSkillInstalled, setPermissionProfile } from "./config-mutate.mjs";
import { locateTranscript, extractHeavyTurns, transcriptTitle, buildAnalysisPrompt } from "./telemetry-transcript-locate.mjs";
import { insightsSummary } from "./telemetry-insights.mjs";

// Record shape version. v1 records (no `schema` key) are metadata-only and predate token capture;
// readers treat missing token/session fields as zero so old spool files keep reporting.
const SCHEMA_VERSION = 2;

export function telemetryCommand(rest) {
  const [sub, ...args] = rest;
  switch (sub) {
    case "install":
      return telemetryInstall(args);
    case "stop":
      return telemetryStop(args);
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
    case "purge":
      return telemetryPurge(args);
    case "backup":
      return telemetryBackup(args);
    case "capture":
      return telemetryCapture(args);
    default:
      console.error("usage: roborepo telemetry install|stop|enable|disable|status|report|export|backup|purge");
      console.error("portal: roborepo serve [--detach] [--no-open] [--port <n>]");
      process.exit(2);
  }
}

// Telemetry-only install: wires just the 5 capture hooks into the harness settings files, without
// touching the rest of roborepo's operational hooks or presets. Intended for Claude/Codex users who
// want token visibility before committing to a full roborepo install.
function telemetryInstall(args) {
  rejectArgs(args);
  // Symlink ~/.local/bin/roborepo → repo bin (only if not already there).
  wireBinSymlink();
  // Write state directly — no presetsApply, so operational hooks are not touched.
  ensureTelemetryDirs();
  writeTelemetryState({ enabled: true });
  markTelemetrySelected(true);
  // Wire capture hooks into whichever harness config files exist.
  const claudeSettings = path.join(os.homedir(), ".claude", "settings.json");
  if (fs.existsSync(path.join(os.homedir(), ".claude"))) {
    wireCaptureHooks(claudeSettings, "claude");
  }
  const codexDir = path.join(os.homedir(), ".codex");
  if (fs.existsSync(codexDir)) {
    wireCaptureHooks(path.join(codexDir, "hooks.json"), "codex");
  }
  console.log("telemetry-only install complete.");
  console.log("capture is enabled.");
  console.log("open the portal:       roborepo serve");
  console.log("view reports:          roborepo telemetry report");
  console.log("upgrade to full suite: re-run the roborepo install script");
}

const CAPTURE_EVENTS = ["SessionStart", "PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"];

function wireBinSymlink() {
  const target = path.join(os.homedir(), ".local", "bin", "roborepo");
  const source = path.join(repoRoot, "bin", "roborepo");
  let existing = null;
  try { existing = fs.lstatSync(target); } catch {}
  if (existing) {
    // Already exists: report ok if it's already pointing to this repo's bin; otherwise skip — never
    // overwrite a symlink the user may have pointing to a different roborepo clone.
    const current = existing.isSymbolicLink()
      ? path.resolve(path.dirname(target), fs.readlinkSync(target))
      : null;
    if (current === source) {
      console.log(`ok: ${target}`);
    } else {
      console.log(`skip: ${target} already exists — link it manually if needed`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(source, target);
  console.log(`link: ${target} -> ${source}`);
}

// Merge only the telemetry capture hooks into a harness settings file (settings.json or hooks.json).
// Idempotent: skips events whose capture command is already present. Does not touch other hooks.
function wireCaptureHooks(settingsPath, harness) {
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
  const hooks = settings.hooks || {};
  let added = 0;
  for (const event of CAPTURE_EVENTS) {
    const cmd = `roborepo telemetry capture --harness ${harness} --event ${event}`;
    const entries = hooks[event] || [];
    const exists = entries.some((e) => (e.hooks || []).some((h) => h.command === cmd));
    if (!exists) {
      entries.push({ matcher: "", hooks: [{ type: "command", command: cmd }] });
      hooks[event] = entries;
      added++;
    }
  }
  if (added > 0) {
    settings.hooks = hooks;
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    console.log(`wired: ${added} capture hooks → ${settingsPath}`);
  } else {
    console.log(`ok: capture hooks already present → ${settingsPath}`);
  }
}

function telemetryStop(args) {
  rejectArgs(args);
  const stopped = stopServer();
  ensureTelemetryDirs();
  writeTelemetryState({ enabled: false });
  markTelemetrySelected(false);
  console.log(stopped ? "telemetry: disabled · server stopped" : "telemetry: disabled · no server was running");
}

function telemetryEnable(args) {
  rejectArgs(args);
  setTelemetryEnabled(true);
  console.log("telemetry: enabled");
  telemetryStatus([]);
}

function telemetryDisable(args) {
  rejectArgs(args);
  setTelemetryEnabled(false);
  console.log("telemetry: disabled");
}

// Programmatic capture toggle, shared by the CLI verbs and the config controls. Flips capture state
// and wires/unwires the capture hooks (via the telemetry bundle) without starting/stopping the
// portal server — the dashboard toggle is about capture, not the server. Returns { ok, message }.
export function setTelemetryEnabled(enabled) {
  try {
    ensureTelemetryDirs();
    writeTelemetryState({ enabled });
    if (enabled) presetsApply(["telemetry"]);
    else markTelemetrySelected(false);
    return { ok: true, message: `telemetry ${enabled ? "enabled" : "disabled"}` };
  } catch (err) {
    return { ok: false, message: String(err?.message || err) };
  }
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
  const deep = args.includes("--deep");
  const state = readTelemetryState();
  const events = readSpoolEvents();
  if (events.length === 0) {
    console.log("No telemetry events yet.");
    console.log(`Capture enabled: ${state.enabled === true ? "yes" : "no"}`);
    return;
  }
  const report = analyzeTelemetry(events);
  // Headline first: the deterministic "what this means" conclusions, before any raw table.
  printInsights(report.insights);
  if (deep) printDeepRead(report);
  console.log(`\nevents: ${report.event_count}  (with token data: ${report.capture_count})`);
  printTop("repos", countBy(events, (event) => event.repo?.label ?? "unknown"));
  printTop("tools/events", countBy(events, (event) => event.tool?.name ?? event.event ?? "unknown"));
  if (report.capture_count === 0) {
    console.log("\n(no token-bearing records yet — start a session with telemetry enabled to populate spike analysis)");
    return;
  }
  printUsageWindows(report.usage_windows);
  printSpikeCauses(report.spike_causes);
  // Conclusions first — the actionable headlines before the raw contributor tables.
  printGroupCost(report.group_cost);
  printToolCost(report.tool_cost);
  printSpikeAnatomy(report.spike_anatomy);
  printRegression(report.regression);
  printLoops(report.loops);
  printSessions(report.sessions);
  printSpikes(report);
  printTokenContributors("token by repo", report.top_repos);
  printTokenContributors("token by tool", report.top_tools);
  printTokenContributors("token by MCP server", report.top_mcp);
  printComparison(report.comparison);
}

// Trailing-window consumption is a local estimate from capture deltas — not the real server-side
// Claude rate limit, which telemetry can't see. Labeled as such so it's never mistaken for quota.
function printUsageWindows(windows) {
  if (!windows) return;
  console.log("\nrecent token usage (local estimate, not server rate limit):");
  console.log(`  last 5h:  ~${fmt(windows.five_hour).padStart(12)} tok`);
  console.log(`  last 7d:  ~${fmt(windows.seven_day).padStart(12)} tok`);
}

// The actionable headline: each token spike grouped by the pattern that drove it, with the change to
// make. Answers "what am I doing that blows up my tokens" instead of a wall of per-capture numbers.
function printSpikeCauses(causes) {
  if (!causes || causes.length === 0) return;
  console.log("\nwhat's causing spikes (biggest token cost first):");
  for (const cause of causes.slice(0, 8)) {
    console.log(`  ${cause.cause.padEnd(22)} n=${String(cause.spikes).padEnd(3)} avg Δ=${fmt(cause.avg_delta).padStart(9)} tok  worst @${cause.worst_repo}`);
    console.log(`    → ${cause.hint}`);
  }
}

// The headline: deterministic conclusions, before any raw table. Severity-marked so the high-signal
// findings (tail risk, loops) stand out.
function printInsights(insights) {
  if (!insights || insights.length === 0) return;
  const mark = { high: "▲", warn: "△", info: "·" };
  console.log("\n══ what this means ══");
  for (const f of insights) {
    console.log(`  ${mark[f.severity] || "·"} ${f.headline}`);
    console.log(`      ${f.detail}`);
  }
}

// Optional LLM "deeper read": send the computed summary (not raw spool) to `claude -p` for a written
// synthesis. Best-effort — degrades to a note if the claude CLI is unavailable.
function printDeepRead(report) {
  const result = runDeepRead(report);
  console.log("\n══ deeper read (claude) ══");
  console.log(result.ok ? indent(result.text.trim(), "  ") : `  (${result.note})`);
}

function indent(text, pad) {
  return text.split("\n").map((l) => pad + l).join("\n");
}

// Native-vs-MCP head-to-head: avg context-tokens dropped per call, by functional group. The signal
// for "is the MCP cheaper than the Read/Grep it replaces". Approximate (result size ÷ 4).
function printGroupCost(groups) {
  if (!groups || groups.length === 0) return;
  console.log("\ncost per call by group (approx tokens from result size):");
  for (const g of groups) {
    console.log(`  ${g.group.padEnd(14)} ${fmt(g.avg_tokens).padStart(7)} tok/call  (${g.calls} calls)`);
  }
}

function printToolCost(tools) {
  if (!tools || tools.length === 0) return;
  console.log("\ncost per call by tool (approx tokens from result size):");
  for (const t of tools.slice(0, 10)) {
    console.log(`  ${t.tool.padEnd(24)} avg ${fmt(t.avg_tokens).padStart(7)}  max ${fmt(t.max_tokens).padStart(8)}  (${t.calls})`);
  }
}

// Lift > 1 means that group drives spikes more than its everyday share — "spikes are X-heavy".
function printSpikeAnatomy(anatomy) {
  if (!anatomy || anatomy.groups.length === 0) return;
  console.log(`\nwhat's different in spikes (${anatomy.spike_count} spike vs ${anatomy.normal_count} normal results):`);
  for (const g of anatomy.groups.slice(0, 6)) {
    const lift = g.lift == null ? "only-in-spikes" : `${g.lift}× vs normal`;
    console.log(`  ${g.group.padEnd(14)} ${lift.padEnd(16)} ${Math.round(g.spike_share * 100)}% of spike results  avg ${fmt(g.avg_tokens)} tok`);
  }
}

// Earlier vs later half: a positive delta means that group got more expensive over time — the
// "did my recent change make context heavier" signal.
function printRegression(regression) {
  if (!regression || regression.groups.length === 0) return;
  console.log(`\nregression (earlier vs later half, split @ ${regression.split_ts?.slice(0, 19)}):`);
  for (const g of regression.groups.slice(0, 6)) {
    const arrow = g.delta_tokens > 0 ? "↑" : g.delta_tokens < 0 ? "↓" : "·";
    console.log(`  ${g.group.padEnd(14)} ${fmt(g.before_avg_tokens).padStart(6)} → ${fmt(g.after_avg_tokens).padStart(6)} tok/call  ${arrow}${fmt(Math.abs(g.delta_tokens))}`);
  }
}

function printLoops(loops) {
  if (!loops || loops.length === 0) return;
  console.log("\n⚠ loops detected (same tool fired repeatedly in one session):");
  for (const l of loops.slice(0, 6)) {
    console.log(`  ${l.repo}/${shortId(l.session_id)}  ${l.tool} ×${l.max_repeat}  → ${l.hint}`);
  }
}

function printSessions(sessions) {
  console.log("\nsessions (by total tokens):");
  for (const session of sessions.slice(0, 8)) {
    const repoBranch = session.repo + (session.branch ? `@${session.branch}` : "");
    const label = `${repoBranch} ${session.harness ?? ""} ${shortId(session.session_id)}`.trim();
    console.log(`  ${label.padEnd(36)} ${fmt(session.total_tokens).padStart(10)} tok  ${session.tool_calls} tools  ${session.mcp_calls} mcp`);
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

export async function serveCommand(args, { allowPortFallback = false } = {}) {
  const options = parseServeArgs(args);
  if (options.detach) {
    const port = await startDetachedPortal(options.port, { allowPortFallback });
    const portalUrl = `http://127.0.0.1:${port}/config`;
    console.log(`roborepo portal: ${portalUrl}  (detached · use: roborepo telemetry stop)`);
    if (options.open) openLocalUrl(portalUrl);
    return;
  }
  // Clean up the PID file when the server exits cleanly (SIGTERM from stop or OS shutdown).
  process.on("SIGTERM", () => { clearPid(); process.exit(0); });
  if (readTelemetryState().enabled !== true) {
    console.log("telemetry is disabled; serving whatever is already in the spool.");
  }
  // The server re-reads the spool on each request so a running dashboard reflects live captures.
  // A `window` ({ rangeMs, end }) scopes the whole report to a trailing time slice before analysis,
  // so every panel — not just the chart — reflects the dashboard's time filter. loadSession bridges
  // a flagged event to its chat transcript (file I/O lives here, not in the server).
    startPortalServer({
    port: options.port,
    loadAnalysis: (window, harness) => {
      const allEvents = readSpoolEvents();
      // Expose all harnesses found in the spool, before any harness filter, so the dashboard can
      // always render the full filter even when one harness is selected.
      const availableHarnesses = [...new Set(allEvents.map((e) => e.harness).filter(Boolean))].sort();
      const events = harness ? allEvents.filter((e) => e.harness === harness) : allEvents;
      const report = analyzeTelemetry(filterByWindow(events, window));
      // Backfill session titles from transcripts: the transcript always has the first user message
      // (turn 1), whereas the spool only captures prompts when hooks fired — so new sessions or
      // sessions started before telemetry was enabled may have no spool title or a mid-chat title.
      // Cap at top 20 sessions to bound latency; results are cached so 5s polls don't re-read files.
      for (const s of report.sessions.slice(0, 20)) {
        const t = cachedTranscriptTitle(s.session_id, s.harness || harness || "claude");
        if (t) s.title = t;
      }
      report.available_harnesses = availableHarnesses;
      report.deepread_cli = findDeepReadCli();
      return report;
    },
    loadSession: (req) => loadSessionDetail(req),
    loadInsightsLlm: () => loadInsightsLlm(),
    loadConfig: () => readConfigSnapshot(),
    loadConfigSource: (params) => loadConfigSource(params),
    mutatePackage: (id, enabled) => mutatePackage(id, enabled),
    mutateSkill: (id, enabled) => setSkillInstalled(id, enabled),
    mutateProfile: (profile, confirmedLooser, scope) => setPermissionProfile(profile, { confirmedLooser, scope }),
    onListening: options.open ? () => openLocalUrl(portalUrl) : null,
    onPortInUse: options.open ? () => {
      console.log(`roborepo portal already appears to be running: ${portalUrl}`);
      openLocalUrl(portalUrl);
      return true;
    } : null,
  });
}

function parseServeArgs(args) {
  const options = { port: 4317, detach: false, open: true, allowZeroPort: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port") options.port = Number(args[++i]);
    else if (arg.startsWith("--port=")) options.port = Number(arg.slice("--port=".length));
    else if (arg === "--detach") options.detach = true;
    else if (arg === "--open") options.open = true;
    else if (arg === "--no-open") options.open = false;
    else if (arg === "--allow-zero-port") options.allowZeroPort = true;
    else rejectArgs([arg]);
  }
  if (!Number.isInteger(options.port) || options.port < 0 || (options.port === 0 && !options.allowZeroPort)) {
    console.error("usage: roborepo serve [--detach] [--no-open] [--port <n>]");
    process.exit(2);
  }
  return options;
}

function telemetryPurge(args) {
  const backup = args.includes("--backup");
  const rest = args.filter((arg) => arg !== "--backup");
  if (rest.length !== 1 || rest[0] !== "--all") {
    console.error("usage: roborepo telemetry purge --all [--backup]");
    process.exit(2);
  }
  if (backup) {
    const archive = backupTelemetry();
    if (archive) console.log(`backup:  ${archive}`);
    else console.log("backup:  nothing to back up (no telemetry data)");
  }
  fs.rmSync(telemetryDir, { recursive: true, force: true });
  markTelemetrySelected(false);
  console.log(`purged: ${telemetryDir}`);
}

function telemetryBackup(args) {
  rejectArgs(args);
  const archive = backupTelemetry();
  if (archive) console.log(`backup: ${archive}`);
  else console.log("nothing to back up (no telemetry data yet)");
}

// Snapshots the current telemetry dir into a timestamped, gitignored copy under telemetryBackupDir
// (which lives outside telemetryDir, so a subsequent purge can't remove it). Returns the backup path,
// or null when there's nothing to copy. Uses fs.cpSync — no shell, no tar dependency.
function backupTelemetry() {
  if (!fs.existsSync(telemetryDir)) return null;
  const entries = fs.readdirSync(telemetryDir);
  if (entries.length === 0) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(telemetryBackupDir, `telemetry-${stamp}`);
  fs.mkdirSync(telemetryBackupDir, { recursive: true });
  fs.cpSync(telemetryDir, dest, { recursive: true });
  return dest;
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

// Restrict events to a trailing time window before analysis so the dashboard's time filter scopes
// the entire report. `end` (epoch ms) pins the window's right edge for panning; null follows the
// latest event. Null window returns everything unchanged. Events lacking a parseable ts are dropped
// when a window is active (they cannot be placed on the timeline).
function filterByWindow(events, window) {
  if (!window || !(window.rangeMs > 0) || events.length === 0) return events;
  const times = events.map((event) => Date.parse(event.ts)).filter((ms) => Number.isFinite(ms));
  if (times.length === 0) return events;
  const dataEnd = Math.max(...times);
  const end = Number.isFinite(window.end) ? window.end : dataEnd;
  const start = end - window.rangeMs;
  return events.filter((event) => {
    const ms = Date.parse(event.ts);
    return Number.isFinite(ms) && ms >= start && ms <= end;
  });
}

// Title cache: transcripts are append-only so the first user message never changes. Cache by id so
// the 5-second dashboard poll doesn't re-stat/re-read files for every session on every tick.
const _titleCache = new Map();
function cachedTranscriptTitle(sessionId, harness) {
  if (_titleCache.has(sessionId)) return _titleCache.get(sessionId);
  const p = locateTranscript(sessionId, harness || "claude");
  const t = p ? transcriptTitle(p) : null;
  if (t) _titleCache.set(sessionId, t);
  return t;
}

// Resolve a flagged event to its chat: find the transcript, surface the heaviest turns, and build a
// paste-ready analysis prompt. Best-effort — a missing transcript returns found:false, never throws.
function loadSessionDetail({ id, harness, finding, repo }) {
  const transcriptPath = locateTranscript(id, harness);
  if (!transcriptPath) {
    return {
      found: false,
      session_id: id,
      harness,
      analysis_prompt: buildAnalysisPrompt({ sessionId: id, harness, repo, finding, transcriptPath: null }),
    };
  }
  return {
    found: true,
    session_id: id,
    harness,
    transcript_path: transcriptPath,
    title: transcriptTitle(transcriptPath),
    heavy_turns: extractHeavyTurns(transcriptPath, { limit: 8 }),
    analysis_prompt: buildAnalysisPrompt({ sessionId: id, harness, repo, finding, transcriptPath }),
  };
}

// The deeper-read prompt: only the computed summary goes out — never raw spool, prompts, or results.
const DEEP_READ_PROMPT =
  "Below is a local telemetry summary of an AI coding session (deterministic facts only). " +
  "Give 3-5 terse, actionable conclusions a developer can act on: call out the biggest token cost, " +
  "any tail risks, and one concrete thing to change. No preamble.\n\n";

// Find the first available AI CLI for the deeper-read feature: prefer claude, fall back to codex.
function findDeepReadCli() {
  for (const cmd of ["claude", "codex"]) {
    const check = spawnSync("which", [cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (check.status === 0 && check.stdout.trim()) return cmd;
  }
  return null;
}

// Run the optional LLM synthesis via the headless AI CLI (claude or codex, whichever is available).
// Best-effort: returns { ok:false, note } when no CLI is available so callers degrade gracefully.
function runDeepRead(report) {
  const cli = findDeepReadCli();
  if (!cli) return { ok: false, note: "no AI CLI available (tried claude, codex)", cli: null };
  const prompt = DEEP_READ_PROMPT + insightsSummary(report);
  let result;
  try {
    result = spawnSync(cli, ["-p", prompt], { encoding: "utf8", timeout: 60000 });
  } catch (err) {
    return { ok: false, note: `${cli} CLI not available: ${err.message}`, cli };
  }
  if (result.error) return { ok: false, note: `${cli} CLI not available: ${result.error.message}`, cli };
  if (result.status !== 0) return { ok: false, note: `${cli} exited ${result.status}: ${(result.stderr || "").trim().slice(0, 200)}`, cli };
  const text = (result.stdout || "").trim();
  return text ? { ok: true, text, cli } : { ok: false, note: `${cli} returned no output`, cli };
}

// Server closure: deeper-read on demand from the dashboard. Re-reads the spool so it reflects live
// captures, mirroring loadAnalysis.
function loadInsightsLlm() {
  return runDeepRead(analyzeTelemetry(readSpoolEvents()));
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

// --- PID management for the detached portal server ---------------------------------------------

function readPid() {
  try {
    return parseInt(fs.readFileSync(portalPidPath, "utf8").trim(), 10) || null;
  } catch {}
  try {
    return parseInt(fs.readFileSync(legacyTelemetryPidPath, "utf8").trim(), 10) || null;
  } catch {
    return null;
  }
}

function isProcessRunning(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function writePid(pid) {
  fs.mkdirSync(path.dirname(portalPidPath), { recursive: true });
  fs.writeFileSync(portalPidPath, String(pid));
}

function clearPid() {
  try { fs.rmSync(portalPidPath, { force: true }); } catch {}
  try { fs.rmSync(legacyTelemetryPidPath, { force: true }); } catch {}
}

// Kill any existing detached server (stale or live). Clears the PID file unconditionally.
function killExistingServer() {
  const pid = readPid();
  if (pid == null) return;
  if (isProcessRunning(pid)) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  clearPid();
}

// Kill the running server. Returns true if a live process was found and signalled.
function stopServer() {
  const pid = readPid();
  if (pid == null) return false;
  clearPid();
  if (!isProcessRunning(pid)) return false;
  try { process.kill(pid, "SIGTERM"); return true; } catch { return false; }
}

async function startDetachedPortal(port, { allowPortFallback = false } = {}) {
  killExistingServer();
  const selectedPort = allowPortFallback ? await pickAvailablePort(port) : port;
  const { child, readyFile } = spawnDetachedServer(selectedPort);
  const ready = await waitForPortalReady(selectedPort, child, readyFile);
  if (!ready.ok) {
    clearPid();
    try { fs.rmSync(readyFile, { force: true }); } catch {}
    if (child.exitCode == null) {
      try { process.kill(child.pid, "SIGTERM"); } catch {}
    }
    throw new Error(ready.message);
  }
  writePid(child.pid);
  child.unref();
  return ready.port ?? selectedPort;
}

async function pickAvailablePort(startPort, attempts = 16) {
  const candidate = Number.isFinite(startPort) && startPort > 0 ? Math.trunc(startPort) : 4317;
  return await canBindPort(candidate) ? candidate : 0;
}

function canBindPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

// Spawn a new foreground `serve` process in the background. The caller writes the PID only after the
// child writes its ready-file from server.listen(), so a failed bind never leaves a stale "running" PID.
function spawnDetachedServer(port) {
  const readyFile = path.join(os.tmpdir(), `roborepo-portal-${process.pid}-${Date.now()}.ready`);
  const child = spawn(process.execPath, [process.argv[1], "serve", "--no-open", "--port", String(port), "--allow-zero-port"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ROBOREPO_PORTAL_READY_FILE: readyFile },
  });
  return { child, readyFile };
}

function waitForPortalReady(port, child, readyFile) {
  const deadline = Date.now() + 3000;
  return new Promise((resolve) => {
    let settled = false;
    let exitCode = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("exit", (code, signal) => {
      exitCode = signal || code;
    });
    const poll = () => {
      if (exitCode !== null) {
        finish({ ok: false, message: `portal server exited before it was ready (${exitCode})` });
        return;
      }
      if (Date.now() > deadline) {
        finish({ ok: false, message: `portal server did not become ready on http://127.0.0.1:${port}/config` });
        return;
      }
      if (fs.existsSync(readyFile) && isProcessRunning(child.pid)) {
        let actualPort = port;
        try {
          const marker = fs.readFileSync(readyFile, "utf8").trim();
          const match = /^ready:(\d+)$/.exec(marker);
          if (match) actualPort = Number(match[1]);
        } catch {}
        try { fs.rmSync(readyFile, { force: true }); } catch {}
        finish({ ok: true, port: actualPort });
        return;
      }
      setTimeout(poll, 100);
    };
    poll();
  });
}

function openLocalUrl(url) {
  const platform = process.platform;
  const command = platform === "darwin"
    ? "open"
    : platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch (err) {
    console.error(`open failed: ${err?.message || err}`);
  }
}

function rejectArgs(args) {
  if (args.length > 0) {
    console.error(`unknown argument: ${args[0]}`);
    process.exit(2);
  }
}

function rejectSupportedReportArgs(args) {
  const allowed = new Set(["--since", "--repo", "--group", "--format", "--deep"]);
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

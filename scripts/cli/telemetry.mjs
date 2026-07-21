import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawnSync, spawn } from "node:child_process";
import { markTelemetrySelected } from "./presets.mjs";
import { repoRoot } from "./paths.mjs";
import { portalPidPath, legacyTelemetryPidPath, telemetryBackupDir, telemetryCollectorDir, telemetryDbPath, telemetryDir, telemetrySpoolDir } from "./state-paths.mjs";
import { analyzeTelemetry } from "./telemetry-analyze.mjs";
import { readMarkers, readSnapshots, readExperiments } from "./telemetry-schemas/persistence.mjs";
import {
  createMarker, startExperiment, endExperiment, experimentStatus,
  MARKER_TYPES, OUTCOME_STATUSES, EXPECTED_DIRECTIONS, TASK_CATEGORIES,
} from "./telemetry-markers.mjs";
import { startPortalServer } from "./portal-server.mjs";
import { readConfigSnapshot, loadConfigSource } from "./config.mjs";
import { mutatePackage, setSkillInstalled, setBehaviorBucket, setCommandBucket } from "./config-mutate.mjs";
import { loadPlansSnapshot, loadPlanDocument, buildPlansPrompt, updatePlanSettings, refreshPlans } from "./plans.mjs";
import {
  loadLocalhosterSnapshot,
  loadLocalhosterHistory,
  loadLocalhosterMetadata,
  refreshLocalhosterSnapshot,
  updateLocalhosterSettings,
  setLocalhosterPortalInfo,
} from "./localhoster.mjs";
import { locateTranscript, extractHeavyTurns, transcriptTitle, buildAnalysisPrompt } from "./telemetry-transcript-locate.mjs";
import { insightsSummary } from "./telemetry-insights.mjs";
import { mergeHooksInto } from "./hook-composition.mjs";

export async function telemetryCommand(rest) {
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
    case "mark":
      return telemetryMark(args);
    case "experiment":
      return telemetryExperiment(args);
    // The hot hook path (fires every PreToolUse/PostToolUse) bypasses this module entirely via
    // main.mjs's dynamic import of telemetry-capture.mjs. This case only serves callers that go
    // through telemetryCommand directly (tests, telemetry-only install's wired hook command still
    // routes through `roborepo telemetry capture`, which main.mjs intercepts before reaching here).
    case "capture": {
      const { telemetryCaptureCommand } = await import("./telemetry-capture.mjs");
      return telemetryCaptureCommand(args);
    }
    default:
      console.error("usage: roborepo telemetry install|stop|enable|disable|status|report|export|backup|purge|mark|experiment");
      console.error("portal: roborepo serve [--detach] [--no-open] [--port <n>]");
      process.exit(2);
  }
}

// --------------------------------------------------------------------------- markers

const MARK_USAGE = "usage: roborepo telemetry mark --type <type> --title <title> [--description <text>] "
  + "[--package <id>]... [--skill <id>]... [--tag <tag>]... [--metric <id>] [--expect increase|decrease|no-change] "
  + "[--session <id>] [--phase <phase>] [--status <status>] [--supersedes <marker-id>] "
  + "[--task-category <id>] [--files-touched <n>] [--directories-touched <n>] [--insertions <n>] [--deletions <n>]";

function parseMarkArgs(args) {
  const options = { packages: [], skills: [], tags: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--type": options.type = args[++i]; break;
      case "--title": options.title = args[++i]; break;
      case "--description": options.description = args[++i]; break;
      case "--package": options.packages.push(args[++i]); break;
      case "--skill": options.skills.push(args[++i]); break;
      case "--tag": options.tags.push(args[++i]); break;
      case "--metric": options.metric = args[++i]; break;
      case "--expect": options.expected_direction = args[++i]; break;
      case "--session": options.session_id = args[++i]; break;
      case "--phase": options.phase = args[++i]; break;
      case "--status": options.status = args[++i]; break;
      case "--supersedes": options.supersedes = args[++i]; break;
      // Task category/scale are explicit-only through the CLI — a human or scripted caller stating
      // "this was a bug-fix touching 3 files" is task_category_source: "explicit" by construction.
      // Inferred task classification (telemetry-task-infer.mjs) is a Phase 5+ analysis-time concern,
      // not something this command computes itself.
      case "--task-category": options.task_category = args[++i]; break;
      case "--files-touched": options.files_touched = Number(args[++i]); break;
      case "--directories-touched": options.directories_touched = Number(args[++i]); break;
      case "--insertions": options.insertions = Number(args[++i]); break;
      case "--deletions": options.deletions = Number(args[++i]); break;
      default:
        console.error(`unknown argument: ${arg}`);
        console.error(MARK_USAGE);
        process.exit(2);
    }
  }
  return options;
}

function telemetryMark(args) {
  const options = parseMarkArgs(args);
  if (!options.type || !MARKER_TYPES.has(options.type)) {
    console.error(`--type is required and must be one of: ${[...MARKER_TYPES].join(", ")}`);
    console.error(MARK_USAGE);
    process.exit(2);
  }
  if (!options.title || !options.title.trim()) {
    console.error("--title is required");
    console.error(MARK_USAGE);
    process.exit(2);
  }
  if (options.expected_direction && !EXPECTED_DIRECTIONS.has(options.expected_direction)) {
    console.error(`--expect must be one of: ${[...EXPECTED_DIRECTIONS].join(", ")}`);
    process.exit(2);
  }
  if (options.type === "outcome" && (!options.status || !OUTCOME_STATUSES.has(options.status))) {
    console.error(`outcome markers require --status to be one of: ${[...OUTCOME_STATUSES].join(", ")}`);
    process.exit(2);
  }
  if (options.type === "phase" && !options.phase) {
    console.error("phase markers require --phase");
    process.exit(2);
  }
  if (options.task_category != null && !TASK_CATEGORIES.has(options.task_category)) {
    console.error(`--task-category must be one of: ${[...TASK_CATEGORIES].join(", ")}`);
    process.exit(2);
  }
  if (options.task_category != null && options.type !== "outcome") {
    console.error("--task-category is only valid on outcome markers (--type outcome)");
    process.exit(2);
  }
  let marker;
  try {
    marker = createMarker(options);
  } catch (err) {
    console.error(`failed to create marker: ${err.message}`);
    process.exit(1);
  }
  console.log(`marker: ${marker.marker_id}`);
  console.log(`  ts: ${marker.ts}`);
  console.log(`  type: ${marker.type}`);
  console.log(`  title: ${marker.title}`);
  console.log(`  repo: ${marker.repo ?? "unknown"}  branch: ${marker.branch ?? "unknown"}  sha: ${marker.sha ?? "unknown"}`);
  console.log(`  snapshot: ${marker.config_snapshot_id ?? "unavailable"}`);
  if (marker.task_category) {
    console.log(`  task_category: ${marker.task_category} (${marker.task_category_source})`);
  }
  if (marker.task_scale) {
    console.log(`  task_scale: files=${marker.task_scale.files_touched ?? "?"} dirs=${marker.task_scale.directories_touched ?? "?"} +${marker.task_scale.insertions ?? "?"}/-${marker.task_scale.deletions ?? "?"} cross_cutting=${marker.task_scale.cross_cutting}`);
  }
}

// --------------------------------------------------------------------------- experiments

const EXPERIMENT_USAGE = "usage: roborepo telemetry experiment start --title <title> --metric <id> "
  + "--expect increase|decrease|no-change [--guardrail <id>]... [--task-category <id>]... "
  + "[--minimum-sessions <n>] [--comparison previous-equivalent-window|midpoint]\n"
  + "       roborepo telemetry experiment end <experiment-id>\n"
  + "       roborepo telemetry experiment status [<experiment-id>]";

function parseExperimentStartArgs(args) {
  const options = { guardrails: [], task_categories: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--title": options.title = args[++i]; break;
      case "--metric": options.metric = args[++i]; break;
      case "--expect": options.expected_direction = args[++i]; break;
      case "--guardrail": options.guardrails.push(args[++i]); break;
      case "--task-category": options.task_categories.push(args[++i]); break;
      case "--minimum-sessions": options.minimum_sessions_per_cohort = Number(args[++i]); break;
      case "--comparison": options.comparison = args[++i]; break;
      default:
        console.error(`unknown argument: ${arg}`);
        console.error(EXPERIMENT_USAGE);
        process.exit(2);
    }
  }
  return options;
}

function telemetryExperiment(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case "start":
      return telemetryExperimentStart(rest);
    case "end":
      return telemetryExperimentEnd(rest);
    case "status":
      return telemetryExperimentStatus(rest);
    default:
      console.error(EXPERIMENT_USAGE);
      process.exit(2);
  }
}

function telemetryExperimentStart(args) {
  const options = parseExperimentStartArgs(args);
  if (!options.title || !options.title.trim()) {
    console.error("--title is required");
    console.error(EXPERIMENT_USAGE);
    process.exit(2);
  }
  if (!options.metric || !options.metric.trim()) {
    console.error("--metric is required");
    console.error(EXPERIMENT_USAGE);
    process.exit(2);
  }
  if (!options.expected_direction || !EXPECTED_DIRECTIONS.has(options.expected_direction)) {
    console.error(`--expect is required and must be one of: ${[...EXPECTED_DIRECTIONS].join(", ")}`);
    process.exit(2);
  }
  if (options.minimum_sessions_per_cohort != null && (!Number.isInteger(options.minimum_sessions_per_cohort) || options.minimum_sessions_per_cohort < 1)) {
    console.error("--minimum-sessions must be a positive integer");
    process.exit(2);
  }
  let result;
  try {
    result = startExperiment(options);
  } catch (err) {
    console.error(`failed to start experiment: ${err.message}`);
    process.exit(1);
  }
  console.log(`experiment: ${result.experiment.experiment_id}`);
  console.log(`  title: ${result.experiment.title}`);
  console.log(`  start marker: ${result.startMarker.marker_id}`);
  console.log(`  primary metric: ${result.experiment.primary_metric} (expect ${result.experiment.expected_direction})`);
}

function telemetryExperimentEnd(args) {
  const [experimentId, ...rest] = args;
  rejectArgs(rest);
  if (!experimentId) {
    console.error(EXPERIMENT_USAGE);
    process.exit(2);
  }
  let result;
  try {
    result = endExperiment(experimentId);
  } catch (err) {
    console.error(`failed to end experiment: ${err.message}`);
    process.exit(1);
  }
  console.log(`experiment ended: ${result.experiment.experiment_id}`);
  console.log(`  end marker: ${result.endMarker.marker_id}`);
}

function telemetryExperimentStatus(args) {
  const [experimentId, ...rest] = args;
  rejectArgs(rest);
  let statuses;
  try {
    statuses = experimentStatus(experimentId || null);
  } catch (err) {
    console.error(`failed to read experiment status: ${err.message}`);
    process.exit(1);
  }
  if (statuses.length === 0) {
    console.log("no experiments found.");
    return;
  }
  for (const status of statuses) {
    console.log(`experiment: ${status.experiment_id}  [${status.state}]`);
    console.log(`  title: ${status.title}`);
    console.log(`  metric: ${status.primary_metric} (expect ${status.expected_direction})`);
    console.log(`  started: ${status.started_at ?? "unknown"}${status.ended_at ? `  ended: ${status.ended_at}` : ""}`);
    if (status.guardrails.length) console.log(`  guardrails: ${status.guardrails.join(", ")}`);
    console.log(`  ready: ${status.ready}`);
    if (status.cohorts) {
      console.log(`  cohorts: before=${status.cohorts.before.sessions} sessions (${formatMetricValue(status.cohorts.before.value)}), after=${status.cohorts.after.sessions} sessions (${formatMetricValue(status.cohorts.after.value)})`);
      console.log(`  effect size: ${status.effect_size == null ? "unknown" : status.effect_size}  confidence: ${status.confidence}`);
    }
    for (const warning of status.data_quality_warnings) console.log(`  warning: ${warning}`);
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

// Thin wrapper over the canonical cross-harness hook composer (hook-composition.mjs), so the
// standalone `roborepo telemetry install` path and the package-driven `enable telemetry` path
// share one hook definition and one merge implementation — never two independently-maintained copies.
function wireCaptureHooks(settingsPath, harness) {
  const fragmentPath = path.join(repoRoot, "globals", "packages", "telemetry", `hooks-${harness}.json`);
  const fragment = JSON.parse(fs.readFileSync(fragmentPath, "utf8"));
  mergeHooksInto(harness, settingsPath, fragment);
}

function telemetryStop(args) {
  rejectArgs(args);
  const stopped = stopServer();
  ensureTelemetryDirs();
  writeTelemetryState({ enabled: false });
  markTelemetrySelected(false);
  console.log(stopped ? "telemetry: disabled · server stopped" : "telemetry: disabled · no server was running");
}

async function telemetryEnable(args) {
  rejectArgs(args);
  const result = await mutatePackage("telemetry", true);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log("telemetry: enabled");
  console.log("note: capture adds a small amount of overhead to every tool call (reads the transcript to size the latest turn).");
  telemetryStatus([]);
}

async function telemetryDisable(args) {
  rejectArgs(args);
  const result = await mutatePackage("telemetry", false);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log("telemetry: disabled");
}

// Programmatic capture-state toggle, shared by the CLI verbs and the config controls. Only flips the
// service's own enabled flag/selection state — hook install/removal is a separate `hooks` component
// on the telemetry package, handled by the generic enable/disable switch in packages.mjs. Does not
// start/stop the portal server — the dashboard toggle is about capture, not the server. Returns
// { ok, message }.
export function setTelemetryEnabled(enabled) {
  try {
    ensureTelemetryDirs();
    writeTelemetryState({ enabled });
    markTelemetrySelected(enabled);
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
  printDataQualityWarnings(report.data_quality_warnings);
  printReadWarnings(report.read_warnings);
  printCodexProviderRateLimits(report.codex_provider_rate_limits);
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

function printDataQualityWarnings(warnings) {
  if (!warnings || warnings.length === 0) return;
  console.log("\ndata quality warnings:");
  for (const warning of warnings.slice(0, 8)) {
    console.log(`  ${warning.harness || "unknown"} ${warning.type}: ${warning.hint} (${warning.events} events)`);
  }
}

function printReadWarnings(warnings) {
  if (!warnings || warnings.length === 0) return;
  console.log("\nread warnings:");
  for (const warning of warnings.slice(0, 8)) {
    const size = warning.approx_tokens ? ` ~${fmt(warning.approx_tokens)} tok` : "";
    const file = warning.file_ext ? ` ${warning.file_ext}/${warning.file_path_hash || "unknown"}` : "";
    console.log(`  ${warning.type} ${warning.repo}/${warning.session_short_id}${file}${size}: ${warning.hint}`);
  }
}

function printCodexProviderRateLimits(rateLimits) {
  if (!rateLimits) return;
  const rows = Array.isArray(rateLimits) ? rateLimits : [rateLimits];
  if (rows.length === 0) return;
  console.log("\nCodex provider rate limits (provider-reported, not local estimate):");
  for (const row of rows.slice(0, 4)) {
    const label = row.name || "limit";
    const used = typeof row.used_percent === "number" ? `${row.used_percent}% used` : "usage unknown";
    const window = typeof row.window_minutes === "number" ? `, ${row.window_minutes}m window` : "";
    console.log(`  ${label}: ${used}${window}`);
  }
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

// Terse metric-value formatter for the experiment status printout. Mirrors telemetry-compare.mjs's
// internal formatMetricValue (kept local here since the CLI print layer doesn't import compare.mjs's
// private helpers) — used only for human-readable output, never fed back into a comparison.
function formatMetricValue(value) {
  if (value == null) return "unknown";
  return String(Math.round(value * 100) / 100);
}

function printComparison(comparison) {
  console.log("\nspike vs normal captures:");
  for (const [label, stats] of [["spike", comparison.spike], ["normal", comparison.normal]]) {
    console.log(`  ${label.padEnd(8)} n=${String(stats.count).padEnd(4)} avg Δ=${fmt(stats.avg_delta).padStart(8)} tok  avg tools=${stats.avg_tool_calls}  mcp rate=${stats.mcp_rate}`);
  }
}

function telemetryExport(args) {
  rejectSupportedReportArgs(args);
  console.log(JSON.stringify({
    captures: readSpoolEvents(),
    markers: readMarkers(),
    snapshots: readSnapshots(),
    experiments: readExperiments(),
  }, null, 2));
}

export async function serveCommand(args, { allowPortFallback = false, openPath = "" } = {}) {
  const options = parseServeArgs(args);
  if (options.detach) {
    const port = await startDetachedPortal(options.port, { allowPortFallback, portExplicit: options.portExplicit });
    const detachedPortalUrl = `http://127.0.0.1:${port}`;
    console.log(`roborepo portal: ${detachedPortalUrl}  (detached · use: roborepo telemetry stop)`);
    if (options.open) openLocalUrl(`${detachedPortalUrl}${openPath}`);
    return;
  }
  const resolved = await resolvePortalPort(options.port, {
    allowPortFallback,
    portExplicit: options.portExplicit,
    warn: true,
  });
  if (resolved.reuse) {
    const existingUrl = `http://127.0.0.1:${resolved.port}`;
    writePid(resolved.pid);
    console.log(`roborepo portal already running: ${existingUrl}`);
    if (options.open) openLocalUrl(`${existingUrl}${openPath}`);
    return;
  }
  // Not reusing: any previously tracked portal (foreground or detached, on any port — including a
  // prior `--port 0` instance that resolvePortalPort never probes) is about to be superseded by
  // this one, so stop it first instead of leaving it running alongside the new instance.
  killExistingServer();
  writePid(process.pid);
  options.port = resolved.port;
  const portalUrl = (port) => `http://127.0.0.1:${port}`;
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
    loadPlans: () => loadPlansSnapshot(),
    loadPlanDocument: (params) => loadPlanDocument(params),
    buildPlansPrompt: (params) => buildPlansPrompt(params),
    updatePlanSettings: (params) => updatePlanSettings(params),
    refreshPlans: () => refreshPlans(),
    loadLocalhoster: () => loadLocalhosterSnapshot(),
    refreshLocalhoster: () => refreshLocalhosterSnapshot(),
    updateLocalhosterSettings: (params) => updateLocalhosterSettings(params),
    loadLocalhosterHistory: (key) => loadLocalhosterHistory(key),
    loadLocalhosterMetadata: (key) => loadLocalhosterMetadata(key),
    mutatePackage: (id, enabled) => mutatePackage(id, enabled),
    mutateSkill: (id, enabled) => setSkillInstalled(id, enabled),
    mutateBehavior: (behaviorId, bucket) => setBehaviorBucket(behaviorId, bucket),
    mutateCommand: (tokens, bucket) => setCommandBucket(tokens, bucket),
    onListening: (actualPort) => {
      setLocalhosterPortalInfo({ port: actualPort });
      if (options.open) openLocalUrl(`${portalUrl(actualPort)}${openPath}`);
    },
  });
}

function parseServeArgs(args) {
  const options = { port: 4317, portExplicit: false, detach: false, open: true, allowZeroPort: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port") {
      options.port = Number(args[++i]);
      options.portExplicit = true;
    } else if (arg.startsWith("--port=")) {
      options.port = Number(arg.slice("--port=".length));
      options.portExplicit = true;
    }
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

async function startDetachedPortal(port, { allowPortFallback = false, portExplicit = false } = {}) {
  killExistingServer();
  const resolved = await resolvePortalPort(port, { allowPortFallback, portExplicit, warn: true });
  if (resolved.reuse) {
    writePid(resolved.pid);
    return resolved.port;
  }
  const selectedPort = resolved.port;
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

async function resolvePortalPort(port, { allowPortFallback = false, portExplicit = false, warn = false } = {}) {
  if (port === 0 || await canBindPort(port)) return { port, reuse: false };

  const existing = await probePortal(port);
  if (existing.current) return { port, reuse: true, pid: existing.pid };

  if (allowPortFallback || !portExplicit) {
    if (warn) {
      console.error(
        `port ${port} is occupied by a non-current or unhealthy process; starting this portal on an available port instead.`,
      );
    }
    return { port: 0, reuse: false };
  }

  console.error(`port ${port} is occupied by a non-current or unhealthy process; stop it or pass --port <n>.`);
  process.exit(1);
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

async function probePortal(port) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/portal/status`, { signal: controller.signal });
    if (!res.ok) return { current: false };
    const data = await res.json();
    const currentPortalDir = path.join(repoRoot, "portal");
    const pid = Number(data?.pid);
    return {
      current: data?.ok === true && data?.appRoot === repoRoot && data?.portalDir === currentPortalDir && Number.isInteger(pid),
      pid,
    };
  } catch {
    return { current: false };
  } finally {
    clearTimeout(timeout);
  }
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
        finish({ ok: false, message: `portal server did not become ready on http://127.0.0.1:${port}` });
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

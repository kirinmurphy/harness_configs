import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { markTelemetrySelected, presetsApply } from "./presets.mjs";
import { telemetryCollectorDir, telemetryDbPath, telemetryDir, telemetrySpoolDir } from "./state-paths.mjs";

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
    case "purge":
      return telemetryPurge(args);
    case "capture":
      return telemetryCapture(args);
    default:
      console.error("usage: roborepo telemetry enable|disable|status|report|export|purge");
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
  const byRepo = countBy(events, (event) => event.repo?.label ?? "unknown");
  const byTool = countBy(events, (event) => event.tool?.name ?? event.event ?? "unknown");
  console.log(`events: ${events.length}`);
  printTop("repos", byRepo);
  printTop("tools/events", byTool);
}

function telemetryExport(args) {
  rejectSupportedReportArgs(args);
  console.log(JSON.stringify(readSpoolEvents(), null, 2));
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
  const record = {
    ts: new Date().toISOString(),
    harness: options.harness,
    event: options.event || input.hook_event_name || input.hookEventName || "unknown",
    session_id: input.session_id || input.conversation_id || null,
    cwd_hash: hash(cwd),
    repo: repoMetadata(cwd),
    tool: toolMetadata(input),
    prompt: promptMetadata(input),
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
  return {
    name,
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

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() : "";
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
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

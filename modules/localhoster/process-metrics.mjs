// Current-snapshot process metrics (PID, CPU%, resident memory, elapsed runtime) for discovered
// listener PIDs. Facts only — never persisted to settings, matching the plan's "snapshot facts
// only" boundary.
//
// One batched `ps` call for every PID in a scan, not one call per PID: same "N things, one call"
// discipline as git's per-root dedup and Docker's single `docker ps` pass.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const PROCESS_METRICS_TIMEOUT_MS = 1500;

const execFileAsync = promisify(execFile);

export async function collectProcessMetrics(pids, {
  platform = process.platform,
  runCommand = defaultRunCommand,
  timeoutMs = PROCESS_METRICS_TIMEOUT_MS,
} = {}) {
  const uniquePids = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  if (platform !== "darwin" || uniquePids.length === 0) return new Map();

  let result;
  try {
    result = await runCommand("ps", ["-o", "pid=,ppid=,pcpu=,rss=,etime=,comm=", "-p", uniquePids.join(",")], { timeoutMs });
  } catch {
    // A PID list with zero surviving processes makes `ps` exit non-zero on some platforms; either
    // way, missing metrics for a scan is not an error the caller should see, just absence.
    return new Map();
  }
  return parsePsOutput(result.stdout ?? result);
}

// Fields are fixed-width via the `key=` (no header, empty label) form, but values are
// whitespace-padded, so split on runs of whitespace. `comm` is last and may itself contain spaces
// (an app path with a space in it), so it is rejoined from the remaining tokens.
export function parsePsOutput(output) {
  const byPid = new Map();
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;
    const [pidStr, ppidStr, cpuStr, rssStr, etimeStr, ...commParts] = parts;
    const pid = Number(pidStr);
    if (!Number.isInteger(pid)) continue;
    const elapsedSeconds = parseElapsed(etimeStr);
    byPid.set(pid, {
      pid,
      ppid: Number.isInteger(Number(ppidStr)) ? Number(ppidStr) : null,
      cpuPercent: Number.isFinite(Number(cpuStr)) ? Number(cpuStr) : null,
      residentMemoryKb: Number.isFinite(Number(rssStr)) ? Number(rssStr) : null,
      elapsedSeconds,
      command: commParts.join(" ") || null,
    });
  }
  return byPid;
}

// `ps etime` formats, shortest to longest: "SS", "MM:SS", "HH:MM:SS", "DD-HH:MM:SS".
function parseElapsed(value) {
  const dayMatch = value.match(/^(\d+)-(\d{2}):(\d{2}):(\d{2})$/);
  if (dayMatch) {
    const [, days, hours, minutes, seconds] = dayMatch.map(Number);
    return days * 86400 + hours * 3600 + minutes * 60 + seconds;
  }
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

export async function defaultRunCommand(command, args, { timeoutMs } = {}) {
  return execFileAsync(command, args, { timeout: timeoutMs, encoding: "utf8", maxBuffer: 1024 * 1024 });
}

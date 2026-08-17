// Stale portal PID files — detection and cleanup.
//
// Each detached portal writes ~/.roborepo/portal/server-<port>.pid. Nothing removes that file when
// the process dies without a clean `roborepo web stop` (SIGKILL, a crash, a reboot, or the machine
// simply being powered off), so the directory accumulates files pointing at PIDs that no longer
// exist. Two concrete symptoms this addresses:
//   - `roborepo web --port 0` records server-0.pid, and port 0 means "kernel, pick one" — the file
//     can never match a real listening port, so nothing ever reaps it.
//   - A pid file that outlives its process makes the portal look running when it is not.
//
// LIVENESS IS DELIBERATELY NOT telemetry.mjs's isProcessRunning(). That helper treats EPERM as
// "not running", which is right for its callers (they are about to signal the process, and a
// signal they cannot send would fail anyway) but WRONG here: a portal started by another user is
// alive, and deleting its PID file because we lack permission to signal it would be data loss
// driven by a permissions accident. This module only reaps on ESRCH — a definitive "no such
// process" from the kernel — and reports anything ambiguous as live.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { portalStateDir } from "./state-paths.mjs";

const PID_FILE = /^server-(\d+)\.pid$/;

// Tri-state on purpose. "unknown" (EPERM and anything else unexpected) is grouped with live at
// every call site below; it exists as its own value so a caller can tell "definitely alive" from
// "cannot tell" without re-deriving the errno rules.
export function pidLiveness(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return "invalid";
  try {
    process.kill(pid, 0);
    return "live";
  } catch (error) {
    if (error.code === "ESRCH") return "dead";
    return "unknown";
  }
}

// Reads every server-<port>.pid without touching anything. A missing directory is the normal state
// on a machine that has never started a portal, so it reports empty rather than failing.
export function scanPortalPids({ dir = portalStateDir } = {}) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const entries = [];
  for (const name of names.sort()) {
    const match = PID_FILE.exec(name);
    if (!match) continue;
    const file = path.join(dir, name);
    const port = Number(match[1]);
    let pid = null;
    try {
      pid = parseInt(fs.readFileSync(file, "utf8").trim(), 10);
    } catch {
      pid = null;
    }
    if (!Number.isInteger(pid)) pid = null;

    const liveness = pid === null ? "invalid" : pidLiveness(pid);
    entries.push({
      file,
      name,
      port,
      pid,
      liveness,
      // A `--port 0` file is unreapable by port: port 0 asks the kernel to choose, so the recorded
      // port never matches the socket that was actually bound. Flagged separately because it is
      // stale-by-construction even in the instant its process is still alive.
      unreapablePort: port === 0,
      stale: liveness === "dead" || liveness === "invalid",
    });
  }
  return entries;
}

// Deletes only definitively-dead entries. Live and unknown are always preserved.
export function reapPortalPids({ dir = portalStateDir } = {}) {
  const entries = scanPortalPids({ dir });
  const removed = [];
  const kept = [];
  for (const entry of entries) {
    if (!entry.stale) {
      kept.push(entry);
      continue;
    }
    try {
      fs.rmSync(entry.file, { force: true });
      removed.push(entry);
    } catch (error) {
      kept.push({ ...entry, error: error.message });
    }
  }
  return { removed, kept };
}

function checkMode() {
  const stale = scanPortalPids().filter((entry) => entry.stale);
  if (stale.length === 0) return 0;
  const names = stale.map((entry) => entry.name).join(", ");
  console.log(`${stale.length} stale portal pid file(s): ${names} — clear with \`roborepo maintenance portal-pids --reap\``);
  return 0;
}

function describe(entry) {
  if (entry.liveness === "invalid") return `${entry.name} (unreadable pid)`;
  const suffix = entry.unreapablePort ? " — started with --port 0, which can never be matched by port" : "";
  return `${entry.name} (pid ${entry.pid})${suffix}`;
}

// `roborepo maintenance portal-pids [--reap]`.
//
// Report-only by default. Doctor calls this path, and a health check that silently deletes files
// is a surprise: the user asked what is wrong, not for it to be changed underneath them.
export function portalPidsCommand(args = []) {
  const reap = args.includes("--reap");
  // --check is doctor's contract across this repo's verifiers: print a one-line summary and say
  // nothing when clean. Stale PID files are leftovers, not breakage, so this always exits 0 — a
  // machine that lost a portal to a reboot should not show a red doctor.
  if (args.includes("--check")) return checkMode();
  const unknown = args.filter((arg) => arg !== "--reap");
  if (unknown.length) {
    console.error("usage: roborepo maintenance portal-pids [--reap]");
    return 2;
  }

  const entries = scanPortalPids();
  if (entries.length === 0) {
    console.log("portal pid files: none");
    return 0;
  }

  const stale = entries.filter((entry) => entry.stale);
  const live = entries.filter((entry) => !entry.stale);

  for (const entry of live) {
    const label = entry.liveness === "unknown" ? "running (owned by another user)" : "running";
    console.log(`  ok    ${describe(entry)} — ${label}`);
  }

  if (!reap) {
    for (const entry of stale) console.log(`  stale ${describe(entry)} — no such process`);
    if (stale.length) {
      console.log("");
      console.log(`${stale.length} stale portal pid file(s); remove with: roborepo maintenance portal-pids --reap`);
    }
    return 0;
  }

  const { removed, kept } = reapPortalPids();
  for (const entry of removed) console.log(`  removed ${describe(entry)}`);
  for (const entry of kept.filter((candidate) => candidate.error)) {
    console.error(`  failed  ${describe(entry)} — ${entry.error}`);
  }
  console.log("");
  console.log(`removed ${removed.length} stale portal pid file(s)`);
  return kept.some((entry) => entry.error) ? 1 : 0;
}

// Direct-invocation entry so scripts/doctor.sh can run `node portal-pid-reaper.mjs --check`
// without going through the CLI dispatcher — matching maintenance-stores.mjs.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(portalPidsCommand(process.argv.slice(2)));
}

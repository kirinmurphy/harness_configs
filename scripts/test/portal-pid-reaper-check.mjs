#!/usr/bin/env node
// Stale portal PID reaping. Every case runs against a temp directory passed explicitly as `dir` —
// never the real ~/.roborepo/portal, because a bug in the code under test would otherwise delete a
// developer's live portal PID file as a side effect of running the suite.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pidLiveness, reapPortalPids, scanPortalPids } from "../cli/portal-pid-reaper.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-portal-pids-"));

function write(name, contents) {
  fs.writeFileSync(path.join(dir, name), contents);
}

// A PID that is real and definitely alive: this process.
const livePid = process.pid;

// A PID that is definitely dead. Picking a high number is not enough — the OS could genuinely have
// it in use — so scan upward until the kernel reports ESRCH for one.
function findDeadPid() {
  for (let candidate = 90000; candidate < 99000; candidate += 1) {
    if (pidLiveness(candidate) === "dead") return candidate;
  }
  throw new Error("could not find a dead pid to test with");
}
const deadPid = findDeadPid();

write("server-4317.pid", String(livePid));
write("server-58473.pid", String(deadPid));
write("server-0.pid", String(deadPid));
write("server-4400.pid", "not-a-number");
write("notes.txt", "ignored: not a pid file");

const scanned = scanPortalPids({ dir });
assert.deepEqual(
  scanned.map((entry) => entry.name).sort(),
  ["server-0.pid", "server-4317.pid", "server-4400.pid", "server-58473.pid"],
  "scan reads every server-<port>.pid and ignores unrelated files",
);

const byName = Object.fromEntries(scanned.map((entry) => [entry.name, entry]));
assert.equal(byName["server-4317.pid"].liveness, "live");
assert.equal(byName["server-4317.pid"].stale, false, "a running portal is never stale");
assert.equal(byName["server-58473.pid"].liveness, "dead");
assert.equal(byName["server-58473.pid"].stale, true);
assert.equal(byName["server-4400.pid"].liveness, "invalid", "an unparseable pid file is stale, not a crash");
assert.equal(byName["server-4400.pid"].stale, true);
assert.equal(byName["server-0.pid"].unreapablePort, true, "--port 0 files are flagged as unreapable by port");
assert.equal(byName["server-4317.pid"].unreapablePort, false);

// The safety property this module exists for. isProcessRunning() in telemetry.mjs reports EPERM as
// "not running"; if the reaper ever adopts that helper, a portal owned by another user would be
// treated as dead and its PID file deleted. pid 1 is root-owned on macOS and Linux alike, so it is
// a stable stand-in for "alive but not signalable by us".
assert.equal(pidLiveness(1), "unknown", "EPERM must read as unknown, never as dead");
write("server-4318.pid", "1");
const withForeign = scanPortalPids({ dir });
const foreign = withForeign.find((entry) => entry.name === "server-4318.pid");
assert.equal(foreign.stale, false, "a live process we cannot signal must never be reaped");

const { removed, kept } = reapPortalPids({ dir });
assert.deepEqual(
  removed.map((entry) => entry.name).sort(),
  ["server-0.pid", "server-4400.pid", "server-58473.pid"],
  "reap removes exactly the dead and unreadable entries",
);
assert.deepEqual(
  kept.map((entry) => entry.name).sort(),
  ["server-4317.pid", "server-4318.pid"],
  "reap keeps the live entry and the one owned by another user",
);
assert.ok(fs.existsSync(path.join(dir, "server-4317.pid")), "live pid file still on disk");
assert.ok(fs.existsSync(path.join(dir, "server-4318.pid")), "foreign pid file still on disk");
assert.ok(fs.existsSync(path.join(dir, "notes.txt")), "unrelated files are never touched");
assert.equal(fs.existsSync(path.join(dir, "server-58473.pid")), false);

// A machine that has never started a portal has no directory at all; that is normal, not an error.
assert.deepEqual(scanPortalPids({ dir: path.join(dir, "does-not-exist") }), []);

fs.rmSync(dir, { recursive: true, force: true });
console.log("portal pid reaper checks passed");

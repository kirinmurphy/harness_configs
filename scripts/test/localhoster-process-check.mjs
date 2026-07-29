#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  collectProcessMetrics,
  parsePsOutput,
} from "../../modules/localhoster/process-metrics.mjs";

// Normal reading: short-form etime ("MM:SS"), long-form ("HH:MM:SS"), and day-qualified
// ("DD-HH:MM:SS") all parse to seconds.
assert.deepEqual(parsePsOutput([
  "  101    1   2.5  16384    05:30 node",
  "  202  101   0.0   2048 01:02:03 python3",
  "  303    1  10.1  65536 2-03:04:05 /usr/local/bin/some app",
].join("\n")), new Map([
  [101, { pid: 101, ppid: 1, cpuPercent: 2.5, residentMemoryKb: 16384, elapsedSeconds: 330, command: "node" }],
  [202, { pid: 202, ppid: 101, cpuPercent: 0, residentMemoryKb: 2048, elapsedSeconds: 3723, command: "python3" }],
  [303, { pid: 303, ppid: 1, cpuPercent: 10.1, residentMemoryKb: 65536, elapsedSeconds: 183845, command: "/usr/local/bin/some app" }],
]));

// Bare seconds form ("SS").
assert.equal(parsePsOutput("  404    1   0.0   1024   45 node").get(404).elapsedSeconds, 45);

// Malformed line (too few fields) is skipped rather than throwing or half-populating an entry.
assert.deepEqual(parsePsOutput("garbage line\n\n  101    1   2.5  16384    05:30 node"), new Map([
  [101, { pid: 101, ppid: 1, cpuPercent: 2.5, residentMemoryKb: 16384, elapsedSeconds: 330, command: "node" }],
]));

assert.deepEqual(parsePsOutput(""), new Map());
assert.deepEqual(parsePsOutput(null), new Map());

// Non-darwin never invokes the subprocess.
{
  const result = await collectProcessMetrics([101], {
    platform: "linux",
    runCommand: async () => {
      throw new Error("must not execute");
    },
  });
  assert.deepEqual(result, new Map());
}

// Empty pid list never invokes the subprocess.
{
  const result = await collectProcessMetrics([], {
    platform: "darwin",
    runCommand: async () => {
      throw new Error("must not execute");
    },
  });
  assert.deepEqual(result, new Map());
}

// Duplicate pids are deduped into a single `-p` argument.
{
  let capturedArgs;
  await collectProcessMetrics([101, 101, 202], {
    platform: "darwin",
    runCommand: async (command, args) => {
      capturedArgs = args;
      return { stdout: "" };
    },
  });
  assert.deepEqual(capturedArgs, ["-o", "pid=,ppid=,pcpu=,rss=,etime=,comm=", "-p", "101,202"]);
}

// Exited process (ps returns nothing for a pid that no longer exists by the time it runs, or ps
// itself exits non-zero for a fully-empty surviving set) yields an empty map, not a fabricated
// zeroed reading.
{
  const result = await collectProcessMetrics([999], {
    platform: "darwin",
    runCommand: async () => {
      throw new Error("ps: illegal option or bad pid list");
    },
  });
  assert.deepEqual(result, new Map());
}

// Batched multi-pid parse: one call for all discovered pids in a scan.
{
  const result = await collectProcessMetrics([101, 202], {
    platform: "darwin",
    runCommand: async () => ({
      stdout: [
        "  101    1   2.5  16384    05:30 node",
        "  202  101   0.0   2048 01:02:03 python3",
      ].join("\n"),
    }),
  });
  assert.equal(result.size, 2);
  assert.equal(result.get(101).command, "node");
  assert.equal(result.get(202).cpuPercent, 0);
}

console.log("ok: localhoster process-metrics provider");

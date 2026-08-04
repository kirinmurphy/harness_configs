#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  collectDockerStats,
  parseDockerStatsOutput,
} from "../../modules/localhoster/docker-stats.mjs";

// Real `docker stats --no-stream --format {{json .}}` line shape.
const statsLine = JSON.stringify({
  BlockIO: "112MB / 0B",
  CPUPerc: "33.43%",
  Container: "f0908deffd38d9541cc39354ffe0bf3ba777eb0dd5ab44878c96f55b9408f031",
  ID: "f0908deffd38",
  MemPerc: "59.25%",
  MemUsage: "151.7MiB / 256MiB",
  Name: "traefik-proxy",
  NetIO: "1.7kB / 126B",
  PIDs: "18",
});

assert.deepEqual(parseDockerStatsOutput(statsLine, { cpuCount: 8 }), new Map([
  ["f0908deffd38", {
    containerId: "f0908deffd38",
    cpuPercent: 33.43,
    cpuPercentOfHost: 33.43 / 8,
    residentMemoryKb: 151.7 * 1024,
  }],
]));

// `docker stats` reports percent of ONE core, so a container saturating two cores of an 8-core host
// reads 200% — which is 25% of the machine. Only the normalized figure is summable across a
// project's containers; summing the per-core values produced meaningless totals (e.g. 161%).
{
  const twoCores = parseDockerStatsOutput(
    JSON.stringify({ ID: "busy", CPUPerc: "200.00%", MemUsage: "1GiB / 8GiB" }),
    { cpuCount: 8 },
  ).get("busy");
  assert.equal(twoCores.cpuPercent, 200);
  assert.equal(twoCores.cpuPercentOfHost, 25);
}

// A zero/unknown core count must not produce Infinity or NaN — the normalized field goes null and
// callers fall back to hiding the reading rather than showing a fabricated one.
{
  const noCores = parseDockerStatsOutput(statsLine, { cpuCount: 0 }).get("f0908deffd38");
  assert.equal(noCores.cpuPercent, 33.43);
  assert.equal(noCores.cpuPercentOfHost, null);
}

// Two containers report distinct readings — the exact case the shared-VM-proxy `ps` bug collapsed
// into identical numbers.
const secondLine = JSON.stringify({
  CPUPerc: "0.30%",
  ID: "86e2a0958cbf",
  MemUsage: "135MiB / 15.62GiB",
  Name: "supabase_db_menugoats",
});
{
  const result = parseDockerStatsOutput([statsLine, secondLine].join("\n"));
  assert.equal(result.size, 2);
  assert.notEqual(result.get("f0908deffd38").cpuPercent, result.get("86e2a0958cbf").cpuPercent);
}

// GiB/KiB/B units all convert to KB.
assert.equal(
  parseDockerStatsOutput(JSON.stringify({ ID: "a", CPUPerc: "0%", MemUsage: "1GiB / 2GiB" })).get("a").residentMemoryKb,
  1024 * 1024,
);
assert.equal(
  parseDockerStatsOutput(JSON.stringify({ ID: "b", CPUPerc: "0%", MemUsage: "512KiB / 1GiB" })).get("b").residentMemoryKb,
  512,
);

// Malformed line skipped, not thrown.
assert.deepEqual(parseDockerStatsOutput([
  "not json",
  JSON.stringify({ Name: "no-id-field" }),
  statsLine,
  "",
].join("\n")), parseDockerStatsOutput(statsLine));

assert.deepEqual(parseDockerStatsOutput(""), new Map());
assert.deepEqual(parseDockerStatsOutput(null), new Map());

// Non-darwin never invokes the subprocess.
{
  const result = await collectDockerStats({
    platform: "linux",
    runCommand: async () => {
      throw new Error("must not execute");
    },
  });
  assert.deepEqual(result, new Map());
}

// Docker unavailable (not installed, daemon down, etc.) yields empty map, not a thrown error —
// discoverDockerRecords already surfaces the warning for this, so this provider stays silent.
{
  const result = await collectDockerStats({
    platform: "darwin",
    runCommand: async () => {
      throw new Error("Cannot connect to the Docker daemon");
    },
  });
  assert.deepEqual(result, new Map());
}

// Successful scan calls the expected command shape and parses the result.
{
  const result = await collectDockerStats({
    platform: "darwin",
    runCommand: async (command, args) => {
      assert.equal(command, "docker");
      assert.deepEqual(args, ["stats", "--no-stream", "--format", "{{json .}}"]);
      return { stdout: statsLine };
    },
  });
  assert.equal(result.size, 1);
  assert.equal(result.get("f0908deffd38").cpuPercent, 33.43);
}

console.log("ok: localhoster docker-stats provider");

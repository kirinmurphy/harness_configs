#!/usr/bin/env node
// Micro-benchmark for the telemetry spool read/analyze path. Measures each stage against the live
// spool so performance changes are measured, not assumed. Not part of the automated suite — run by
// hand: `node scripts/test/telemetry-spool-bench.mjs`.
//
// Reports, warmed (median of N):
//   - full read:        readdir + readFileSync + split + JSON.parse of the whole spool
//   - incremental sync: readSpoolEventsCached() when nothing changed (the steady-state cost)
//   - analyze:          analyzeTelemetry over the parsed events
//   - stringify:        JSON.stringify of the report (response serialization)
import fs from "node:fs";
import path from "node:path";
import { telemetrySpoolDir } from "../cli/state-paths.mjs";
import { analyzeTelemetry } from "../cli/telemetry-analyze.mjs";
import { readSpoolEventsCached, _resetSpoolStoreForTests } from "../cli/telemetry.mjs";

const RUNS = 7;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function time(fn) {
  const t = performance.now();
  const out = fn();
  return { ms: performance.now() - t, out };
}

function bench(label, fn) {
  fn(); // warm JIT
  const times = [];
  let out;
  for (let i = 0; i < RUNS; i++) {
    const r = time(fn);
    times.push(r.ms);
    out = r.out;
  }
  console.log(`${label.padEnd(20)} median ${median(times).toFixed(2)}ms  min ${Math.min(...times).toFixed(2)}ms`);
  return out;
}

function fullRead() {
  const events = [];
  let files = [];
  try {
    files = fs.readdirSync(telemetrySpoolDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return events;
  }
  for (const file of files) {
    for (const line of fs.readFileSync(path.join(telemetrySpoolDir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {}
    }
  }
  return events;
}

let files = [];
try {
  files = fs.readdirSync(telemetrySpoolDir).filter((f) => f.endsWith(".jsonl"));
} catch {}
let bytes = 0;
for (const f of files) {
  try {
    bytes += fs.statSync(path.join(telemetrySpoolDir, f)).size;
  } catch {}
}
console.log(`spool: ${files.length} file(s), ${(bytes / 1024 / 1024).toFixed(1)}MB`);

const events = bench("full read", fullRead);
console.log(`events: ${events.length}`);

// Prime the incremental store once, then measure the no-change steady state (the number that
// matters: what a poll or a nav pays when nothing new landed).
_resetSpoolStoreForTests();
readSpoolEventsCached();
bench("incremental (warm)", () => readSpoolEventsCached());

const report = bench("analyze", () => analyzeTelemetry(events));
bench("stringify", () => JSON.stringify(report));

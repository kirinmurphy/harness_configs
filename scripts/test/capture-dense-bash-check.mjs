#!/usr/bin/env node
// The capture-dense-bash hook: where it writes, and that it stays bounded.
//
// The path assertion is the point. The hook runs as a copied runtime asset in ~/.claude/hooks/,
// outside the CLI's module graph, so it cannot import denseBashLogPath() and instead re-resolves
// stateRoot itself. Nothing but a test keeps those two in agreement — so this drives the real hook
// as a subprocess under a sandboxed ROBOREPO_STATE_ROOT and asserts the file lands exactly where
// the constant says it should.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const hook = path.join(repoRoot, "globals/packages/capture-dense-bash/hooks/capture-dense-bash.mjs");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-dense-bash-"));

try {
  const { denseBashLogPath } = await importWithStateRoot();
  const expected = denseBashLogPath("claude");

  // ---- A dense command is captured, at the path the constant declares ----
  const dense = run("cd /tmp && echo '=== build ===' && npm run build");
  assert.equal(dense.status, 0, "the hook always exits 0 — it must never block a tool call");
  assert.ok(fs.existsSync(expected), `hook wrote to ${expected}`);

  const records = readRecords(expected);
  assert.equal(records.length, 1, "one dense command produces one record");
  assert.ok(records[0].reasons.includes("chained"), "the chained reason is recorded");
  assert.ok(records[0].reasons.includes("leading-cd"), "the leading-cd reason is recorded");
  assert.equal(typeof records[0].ts, "string", "records carry an ISO timestamp for retention");

  // ---- Nothing under ~/.claude: the old location must not be written ----
  assert.ok(
    !fs.existsSync(path.join(tempRoot, ".claude")),
    "the hook writes nothing into a harness directory",
  );

  // ---- An ordinary command is ignored ----
  run("ls");
  assert.equal(readRecords(expected).length, 1, "an allowlistable command is not captured");

  // ---- Retention: an expired record is dropped once the file clears the compaction floor ----
  // Below the floor the hook deliberately skips measurement, so the fixture has to exceed it for
  // the age policy to be exercised at all.
  const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
  const padding = "p".repeat(2048);
  const stale = [];
  for (let i = 0; i < 40; i += 1) {
    stale.push(JSON.stringify({ ts: old, command: padding, reasons: ["long"], lineCount: 1 }));
  }
  fs.writeFileSync(expected, stale.join("\n") + "\n");
  assert.ok(fs.statSync(expected).size > 64 * 1024, "fixture must clear the compaction floor");

  run("cd /tmp && echo '=== again ===' && make");
  const afterRetention = readRecords(expected);
  assert.ok(
    afterRetention.every((record) => record.ts !== old),
    "records past the 30-day window are dropped",
  );
  assert.ok(afterRetention.length > 0, "trimming never empties the log");

  console.log("ok: capture-dense-bash writes to denseBashLogPath and stays bounded");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

// state-paths.mjs reads stateRoot at import time, so the sandbox env has to be set before the
// import is evaluated — hence the dynamic import after mutating process.env.
async function importWithStateRoot() {
  process.env.ROBOREPO_STATE_ROOT = tempRoot;
  return import(path.join(repoRoot, "scripts/cli/state-paths.mjs"));
}

// Drive the hook the way Claude does: a PreToolUse payload on stdin.
function run(command) {
  return spawnSync(process.execPath, [hook], {
    input: JSON.stringify({
      session_id: "test-session",
      cwd: "/tmp",
      tool_input: { command },
    }),
    env: { ...process.env, ROBOREPO_STATE_ROOT: tempRoot, HOME: tempRoot },
    encoding: "utf8",
  });
}

function readRecords(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

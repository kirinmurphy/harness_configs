#!/usr/bin/env node
// Unit check for readAppendedLines (scripts/cli/jsonl-tail.mjs) — the incremental byte-tail reader
// shared by the telemetry spool store and the transcript reader. Runs against a temp file with a
// cleanup on exit.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readAppendedLines } from "../cli/jsonl-tail.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsonl-tail-"));
const file = path.join(dir, "t.jsonl");

try {
  // Missing file -> ok:false, offset echoed.
  let r = readAppendedLines(path.join(dir, "nope.jsonl"), 0);
  assert.equal(r.ok, false);
  assert.equal(r.nextOffset, 0);
  assert.deepEqual(r.lines, []);
  console.log("ok  missing file");

  // Initial read of two complete lines.
  fs.writeFileSync(file, "a\nbb\n");
  r = readAppendedLines(file, 0);
  assert.deepEqual(r.lines, ["a", "bb"]);
  assert.equal(r.nextOffset, 5); // "a\nbb\n"
  assert.equal(r.rebuilt, false);
  console.log("ok  initial two lines");

  // No-op read from the end -> no lines, offset unchanged.
  r = readAppendedLines(file, r.nextOffset);
  assert.deepEqual(r.lines, []);
  assert.equal(r.nextOffset, 5);
  console.log("ok  no-op at EOF");

  // Append a COMPLETE line -> only the new line, offset advances.
  fs.appendFileSync(file, "ccc\n");
  r = readAppendedLines(file, 5);
  assert.deepEqual(r.lines, ["ccc"]);
  assert.equal(r.nextOffset, 9);
  console.log("ok  append one line");

  // Partial trailing line (no newline) -> held back: no lines, offset does NOT advance past it.
  fs.appendFileSync(file, "ddd"); // no "\n"
  r = readAppendedLines(file, 9);
  assert.deepEqual(r.lines, []);
  assert.equal(r.nextOffset, 9); // unchanged — the partial is re-read next call
  console.log("ok  partial line held");

  // Complete the partial line -> it now reads as one line from the same offset.
  fs.appendFileSync(file, "\n");
  r = readAppendedLines(file, 9);
  assert.deepEqual(r.lines, ["ddd"]);
  assert.equal(r.nextOffset, 13);
  console.log("ok  partial line completed");

  // Shrink/rotation: rewrite the file smaller, read from a now-past-EOF offset -> rebuilt, from 0.
  fs.writeFileSync(file, "x\n");
  r = readAppendedLines(file, 13);
  assert.equal(r.rebuilt, true);
  assert.deepEqual(r.lines, ["x"]);
  assert.equal(r.nextOffset, 2);
  console.log("ok  shrink -> rebuilt from 0");

  // Blank lines are dropped.
  fs.writeFileSync(file, "\n\ny\n\n");
  r = readAppendedLines(file, 0);
  assert.deepEqual(r.lines, ["y"]);
  console.log("ok  blank lines dropped");

  // Multi-byte UTF-8: offset must be in BYTES, not chars, so a later resume aligns.
  fs.writeFileSync(file, "café\n"); // é is 2 bytes -> line is 5 bytes + "\n"
  r = readAppendedLines(file, 0);
  assert.deepEqual(r.lines, ["café"]);
  assert.equal(r.nextOffset, Buffer.byteLength("café\n", "utf8"));
  console.log("ok  utf-8 byte offset");

  console.log("\njsonl-tail checks passed");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

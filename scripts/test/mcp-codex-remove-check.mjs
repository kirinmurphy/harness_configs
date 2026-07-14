#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { removeCodexMcp } = await import("../cli/mcp-codex.mjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-codex-remove-"));
const config = path.join(tmp, "config.toml");

const original = [
  'model = "gpt-5"',
  "",
  "[tools]",
  "web_search = true",
  "",
  "[mcp_servers.keep]",
  'command = "npx"',
  'args = ["-y", "keep"]',
  "",
  "[mcp_servers.drop]",
  'command = "npx"',
  // Array value containing "[" — the old [^[]* regex truncated the block here.
  'args = ["-y", "drop", "--config", "[a,b]"]',
  "",
  "[mcp_servers.after]",
  'command = "after"',
  "",
].join("\n");

fs.writeFileSync(config, original);
removeCodexMcp("drop", { configPath: config });
const afterRemove = fs.readFileSync(config, "utf8");

assert.doesNotMatch(afterRemove, /\[mcp_servers\.drop\]/, "target block is removed");
assert.match(afterRemove, /\[mcp_servers\.keep\][\s\S]*args = \["-y", "keep"\]/, "preceding block intact");
assert.match(afterRemove, /\[mcp_servers\.after\][\s\S]*command = "after"/, "following block not swallowed by bracketed value");
assert.match(afterRemove, /\[tools\][\s\S]*web_search = true/, "unrelated tables untouched");

// Idempotent: removing an absent server leaves the file unchanged.
const before = fs.readFileSync(config, "utf8");
removeCodexMcp("drop", { configPath: config });
assert.equal(fs.readFileSync(config, "utf8"), before, "removing absent server is a no-op");

// Missing file is tolerated.
removeCodexMcp("anything", { configPath: path.join(tmp, "nope.toml") });

fs.rmSync(tmp, { recursive: true, force: true });
console.log("mcp-codex-remove ok");

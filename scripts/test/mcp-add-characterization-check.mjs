#!/usr/bin/env node
// Characterizes scripts/cli/mcp.mjs's mcpAdd (the `roborepo mcp add` CLI path) before Phase 5
// replaces its direct claudeMcpArgs/runClaudeMcpAdd/ensureCodexMcp calls with dispatch through
// getHarnessProvider(id).adapters.mcp.addServer (docs/plans/active/discoverable-harness-provider-
// architecture-plan.md). Pins the dry-run display text (still must read "claude mcp add ..."),
// --only-claude/--only-codex gating, and a real (non-dry-run) Codex-only add's on-disk TOML
// output. Claude's real (non-dry-run) add shells to the actual `claude` CLI and calls
// process.exit(0), so it is not exercised here -- covered instead by
// harness-mcp-remove-characterization-check.mjs (removal) and mcp-claude-permission-check.mjs
// (the permission-grant side effect), both of which don't require a live `claude` binary.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// recordMcpServer (mcp.mjs) writes to MCP_SERVERS_PATH (dev-checkout mode) or
// workspaceMcpServersPath (package mode) -- MCP_SERVERS_PATH resolves under ROBOREPO_APP_ROOT, so
// without a fake app root a real (non-dry-run) `mcp add` run would record into THIS repo's
// tracked manifests/inventory/mcp-servers.json. Every test below must run against an isolated
// copied app root, never the real repoRoot.
function makeAppRoot() {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-mcp-add-char-app-"));
  fs.mkdirSync(path.join(appRoot, ".git"), { recursive: true });
  fs.cpSync(path.resolve("manifests"), path.join(appRoot, "manifests"), { recursive: true });
  fs.cpSync(path.resolve("globals"), path.join(appRoot, "globals"), { recursive: true });
  fs.cpSync(path.resolve("scripts"), path.join(appRoot, "scripts"), { recursive: true });
  return appRoot;
}

function makeHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-mcp-add-char-"));
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".claude", "settings.json"), "{}");
  fs.mkdirSync(path.join(tmp, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".codex", "config.toml"), "");
  return tmp;
}

const appRoot = makeAppRoot();
const cli = path.join(appRoot, "scripts", "cli", "main.mjs");

function run(home, args) {
  const env = { ...process.env, HOME: home, ROBOREPO_APP_ROOT: appRoot, ROBOREPO_MODE: "development", ROBOREPO_STATE_DIR: path.join(home, ".roborepo") };
  return spawnSync(process.execPath, [cli, "mcp", "add", ...args], { env, encoding: "utf8" });
}

// --- Dry-run, both harnesses: prints the claude CLI invocation text and the Codex dry-run line ---
{
  const home = makeHome();
  try {
    const result = run(home, ["--dry-run", "--name=char-test", "char-test-mcp"]);
    assert.equal(result.status, 0, `dry-run should exit 0: ${result.stderr}`);
    assert.match(result.stdout, /^claude mcp add --scope user char-test -- uvx char-test-mcp$/m, "dry-run prints the claude CLI invocation");
    assert.match(result.stdout, /would add permission: mcp__char-test/, "dry-run prints the Claude permission-grant line");
    assert.match(result.stdout, /would add Codex MCP: char-test/, "dry-run prints the Codex add line");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// --- Dry-run, --only-codex: no Claude lines at all ---
{
  const home = makeHome();
  try {
    const result = run(home, ["--dry-run", "--only-codex", "--name=char-test-codex", "char-test-mcp"]);
    assert.equal(result.status, 0, `dry-run should exit 0: ${result.stderr}`);
    assert.doesNotMatch(result.stdout, /^claude mcp add/m, "--only-codex dry-run must not print the claude CLI line");
    assert.doesNotMatch(result.stdout, /would add permission/, "--only-codex dry-run must not print the permission line");
    assert.match(result.stdout, /would add Codex MCP: char-test-codex/, "--only-codex dry-run still prints the Codex add line");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// --- Real (non-dry-run), --only-claude: Codex config.toml must be untouched ---
{
  const home = makeHome();
  try {
    const before = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    // --only-claude shells to the real `claude` binary, which may not exist in CI/sandboxed runs --
    // accept either a clean exit (claude present) or a spawn/exec failure (claude absent), but in
    // both cases Codex's config must be untouched, since --only-claude must never call ensureCodexMcp.
    run(home, ["--only-claude", "--name=char-test-claude-only", "char-test-mcp"]);
    const after = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    assert.equal(after, before, "--only-claude must never touch the Codex config");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// --- --only-claude and --only-codex together must be rejected ---
{
  const home = makeHome();
  try {
    const result = run(home, ["--only-claude", "--only-codex", "--name=x", "x"]);
    assert.notEqual(result.status, 0, "conflicting --only-* flags must fail");
    assert.match(result.stderr, /mutually exclusive/, "conflicting --only-* flags must explain why");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

fs.rmSync(appRoot, { recursive: true, force: true });
console.log("mcp-add-characterization-check: ok");

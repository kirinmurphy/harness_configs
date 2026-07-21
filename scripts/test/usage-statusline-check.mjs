#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ANSI, formatStatusLine } from "../../globals/packages/usage-statusline/scripts/claude-statusline.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const formatter = path.join(repoRoot, "globals/packages/usage-statusline/scripts/claude-statusline.mjs");
const cli = path.join(repoRoot, "scripts/cli/main.mjs");

function plain(input) {
  return formatStatusLine(input, { color: false });
}

assert.equal(
  plain({
    context_window: { used_percentage: 42 },
    rate_limits: { five_hour: { used_percentage: 18 }, seven_day: { used_percentage: 61 } },
  }),
  "Context: 42% · 5h: 18% · Weekly: 61%",
  "formats all metrics in stable order",
);
assert.equal(
  plain({ context_window: { used_percentage: 42 } }),
  "Context: 42% · 5h: — · Weekly: —",
  "keeps unavailable rate-limit segments visible",
);
assert.equal(
  plain({ rate_limits: { five_hour: { used_percentage: 18 }, seven_day: { used_percentage: 61 } } }),
  "Context: — · 5h: 18% · Weekly: 61%",
  "keeps unavailable context segment visible",
);
assert.equal(
  plain({ context_window: { used_percentage: 0 }, rate_limits: { five_hour: { used_percentage: 0 }, seven_day: { used_percentage: 0 } } }),
  "Context: 0% · 5h: 0% · Weekly: 0%",
  "renders real zero values",
);
assert.equal(
  plain({ context_window: { used_percentage: 42.4 }, rate_limits: { five_hour: { used_percentage: -5 }, seven_day: { used_percentage: 101 } } }),
  "Context: 42% · 5h: 0% · Weekly: 100%",
  "rounds decimals and clamps percent range",
);
assert.equal(
  plain({ context_window: { used_percentage: 49 }, rate_limits: { five_hour: { used_percentage: 50 }, seven_day: { used_percentage: 70 } } }),
  "Context: 49% · 5h: 50% · Weekly: 70%",
  "threshold edge values retain percent semantics",
);

const colored = formatStatusLine({
  context_window: { used_percentage: 69 },
  rate_limits: { five_hour: { used_percentage: 70 }, seven_day: { used_percentage: null } },
}, { color: true });
assert.match(colored, new RegExp(`${escapeRegex(ANSI.orange)}5h?`.replace("5h?", "Context: 69%")));
assert.match(colored, new RegExp(`${escapeRegex(ANSI.red)}5h: 70%${escapeRegex(ANSI.reset)}`));
assert.doesNotMatch(colored, new RegExp(`${escapeRegex(ANSI.orange)}Weekly`), "unavailable segment is not colored");
assert.equal(stripAnsi(colored), "Context: 69% · 5h: 70% · Weekly: —", "ANSI-stripped output matches expected text");

const noColor = spawnSync(process.execPath, [formatter], {
  input: JSON.stringify({ context_window: { used_percentage: 70 } }),
  encoding: "utf8",
  env: { ...process.env, NO_COLOR: "" },
});
assert.equal(noColor.status, 0, "formatter should succeed with NO_COLOR");
assert.equal(noColor.stdout.trim(), "Context: 70% · 5h: — · Weekly: —", "NO_COLOR disables ANSI output");

const invalid = spawnSync(process.execPath, [formatter], { input: "{ nope", encoding: "utf8" });
assert.notEqual(invalid.status, 0, "invalid JSON should fail");
assert.equal(invalid.stdout, "", "invalid JSON should not write stdout");
assert.match(invalid.stderr, /invalid JSON input/, "invalid JSON should print concise diagnostic");
assert.doesNotMatch(invalid.stderr, /\{ nope/, "invalid JSON should not echo input");

const home = makeHome();
try {
  const env = { ...process.env, HOME: home, ROBOREPO_STATE_DIR: path.join(home, ".roborepo"), ROBOREPO_SKIP_MCP: "1" };
  const enable = spawnSync(process.execPath, [cli, "enable", "usage-statusline"], { env, encoding: "utf8" });
  assert.equal(enable.status, 0, `enable should succeed:\n${enable.stderr}\n${enable.stdout}`);

  const runtimePath = path.join(home, ".roborepo", "runtime", "usage-statusline", "claude-statusline.mjs");
  assert.ok(fs.existsSync(runtimePath), "enable installs managed runtime asset");

  const settings = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(settings.statusLine.type, "command", "Claude statusLine is command-backed");
  assert.equal(settings.statusLine.padding, 1, "Claude statusLine padding is configured");
  assert.equal(settings.statusLine.command, `node "${runtimePath}"`, "Claude statusLine references managed runtime asset");

  const codexConfig = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  for (const item of ["model-with-reasoning", "context-remaining", "five-hour-limit", "weekly-limit", "git-branch"]) {
    assert.match(codexConfig, new RegExp(JSON.stringify(item)), `Codex status_line contains ${item}`);
  }

  const disable = spawnSync(process.execPath, [cli, "disable", "usage-statusline"], { env, encoding: "utf8" });
  assert.equal(disable.status, 0, `disable should succeed:\n${disable.stderr}\n${disable.stdout}`);
  const afterSettings = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(afterSettings.statusLine, undefined, "disable removes owned Claude statusLine");
  assert.ok(!fs.existsSync(runtimePath), "disable removes managed runtime asset");
  const afterCodexConfig = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  for (const item of ["model-with-reasoning", "context-remaining", "five-hour-limit", "weekly-limit", "git-branch"]) {
    assert.doesNotMatch(afterCodexConfig, new RegExp(JSON.stringify(item)), `disable removes ${item}`);
  }
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

const conflictHome = makeHome();
try {
  fs.writeFileSync(path.join(conflictHome, ".claude", "settings.json"), `${JSON.stringify({ statusLine: { type: "command", command: "custom-status" } }, null, 2)}\n`);
  const env = { ...process.env, HOME: conflictHome, ROBOREPO_STATE_DIR: path.join(conflictHome, ".roborepo"), ROBOREPO_SKIP_MCP: "1" };
  const enable = spawnSync(process.execPath, [cli, "enable", "usage-statusline"], { env, encoding: "utf8" });
  assert.equal(enable.status, 0, `conflict enable should report but not fail:\n${enable.stderr}\n${enable.stdout}`);
  const settings = JSON.parse(fs.readFileSync(path.join(conflictHome, ".claude", "settings.json"), "utf8"));
  assert.equal(settings.statusLine.command, "custom-status", "unmanaged Claude statusLine is preserved");
} finally {
  fs.rmSync(conflictHome, { recursive: true, force: true });
}

function makeHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-usage-statusline-"));
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(tmp, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".claude", "settings.json"), "{}\n");
  fs.writeFileSync(path.join(tmp, ".codex", "config.toml"), "");
  return tmp;
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

console.log("ok: usage statusline package");

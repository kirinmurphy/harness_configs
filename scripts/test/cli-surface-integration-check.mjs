#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadCommandCatalog, listCommandNodes } from "../cli/command-catalog.mjs";
import { readConfigSnapshot } from "../cli/config.mjs";
import { menuItems, menuTitle } from "../cli/interactive-menu-items.mjs";
import { repoRoot } from "../cli/paths.mjs";

const cliPath = path.join(repoRoot, "scripts", "cli", "main.mjs");
const catalog = loadCommandCatalog();
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-cli-surface-"));

try {
  const env = {
    ...process.env,
    HOME: path.join(workDir, "home"),
    ROBOREPO_STATE_DIR: path.join(workDir, "state"),
    ROBOREPO_SKIP_MCP: "1",
  };
  fs.mkdirSync(env.HOME, { recursive: true });
  fs.mkdirSync(env.ROBOREPO_STATE_DIR, { recursive: true });

  assertCli(["help"], { env, stdout: /Primary commands:/ });

  for (const { tokens, node } of listCommandNodes(catalog, { includeInternal: false, includeAdvanced: true })) {
    const expectedTitle = new RegExp(`roborepo ${escapeRegExp(tokens.join(" "))}\\b`);
    assertCli(["help", ...tokens], { env, stdout: expectedTitle });
    if (node.kind === "namespace") {
      assertCli(tokens, { env, input: "\n", stdout: /Select a number \(or blank to cancel\):/ });
    }
  }

  for (const [removedPath, replacement] of Object.entries(catalog.removed || {})) {
    const tokens = removedPath.split(" ");
    assertCli(tokens, {
      env,
      status: 2,
      stderr: new RegExp(escapeRegExp(replacement.message)),
    });
  }

  assertInteractiveMenuRedraw({ env });
  assertIndentedSelectionMarker({ env });
  assertMenuHeaderTemplate();
  assertInteractiveHelpPause({ env });
  assertSilentCommandReturnsToMenu({ env });
  assertRemoteSyncMenuFlow({ env });
  assertCli(["web", "stop"], { env, stdout: /roborepo portal: no server was running/ });
  assertSkillMenuSections();
  assertTelemetryMenuSections();
  assertPackageLibraryLabels();
  assertRootAgentConfigOrder();
  assertConfigMenuCollapsedRoot();
  assertSubmenuNavigation();

  console.log("cli surface integration checks passed");
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}

function assertCli(args, { env, input = "", status = 0, stdout, stderr } = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env,
    input,
    encoding: "utf8",
  });
  assert.equal(result.status, status, `roborepo ${args.join(" ")} exit\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  if (stdout) assert.match(result.stdout, stdout, `roborepo ${args.join(" ")} stdout`);
  if (stderr) assert.match(result.stderr, stderr, `roborepo ${args.join(" ")} stderr`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertSkillMenuSections() {
  const sections = menuItems(catalog, catalog.nodes.skill, ["skill"])
    .filter((item) => item.header)
    .map((item) => item.header);
  assert.deepEqual(sections.slice(0, 4), ["Project Skills", "Global Skills", "Inspection", "Repository Data"]);
}

function assertTelemetryMenuSections() {
  const items = menuItems(catalog, catalog.nodes.telemetry, ["telemetry"]);
  const sections = items.filter((item) => item.header).map((item) => item.header);
  const labels = items.map((item) => item.header || item.label);
  assert.deepEqual(sections.slice(0, 3), ["Lifecycle", "Monitoring", "Data Management"]);
  assert(!labels.includes("Stop"), "portal stop should not appear in normal telemetry menu");
}

function assertPackageLibraryLabels() {
  const tokenSection = readConfigSnapshot().behaviorView.find((section) => section.category === "Token Optimization");
  const labels = tokenSection?.items.map((item) => item.label) || [];
  assert(labels.includes("Token Monitoring"), "telemetry package should show product label in Package Library");
  assert(!labels.includes("/telemetry-marker"), "Token Optimization should not show telemetry slash-command label");
}

function assertRootAgentConfigOrder() {
  const items = menuItems(catalog, null, []);
  const labels = items.map((item) => item.header || item.label);
  assert(labels.indexOf("Packages") < labels.indexOf("Agent Files"), "Agent Files should follow Packages");
  assert(labels.indexOf("Agent Files") < labels.indexOf("Skills"), "Agent Files should be above Skills");
}

function assertConfigMenuCollapsedRoot() {
  const items = menuItems(catalog, catalog.nodes.config, ["config"]);
  const labels = items.map((item) => item.header || item.label);
  assert(labels.includes("Inspect root config"), "config menu should expose root inspect directly");
  assert(!labels.includes("Root config"), "single-child root config namespace should be collapsed in menu");
  assert.deepEqual(
    items.find((item) => item.label === "Inspect root config")?.value.tokens,
    ["config", "root", "inspect"],
    "collapsed root inspect should preserve full command tokens",
  );
}

function assertSubmenuNavigation() {
  const labels = menuItems(catalog, catalog.nodes.config, ["config"]).map((item) => item.header || item.label);
  assert(!labels.includes("Support"), "submenus should not include global Support section");
  assert(labels.includes("Navigation"), "submenus should include Navigation section");
  assert(labels.includes("Help"), "submenu Navigation should include contextual Help");
  assert(labels.includes("Back"), "submenus should include Back");
  assert(labels.includes("Exit"), "submenus should include Exit");
}

function assertMenuHeaderTemplate() {
  assert.equal(
    stripAnsi(menuTitle(catalog, null, [], { text: "doctor passed (99 checks)", level: "success" })),
    "** doctor passed (99 checks)\n\n=========== ROBOREPO - Main Menu ===========\n\n",
  );
  assert.equal(
    stripAnsi(menuTitle(catalog, catalog.nodes.package, ["package"])),
    "=========== ROBOREPO - Packages ============\nEsc - return to previous menu\n\n",
  );
  assert.match(menuTitle(catalog, null, [], { text: "ok", level: "success" }), /\x1b\[1;32m\*\* ok/);
  assert.match(menuTitle(catalog, null, [], { text: "warn", level: "warning" }), /\x1b\[1;33m\*\* warn/);
  assert.match(menuTitle(catalog, null, [], { text: "bad", level: "error" }), /\x1b\[1;31m\*\* bad/);
}

function assertInteractiveHelpPause({ env }) {
  const script = `
    set timeout 5
    spawn -noecho ${process.execPath} ${cliPath}
    send "\\033\\[B\\033\\[B\\033\\[B\\033\\[B\\033\\[B\\033\\[B\\033\\[B\\033\\[B\\033\\[B\\r"
    expect "Press any key to return to menu"
    send " "
    expect "ROBOREPO - Main Menu"
    send "q"
    expect eof
  `;
  const result = spawnSync("expect", ["-c", script], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });

  if (result.error?.code === "ENOENT") {
    console.log("skipped interactive help PTY check (expect not found)");
    return;
  }

  assert.equal(result.status, 0, `interactive help PTY exit\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

function assertSilentCommandReturnsToMenu({ env }) {
  const script = `
    set timeout 10
    spawn -noecho ${process.execPath} ${cliPath}
    send "\\033\\[B\\033\\[B\\033\\[B\\033\\[B\\r"
    expect "ROBOREPO - Agent Files"
    send "\\033\\[B\\033\\[B\\033\\[B\\r"
    expect "** config permissions completed"
    expect "ROBOREPO - Agent Files"
    send "q"
    expect eof
  `;
  const result = spawnSync("expect", ["-c", script], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });

  if (result.error?.code === "ENOENT") {
    console.log("skipped silent command PTY check (expect not found)");
    return;
  }

  assert.equal(result.status, 0, `silent command PTY exit\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

function assertRemoteSyncMenuFlow({ env }) {
  const scanRoot = path.join(workDir, "remote-sync-scan");
  const resultFile = path.join(workDir, "remote-sync-result.json");
  const repo = makeRemoteSyncFixture(scanRoot);
  const script = `
    set timeout 20
    spawn -noecho ${process.execPath} ${cliPath} git remote-sync-check ${scanRoot} --menu
    expect "Remote Sync Check"
    expect "./sync-work"
    expect "1 branch ahead"
    send "\\r"
    expect "Show unpushed commits"
    expect "Push branch to upstream"
    send "\\r"
    expect "ahead"
    send "\\r"
    expect "remote sync local commit"
    expect "Press Enter to continue"
    send "\\r"
    expect "Show unpushed commits"
    send "\\033\\[B\\033\\[B\\033\\[B\\r"
    expect "ahead"
    send "\\r"
    expect "Push ahead to origin/main?"
    send "\\r"
    expect "Show unpushed commits"
    send "\\033\\[B\\033\\[B\\033\\[B\\r"
    expect "ahead"
    send "\\r"
    expect "Push ahead to origin/main?"
    send "y\\r"
    expect "Push complete."
    expect "Press Enter to continue"
    send "\\r"
    expect "Remote Sync Check"
    expect "No branches found out of sync"
    send "q"
    expect eof
  `;
  const result = spawnSync("expect", ["-c", script], {
    cwd: repoRoot,
    env: { ...env, ROBOREPO_INTERACTIVE_RESULT_FILE: resultFile },
    encoding: "utf8",
  });

  if (result.error?.code === "ENOENT") {
    console.log("skipped remote-sync PTY check (expect not found)");
    return;
  }

  assert.equal(result.status, 0, `remote-sync PTY exit\nrepo: ${repo}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const payload = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(payload.notice.text, "Remote sync check complete");
}

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function makeRemoteSyncFixture(scanRoot) {
  const origin = path.join(workDir, "remote-sync-origin.git");
  const seed = path.join(workDir, "remote-sync-seed");
  const repo = path.join(scanRoot, "sync-work");
  fs.mkdirSync(scanRoot, { recursive: true });

  runGit(["init", "--bare", "--initial-branch=main", origin]);
  runGit(["init", "--initial-branch=main"], { cwd: seed, mkdir: true });
  fs.writeFileSync(path.join(seed, "base.txt"), "base\n");
  runGit(["add", "."], { cwd: seed });
  commit(seed, "base");
  runGit(["remote", "add", "origin", origin], { cwd: seed });
  runGit(["push", "-u", "origin", "main"], { cwd: seed });

  runGit(["clone", origin, repo]);
  runGit(["switch", "-c", "ahead", "origin/main"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "local.txt"), "local\n");
  runGit(["add", "."], { cwd: repo });
  commit(repo, "remote sync local commit");
  return repo;
}

function commit(cwd, message) {
  runGit(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", message], { cwd });
}

function runGit(args, options = {}) {
  if (options.mkdir) fs.mkdirSync(options.cwd, { recursive: true });
  const result = spawnSync("git", args, { cwd: options.cwd || repoRoot, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

function assertInteractiveMenuRedraw({ env }) {
  const script = `
    set timeout 5
    spawn -noecho ${process.execPath} ${cliPath}
    send "\\033\\[B\\033\\[B\\033\\[Aq"
    expect eof
  `;
  const result = spawnSync("expect", ["-c", script], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });

  if (result.error?.code === "ENOENT") {
    console.log("skipped interactive menu PTY check (expect not found)");
    return;
  }

  assert.equal(result.status, 0, `interactive menu PTY exit\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const screen = finalScreenFromAnsi(result.stdout);
  assert.equal((screen.match(/ROBOREPO - Main Menu/g) || []).length, 1, `menu title duplicated after redraw\n${screen}`);
  assert.equal((screen.match(/^> /gm) || []).length, 1, `menu selection duplicated after redraw\n${screen}`);
  assert.match(screen, /^  Agent Config$/m, `root menu missing Agent Config section\n${screen}`);
  assert.match(screen, /^  Open web portal\b/m, `primary action should keep selector gutter\n${screen}`);
  assert.doesNotMatch(screen, /^    Open web portal\b/m, `primary action should not get child indent\n${screen}`);
  assert.match(screen, /^  Support$/m, `root menu missing Support section\n${screen}`);
  assert.match(screen, /^  Navigation$/m, `root menu missing Navigation section\n${screen}`);
  assert.match(screen, /^    Agent Files\b/m, `root menu missing renamed Agent Files item\n${screen}`);
  assert.match(screen, /^    Doctor\b/m, `root menu missing Support Doctor item\n${screen}`);
  assert.match(screen, /^    Maintenance\b/m, `root menu missing Support Maintenance item\n${screen}`);
  assert.match(screen, /^> Package Library\b/m, `menu did not land on expected row\n${screen}`);
}

function assertIndentedSelectionMarker({ env }) {
  const script = `
    set timeout 5
    spawn -noecho ${process.execPath} ${cliPath}
    send "\\033\\[B\\033\\[B\\033\\[Bq"
    expect eof
  `;
  const result = spawnSync("expect", ["-c", script], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });

  if (result.error?.code === "ENOENT") {
    console.log("skipped indented selection PTY check (expect not found)");
    return;
  }

  assert.equal(result.status, 0, `indented selection PTY exit\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const screen = finalScreenFromAnsi(result.stdout);
  assert.match(screen, /^  > Packages\b/m, `child selection marker should align with section indent\n${screen}`);
  assert.doesNotMatch(screen, /^>   Packages\b/m, `child selection marker should not stay flush-left\n${screen}`);
}

function finalScreenFromAnsi(value) {
  const rows = [""];
  let row = 0;
  let col = 0;
  let saved = { row: 0, col: 0 };

  const ensureRow = () => {
    while (rows.length <= row) rows.push("");
  };

  const write = (text) => {
    ensureRow();
    const line = rows[row] || "";
    rows[row] = line.slice(0, col) + text + line.slice(col + text.length);
    col += text.length;
  };

  for (let i = 0; i < value.length;) {
    const ch = value[i];
    if (ch === "\x1b" && value[i + 1] === "7") {
      saved = { row, col };
      i += 2;
      continue;
    }
    if (ch === "\x1b" && value[i + 1] === "8") {
      row = saved.row;
      col = saved.col;
      ensureRow();
      i += 2;
      continue;
    }
    if (ch === "\x1b" && value[i + 1] === "[") {
      let j = i + 2;
      while (j < value.length && !/[A-Za-z]/.test(value[j])) j += 1;
      const params = value.slice(i + 2, j);
      const code = value[j];
      const n = Number.parseInt(params, 10) || 1;
      if (code === "A") row = Math.max(0, row - n);
      if (code === "H") {
        row = 0;
        col = 0;
        ensureRow();
      }
      if (code === "K" && (params === "2" || params === "")) {
        ensureRow();
        rows[row] = "";
      }
      if (code === "J") {
        ensureRow();
        rows[row] = rows[row].slice(0, col);
        rows.length = row + 1;
      }
      i = j + 1;
      continue;
    }
    if (ch === "\r") {
      col = 0;
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row += 1;
      col = 0;
      ensureRow();
      i += 1;
      continue;
    }
    write(ch);
    i += 1;
  }

  return rows.join("\n").replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
}

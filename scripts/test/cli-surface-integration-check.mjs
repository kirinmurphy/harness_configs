#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadCommandCatalog, listCommandNodes } from "../cli/command-catalog.mjs";
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

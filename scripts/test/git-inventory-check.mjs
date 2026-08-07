#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const appRoot = path.resolve(".");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-git-inventory-"));

try {
  const home = path.join(tempRoot, "home");
  const projects = path.join(home, "projects");
  const repo = path.join(projects, "needs-work");
  const missingUpstream = path.join(projects, "missing-upstream");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(missingUpstream, { recursive: true });

  run("git", ["init", "--initial-branch=main"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "tracked.txt"), "baseline\n");
  run("git", ["add", "tracked.txt"], { cwd: repo });
  run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "baseline"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "todo.txt"), "migrate me\n");

  run("git", ["init", "--initial-branch=main"], { cwd: missingUpstream });
  fs.writeFileSync(path.join(missingUpstream, "tracked.txt"), "baseline\n");
  run("git", ["add", "tracked.txt"], { cwd: missingUpstream });
  run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "baseline"], { cwd: missingUpstream });
  run("git", ["checkout", "-b", "production_env_prep"], { cwd: missingUpstream });
  run("git", ["remote", "add", "origin", "https://example.invalid/repo.git"], { cwd: missingUpstream });
  run("git", ["config", "branch.production_env_prep.remote", "origin"], { cwd: missingUpstream });
  run("git", ["config", "branch.production_env_prep.merge", "refs/heads/production_env_prep"], { cwd: missingUpstream });

  const result = spawnSync(process.execPath, [
    path.join(appRoot, "scripts", "cli", "main.mjs"),
    "git",
    "inventory",
    "~/projects",
    "--compact",
    "--max-depth",
    "1",
  ], {
    cwd: appRoot,
    env: { ...process.env, HOME: home },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`Root: ${escapeRegExp(projects)}`));
  assert.match(result.stdout, /\.\/needs-work/);
  assert.match(result.stdout, /current: main \| dirty 1 \| ahead unknown \| behind unknown \| upstream none/);
  assert.match(result.stdout, /action: add remote \| set upstream \| commit\/stash local changes/);
  assert.doesNotMatch(result.stdout, /`/);

  const syncResult = spawnSync(process.execPath, [
    path.join(appRoot, "scripts", "cli", "main.mjs"),
    "git",
    "remote-sync-check",
    "~/projects",
    "--compact",
    "--max-depth",
    "1",
  ], {
    cwd: appRoot,
    env: { ...process.env, HOME: home },
    encoding: "utf8",
  });

  assert.equal(syncResult.status, 0, syncResult.stderr);
  assert.match(syncResult.stdout, /Git Remote Sync Check/);
  assert.match(syncResult.stdout, /\.\/needs-work/);
  assert.match(syncResult.stdout, /- Add a remote for this repo\./);
  assert.match(syncResult.stdout, /- Set upstream for main\./);
  assert.match(syncResult.stdout, /- Push or delete local-only branch\(es\): main\./);
  assert.match(syncResult.stdout, /\.\/missing-upstream/);
  assert.match(syncResult.stdout, /- Repair missing upstream ref\(s\): production_env_prep -> origin\/production_env_prep\./);
  assert.doesNotMatch(syncResult.stdout, /ahead unknown/);
  assert.doesNotMatch(syncResult.stdout, /fatal: ambiguous argument/);
  assert.doesNotMatch(syncResult.stdout, /dirty/);
  console.log("git-inventory-check passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

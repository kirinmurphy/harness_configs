#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(".");
const script = path.join(repoRoot, "scripts", "release", "promote-npm-latest.sh");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-promote-npm-latest-"));

try {
  const bin = path.join(tempRoot, "bin");
  fs.mkdirSync(bin, { recursive: true });
  writeShim(path.join(bin, "npm"), `#!/bin/sh
echo "npm $*" >> "${tempRoot}/calls.log"
case "$1" in
  whoami)
    echo "test-user"
    ;;
  view)
    if [ "$3" = "versions" ] && [ "$4" = "--json" ]; then
      printf '%s\\n' '["0.1.0-beta.6","0.1.0-beta.10","0.1.0","0.2.0-beta.1"]'
      exit 0
    fi
    echo "unexpected npm view: $*" >&2
    exit 21
    ;;
  dist-tag)
    if [ "$2" = "add" ]; then
      echo "moved $3 to $4"
      exit 0
    fi
    echo "unexpected dist-tag command: $*" >&2
    exit 22
    ;;
  *)
    echo "unexpected npm command: $*" >&2
    exit 23
    ;;
esac
`);

  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  };

  const dryRun = run(["--dry-run"], env);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /Target:\s+0\.2\.0-beta\.1/, "newest prerelease should beat older stable versions");
  assert.match(dryRun.stdout, /npm dist-tag add codethings-roborepo-alpha@0\.2\.0-beta\.1 latest/);
  assert.doesNotMatch(readCalls(), /npm dist-tag add/, "dry-run must not move the dist-tag");

  resetCalls();
  const promoted = run([], env);
  assert.equal(promoted.status, 0, promoted.stderr);
  assert.match(promoted.stdout, /Promoted codethings-roborepo-alpha@0\.2\.0-beta\.1 to dist-tag latest/);
  assert.match(readCalls(), /npm dist-tag add codethings-roborepo-alpha@0\.2\.0-beta\.1 latest/);

  resetCalls();
  const betaTag = run(["--tag", "beta"], env);
  assert.equal(betaTag.status, 0, betaTag.stderr);
  assert.match(readCalls(), /npm dist-tag add codethings-roborepo-alpha@0\.2\.0-beta\.1 beta/);

  console.log("ok: promote npm latest workflow");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function run(args, env) {
  return spawnSync("bash", [script, ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
}

function writeShim(file, body) {
  fs.writeFileSync(file, body, { mode: 0o755 });
}

function readCalls() {
  try {
    return fs.readFileSync(path.join(tempRoot, "calls.log"), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return "";
    throw err;
  }
}

function resetCalls() {
  fs.rmSync(path.join(tempRoot, "calls.log"), { force: true });
}

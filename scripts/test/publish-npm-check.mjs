#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(".");
const script = path.join(repoRoot, "scripts", "release", "publish-npm.sh");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-publish-npm-"));
const originalPackageJson = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");

try {
  const bin = path.join(tempRoot, "bin");
  fs.mkdirSync(bin, { recursive: true });
  writeShim(path.join(bin, "git"), `#!/bin/sh
echo "git $*" >> "${tempRoot}/calls.log"
case "$1 $2" in
  "status --porcelain")
    if [ "\${PUBLISH_TEST_DIRTY:-0}" = "1" ]; then
      echo " M package.json"
    fi
    ;;
  "status --short")
    if [ "\${PUBLISH_TEST_DIRTY:-0}" = "1" ]; then
      echo " M package.json"
    fi
    ;;
esac
`);
  writeShim(path.join(bin, "npm"), `#!/bin/sh
echo "npm $*" >> "${tempRoot}/calls.log"
  case "$1" in
  version)
    node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.version=process.argv[1]; fs.writeFileSync('package.json', JSON.stringify(p, null, 2)+'\\\\n')" "$2"
    echo "v$2"
    ;;
  whoami)
    echo "test-user"
    ;;
  view)
    if [ "\${PUBLISH_TEST_VERSION_EXISTS:-0}" = "1" ]; then
      echo "\${2#*@}"
      exit 0
    fi
    echo "npm ERR! code E404" >&2
    exit 1
    ;;
  test)
    ;;
  run)
    if [ "$2" = "pack:dry-run" ] && [ "\${PUBLISH_TEST_FAIL_PACK:-0}" = "1" ]; then
      echo "pack failed" >&2
      exit 30
    fi
    ;;
  publish)
    echo "publish should not run in this test" >&2
    exit 20
    ;;
  *)
    echo "unexpected npm command: $*" >&2
    exit 21
    ;;
esac
`);

  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  };

  const releaseInfo = run(["--next-release-info"], env);
  assert.equal(releaseInfo.status, 0, releaseInfo.stderr);
  assert.match(releaseInfo.stdout, /Target:\s+0\.1\.0-beta\.1/);
  assert.match(releaseInfo.stdout, /Next release info only\. No git, npm, network, or package checks were run\./);
  // The install command pins an exact version, so --tag is inert on it (npm only honors --tag when
  // resolving an unpinned spec). Printing it taught users a flag that does nothing; assert it stays gone.
  assert.match(releaseInfo.stdout, /npm install -g codethings-roborepo-alpha@0\.1\.0-beta\.1$/m);
  assert.doesNotMatch(releaseInfo.stdout, /npm install -g \S+ --tag/);
  assert.equal(readCalls(), "", "--next-release-info should not call git or npm");

  const latest = run(["--tag", "latest", "--next-release-info"], env);
  assert.notEqual(latest.status, 0, "latest tag without --latest should fail");
  assert.match(latest.stderr, /refusing --tag latest without --latest/);

  const dirty = run(["--dry-run"], { ...env, PUBLISH_TEST_DIRTY: "1" });
  assert.notEqual(dirty.status, 0, "dirty worktree should fail");
  assert.match(dirty.stderr, /worktree is not clean/);
  assert.doesNotMatch(readCalls(), /npm /, "dirty worktree should fail before npm auth/checks");

  resetCalls();
  const dryRun = run(["--dry-run"], env);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /Dry run complete/);
  assert.match(dryRun.stdout, /npm publish --access public --tag beta/);
  assert.match(dryRun.stdout, /npm install -g codethings-roborepo-alpha@0\.1\.0-beta\.1$/m);
  assert.doesNotMatch(dryRun.stdout, /npm install -g \S+ --tag/);
  const calls = readCalls();
  assert.match(calls, /git status --porcelain/);
  assert.match(calls, /npm whoami/);
  assert.match(calls, /npm view codethings-roborepo-alpha@0\.1\.0-beta\.1 version/);
  assert.match(calls, /npm test/);
  assert.match(calls, /npm run pack:dry-run/);
  assert.match(calls, /npm run test:package-install/);
  assert.doesNotMatch(calls, /npm publish/);

  resetCalls();
  const exists = run(["--dry-run"], { ...env, PUBLISH_TEST_VERSION_EXISTS: "1" });
  assert.notEqual(exists.status, 0, "existing npm version should fail");
  assert.match(exists.stderr, /already exists on npm/);
  assert.doesNotMatch(readCalls(), /npm test/, "existing version should fail before checks");

  resetCalls();
  const failedCheck = run(["--yes"], { ...env, PUBLISH_TEST_FAIL_PACK: "1" });
  assert.notEqual(failedCheck.status, 0, "failed check should stop real publish");
  assert.match(failedCheck.stderr, /restored package\.json after failed pre-publish check/);
  assert.equal(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    originalPackageJson,
    "package.json should be restored after failed pre-publish check",
  );
  assert.doesNotMatch(readCalls(), /npm publish/, "failed check should not publish");

  // Retrying after a run that wrote the version but never published. package.json then names a
  // version the registry has never seen, and pinning that same version with --version used to abort
  // on "target version equals current version" -- blocking the retry that would have fixed it. Only
  // a computed bump colliding with the current version is a real error; the registry lookup is what
  // actually prevents a double publish.
  resetCalls();
  const stranded = JSON.parse(originalPackageJson);
  stranded.version = "0.1.0-beta.1";
  fs.writeFileSync(path.join(repoRoot, "package.json"), `${JSON.stringify(stranded, null, 2)}\n`);
  try {
    const retry = run(["--dry-run", "--version", "0.1.0-beta.1"], env);
    assert.equal(retry.status, 0, `retry at the stranded version should proceed:\n${retry.stderr}`);
    assert.doesNotMatch(retry.stderr, /target version equals current version/);
    assert.match(retry.stdout, /Target:\s+0\.1\.0-beta\.1/);
    // A computed bump that lands on the current version is still an error: nothing moved.
    const noop = run(["--dry-run", "--version", "0.1.0-beta.1", "--preid", "beta"], env);
    assert.equal(noop.status, 0, "explicit --version stays allowed regardless of preid");
  } finally {
    fs.writeFileSync(path.join(repoRoot, "package.json"), originalPackageJson);
  }

  console.log("ok: publish npm workflow");
} finally {
  fs.writeFileSync(path.join(repoRoot, "package.json"), originalPackageJson);
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

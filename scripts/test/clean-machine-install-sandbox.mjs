#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { packTarball } from "./package-install-smoke/tarball.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageName = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).name;
const image = process.env.ROBOREPO_CLEAN_MACHINE_IMAGE || "node:22-bookworm-slim";
const strict = process.env.ROBOREPO_CLEAN_MACHINE_STRICT === "1";

const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" });
if (docker.status !== 0) {
  const message = "skip: clean-machine install sandbox (Docker daemon unavailable)";
  if (strict) throw new Error(`${message}\n${docker.stderr || docker.stdout}`);
  console.log(message);
  process.exit(0);
}

const imageCheck = spawnSync("docker", ["image", "inspect", image], { encoding: "utf8" });
if (imageCheck.status !== 0 && !strict) {
  console.log(`skip: clean-machine install sandbox (${image} image not present; set ROBOREPO_CLEAN_MACHINE_STRICT=1 to pull/run)`);
  process.exit(0);
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-clean-machine-"));
const packDest = path.join(sandbox, "pack");
fs.mkdirSync(packDest, { recursive: true });

try {
  const { tarballPath, tarballName } = packTarball(repoRoot, packDest);
  const script = cleanMachineScript({ packageName, tarballName });
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--network=none",
      "-v",
      `${packDest}:/artifacts:ro`,
      image,
      "sh",
      "-lc",
      script,
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    assert.fail(`clean-machine install sandbox failed (exit ${result.status})\n${result.stdout}${result.stderr}`);
  }
  process.stdout.write(result.stdout);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

function cleanMachineScript({ packageName, tarballName }) {
  return `
set -eu

run_case() {
  label="$1"
  prefix="$2"
  home="/tmp/rr-${label}-home"
  state="/tmp/rr-${label}-state"
  workspace="/tmp/rr-${label}-workspace"
  cache="/tmp/rr-${label}-npm-cache"
  cwd="/tmp/rr-${label}-cwd"
  if [ "$prefix" = "__HOME_LOCAL__" ]; then
    prefix="$home/.local"
  fi

  rm -rf "$home" "$state" "$workspace" "$cache" "$cwd" "$prefix"
  mkdir -p "$home" "$state" "$workspace" "$cache" "$cwd" "$prefix"

  export HOME="$home"
  export ROBOREPO_MODE=package
  export ROBOREPO_STATE_ROOT="$state"
  export ROBOREPO_WORKSPACE_ROOT="$workspace"
  export ROBOREPO_PRESETS_ONBOARD=skip
  export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

  for harness in claude codex gemini; do
    if command -v "$harness" >/dev/null 2>&1; then
      echo "FAIL: clean PATH unexpectedly exposes $harness at $(command -v "$harness")" >&2
      exit 1
    fi
  done

  npm install -g --prefix "$prefix" --cache "$cache" "/artifacts/${tarballName}" >/dev/null
  export PATH="$prefix/bin:$PATH"

  roborepo version | grep -q 'mode: package'
  roborepo init >/tmp/rr-${label}-init.out
  roborepo doctor --quiet
  roborepo uninstall --yes >/tmp/rr-${label}-uninstall.out
  test -d "$workspace"

  npm uninstall -g --prefix "$prefix" "${packageName}" >/dev/null
  if command -v roborepo >/dev/null 2>&1; then
    echo "FAIL: roborepo binary survived npm uninstall at $(command -v roborepo)" >&2
    exit 1
  fi
}

run_case standard /tmp/rr-standard-prefix
run_case colliding __HOME_LOCAL__

echo "clean-machine install sandbox passed"
`;
}

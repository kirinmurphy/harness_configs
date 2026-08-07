import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertCleanWorktree, packTarball, installTarball, smokeEnv } from "./package-install-smoke/tarball.mjs";
import {
  runCommand,
  assertVersionOutput,
  assertWorkspaceInitialized,
} from "./package-install-smoke/command-assertions.mjs";
import { hashDirectory } from "./lib/hash-directory.mjs";
import {
  assertNoSourceCoupling,
  assertNoVersionedPathCoupling,
} from "./package-install-smoke/coupling-scan.mjs";
import { retainArtifact } from "./package-install-smoke/retain-artifact.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const outputDirFlagIndex = process.argv.indexOf("--output-dir");
const outputDir = outputDirFlagIndex >= 0 ? process.argv[outputDirFlagIndex + 1] : null;
if (outputDirFlagIndex >= 0 && !outputDir) {
  throw new Error("--output-dir requires a value");
}

main();

function main() {
  if (outputDir) {
    assertCleanWorktree(repoRoot);
  }

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-package-smoke-"));
  const dirs = {
    packDest: path.join(sandbox, "pack"),
    prefix: path.join(sandbox, "prefix"),
    cache: path.join(sandbox, "cache"),
    home: path.join(sandbox, "home"),
    stateRoot: path.join(sandbox, "state"),
    workspaceRoot: path.join(sandbox, "workspace"),
    cwd: path.join(sandbox, "cwd"),
  };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });

  try {
    const { tarballPath, tarballName } = packTarball(repoRoot, dirs.packDest);
    installTarball(dirs, tarballPath);

    const binPath = path.join(dirs.prefix, "bin", "roborepo");
    assert.ok(fs.existsSync(binPath), `expected installed binary at ${binPath}`);

    const appRoot = path.join(dirs.prefix, "lib", "node_modules", "@kirin", "roborepo");
    assert.ok(fs.existsSync(appRoot), `expected installed application root at ${appRoot}`);

    const env = smokeEnv(dirs);
    const hashBefore = hashDirectory(appRoot);

    const versionOut = runCommand(binPath, ["version"], dirs.cwd, env);
    assertVersionOutput(versionOut, appRoot);

    runCommand(binPath, ["setup"], dirs.cwd, env);
    assertWorkspaceInitialized(dirs.workspaceRoot);

    runCommand(binPath, ["workspace", "status"], dirs.cwd, env);

    const applyOut = runCommand(binPath, ["config", "apply"], dirs.cwd, env);
    assert.match(applyOut.stdout, /updated root config/, `expected config apply to report updated root configs\n${applyOut.stdout}`);

    const doctorOut = runCommand(binPath, ["doctor"], dirs.cwd, env);
    assert.match(doctorOut.stdout, /doctor passed \(\d+ checks\)/, `expected doctor to pass\n${doctorOut.stdout}${doctorOut.stderr}`);

    const hashAfter = hashDirectory(appRoot);
    assert.equal(hashAfter, hashBefore, "appRoot must be byte-identical before and after runtime commands");

    const scanTargets = [
      { root: dirs.home, allowInstallStateExemption: true },
      { root: dirs.workspaceRoot, allowInstallStateExemption: false },
      { root: dirs.stateRoot, allowInstallStateExemption: false },
    ];
    for (const { root, allowInstallStateExemption } of scanTargets) {
      assertNoSourceCoupling(root, repoRoot);
      assertNoVersionedPathCoupling(root, dirs.prefix, { allowInstallStateExemption });
    }

    if (outputDir) {
      retainArtifact({ repoRoot, outputDir, tarballPath, tarballName });
    }

    console.log(`ok: package install smoke (${outputDir ? "retained" : "ephemeral"})`);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

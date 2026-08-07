import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const outputDirFlagIndex = process.argv.indexOf("--output-dir");
const outputDir = outputDirFlagIndex >= 0 ? process.argv[outputDirFlagIndex + 1] : null;
if (outputDirFlagIndex >= 0 && !outputDir) {
  throw new Error("--output-dir requires a value");
}

main();

async function main() {
  if (outputDir) {
    assertCleanWorktree();
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
    const { tarballPath, tarballName } = packTarball(dirs.packDest);
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

    assertNoSourceCoupling(dirs.home, repoRoot);
    assertNoVersionedPathCoupling(dirs.home, dirs.prefix);

    if (outputDir) {
      retainArtifact({ outputDir, tarballPath, tarballName });
    }

    console.log(`ok: package install smoke (${outputDir ? "retained" : "ephemeral"})`);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function assertCleanWorktree() {
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(status.status, 0, "git status failed");
  assert.equal(
    status.stdout.trim(),
    "",
    "retained-artifact mode requires a clean Git worktree so the recorded source commit describes the bytes being transferred",
  );
}

function packTarball(packDest) {
  const result = spawnSync(
    "npm",
    ["pack", "--json", "--pack-destination", packDest],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, `npm pack failed\n${result.stderr}`);
  const [entry] = JSON.parse(result.stdout);
  assert.ok(entry?.filename, "npm pack did not report a filename");
  return { tarballPath: path.join(packDest, entry.filename), tarballName: entry.filename };
}

function installTarball(dirs, tarballPath) {
  const result = spawnSync(
    "npm",
    ["install", "-g", "--prefix", dirs.prefix, "--cache", dirs.cache, tarballPath],
    { cwd: dirs.cwd, encoding: "utf8" },
  );
  assert.equal(result.status, 0, `npm install of packed tarball failed\n${result.stderr}`);
}

function smokeEnv(dirs) {
  return {
    PATH: process.env.PATH,
    HOME: dirs.home,
    ROBOREPO_MODE: "package",
    ROBOREPO_STATE_ROOT: dirs.stateRoot,
    ROBOREPO_WORKSPACE_ROOT: dirs.workspaceRoot,
    ROBOREPO_PRESETS_ONBOARD: "skip",
  };
}

function runCommand(binPath, args, cwd, env) {
  const result = spawnSync(binPath, args, { cwd, env, encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `roborepo ${args.join(" ")} failed (exit ${result.status})\n${result.stdout}${result.stderr}`,
  );
  return result;
}

function assertVersionOutput(result, appRoot) {
  assert.match(result.stdout, /mode: package/, `expected package mode\n${result.stdout}`);
  const appRootLine = result.stdout.match(/appRoot: (.+)/);
  assert.ok(appRootLine, `expected an appRoot line\n${result.stdout}`);
  assert.equal(
    fs.realpathSync(appRootLine[1].trim()),
    fs.realpathSync(appRoot),
    "reported appRoot must resolve inside the isolated npm prefix",
  );
}

function assertWorkspaceInitialized(workspaceRoot) {
  assert.ok(fs.existsSync(workspaceRoot), `expected workspaceRoot to be created at ${workspaceRoot}`);
  const manifest = path.join(workspaceRoot, "workspace.json");
  assert.ok(fs.existsSync(manifest), `expected workspace.json at ${manifest}`);
}

function hashDirectory(root) {
  const hash = crypto.createHash("sha256");
  const entries = [];
  walk(root, root, entries);
  entries.sort();
  for (const relPath of entries) {
    hash.update(relPath);
    hash.update(fs.readFileSync(path.join(root, relPath)));
  }
  return hash.digest("hex");
}

function walk(root, dir, entries) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, full, entries);
    } else if (entry.isFile()) {
      entries.push(path.relative(root, full));
    }
  }
}

function assertNoSourceCoupling(homeDir, checkoutPath) {
  const matches = scanForString(homeDir, checkoutPath);
  assert.equal(
    matches.length,
    0,
    `found source-checkout path leaked into generated files: ${matches.join(", ")}`,
  );
}

function assertNoVersionedPathCoupling(homeDir, prefixDir) {
  const versionedRoot = fs.realpathSync(path.join(prefixDir, "lib", "node_modules", "@kirin", "roborepo"));
  const exemptSuffix = path.join(".roborepo", "install-state.json");
  const matches = scanForString(homeDir, versionedRoot).filter((relPath) => !relPath.endsWith(exemptSuffix));
  assert.equal(
    matches.length,
    0,
    `found versioned npm install path leaked into generated files outside the documented install-state.json exemption: ${matches.join(", ")}`,
  );
}

function scanForString(root, needle) {
  const matches = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        let text;
        try {
          text = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        if (text.includes(needle)) matches.push(path.relative(root, full));
      }
    }
  }
  return matches;
}

function retainArtifact({ outputDir, tarballPath, tarballName }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const destTarball = path.join(outputDir, tarballName);
  fs.copyFileSync(tarballPath, destTarball);

  const checksum = crypto.createHash("sha256").update(fs.readFileSync(destTarball)).digest("hex");
  fs.writeFileSync(path.join(outputDir, `${tarballName}.sha256`), `${checksum}  ${tarballName}\n`);

  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();

  const manifest = {
    name: pkg.name,
    version: pkg.version,
    sourceCommit: commit,
    tarball: tarballName,
    sha256: checksum,
    smokeCommands: ["version", "setup", "workspace status", "config apply", "doctor"],
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outputDir, "install-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`retained tarball: ${destTarball}`);
  console.log(`checksum: ${checksum}`);
  console.log(`source commit: ${commit}`);
  console.log("");
  console.log("Transfer to the new Mac, then:");
  console.log(`  shasum -a 256 -c ${tarballName}.sha256`);
  console.log(`  npm install -g ${destTarball}`);
  console.log("Roll back with:");
  console.log(`  npm uninstall -g ${pkg.name}`);
}

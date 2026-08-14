import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function runCommand(binPath, args, cwd, env, { expectFailure = false } = {}) {
  const result = spawnSync(binPath, args, { cwd, env, encoding: "utf8" });
  if (expectFailure) return result;
  assert.equal(
    result.status,
    0,
    `roborepo ${args.join(" ")} failed (exit ${result.status})\n${result.stdout}${result.stderr}`,
  );
  return result;
}

export function assertVersionOutput(result, appRoot) {
  assert.match(result.stdout, /mode: package/, `expected package mode\n${result.stdout}`);
  const appRootLine = result.stdout.match(/appRoot: (.+)/);
  assert.ok(appRootLine, `expected an appRoot line\n${result.stdout}`);
  assert.equal(
    fs.realpathSync(appRootLine[1].trim()),
    fs.realpathSync(appRoot),
    "reported appRoot must resolve inside the isolated npm prefix",
  );
}

export function assertWorkspaceInitialized(workspaceRoot) {
  assert.ok(fs.existsSync(workspaceRoot), `expected workspaceRoot to be created at ${workspaceRoot}`);
  const manifest = path.join(workspaceRoot, "workspace.json");
  assert.ok(fs.existsSync(manifest), `expected workspace.json at ${manifest}`);
}

// The public lifecycle vocabulary (init / library / uninstall) run against a real npm install.
// The rest of the smoke test drives the lower-level primitive sequence; these are the commands a
// package-mode user actually types, so without them package mode is only verified for a path the
// documentation no longer tells anyone to use.
//
// `uninstall` is exercised as --dry-run only. A real managed cleanup here would delete the sandbox
// state this test's later assertions (appRoot immutability, coupling scans) still read, and the
// destructive path already has fixture-based coverage in managed-uninstall-check.mjs.
export function assertPublicLifecycle(binPath, dirs, env) {
  // Non-interactive init: no TTY, so the Package Library applies its defaults rather than
  // prompting. `setup` already ran above, which is exactly the case that must NOT read as
  // "already initialized" — directory existence is not initialization state.
  const initOut = runCommand(binPath, ["init"], dirs.cwd, env);
  assert.match(
    initOut.stdout,
    /RoboRepo is initialized|already initialized/,
    `expected init to report a terminal state\n${initOut.stdout}${initOut.stderr}`,
  );

  // Re-running a completed init must report, not replay: no re-prompting for selections the user
  // already made and no re-applying config they may have hand-edited since.
  const reinit = runCommand(binPath, ["init"], dirs.cwd, env);
  assert.match(
    reinit.stdout,
    /already initialized/i,
    `expected a completed init to be idempotent\n${reinit.stdout}${reinit.stderr}`,
  );

  const libraryOut = runCommand(binPath, ["library", "--help"], dirs.cwd, env);
  assert.match(
    libraryOut.stdout,
    /packages/i,
    `expected library to describe the package workflow\n${libraryOut.stdout}`,
  );

  const uninstallOut = runCommand(binPath, ["uninstall", "--dry-run"], dirs.cwd, env);
  assert.match(
    uninstallOut.stdout,
    /Dry run complete\. Nothing was removed\./,
    `expected uninstall --dry-run to complete without mutating\n${uninstallOut.stdout}${uninstallOut.stderr}`,
  );
  assert.match(
    uninstallOut.stdout,
    /workspace will be preserved/i,
    `expected uninstall --dry-run to name the preserved workspace\n${uninstallOut.stdout}`,
  );
  assert.ok(
    fs.existsSync(dirs.workspaceRoot),
    "uninstall --dry-run must not remove the workspace",
  );
}

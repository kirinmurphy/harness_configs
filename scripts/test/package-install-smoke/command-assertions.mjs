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

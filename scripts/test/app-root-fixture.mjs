// Shared isolated-app-root fixture for tests that spawn the real CLI.
//
// WHY THIS EXISTS: appRoot is where roborepo reads built-ins AND writes build output — notably
// generated/<harness>/<rootConfig> (see cli/paths.mjs's rootConfigBaseline). A test that isolates
// only HOME and ROBOREPO_STATE_DIR still has appRoot pointing at the real checkout, so any command
// touching root config writes to TRACKED files, stamping a temp path into
// generated/claude/settings.json. That has reached a merge candidate before.
//
// Four checks previously hand-rolled this, and every copy shared the same two defects: they omitted
// modules/ (scripts/cli imports it, so the CLI dies at import time the moment a test touches
// maintenance-stores or localhoster), and they resolved source paths against process.cwd() rather
// than the repo, so the fixture silently built from the wrong tree when run from elsewhere.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Everything the CLI resolves out of appRoot at runtime. modules/ is not optional: scripts/cli
// imports it directly (maintenance-stores.mjs -> modules/localhoster, modules/retention).
const APP_ROOT_CONTENTS = ["manifests", "globals", "scripts", "modules"];

// A .git dir is what makes isDevelopmentCheckout() report development mode (cli/roots.mjs), which
// is what these tests are exercising. Without it the fixture runs in package mode and behaves
// differently from the checkout under test.
export function makeAppRoot({ prefix = "roborepo-app-" } = {}) {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(appRoot, ".git"), { recursive: true });
  for (const entry of APP_ROOT_CONTENTS) {
    fs.cpSync(path.join(repoRoot, entry), path.join(appRoot, entry), { recursive: true });
  }
  return appRoot;
}

// Harness config files start empty rather than absent because several code paths read the existing
// root config before merging into it, and a missing file is a different case than an empty one.
export function makeHome({ prefix = "roborepo-home-" } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{}");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), "");
  return home;
}

// The full env a spawned CLI needs to stay off this checkout and off the real ~/.roborepo.
// ROBOREPO_SKIP_MCP defaults on: wiring MCP shells out to the `claude` binary, which is not
// something a test should depend on being installed.
export function makeCliEnv({ appRoot, home, skipMcp = true, extra = {} } = {}) {
  return {
    ...process.env,
    HOME: home,
    ROBOREPO_APP_ROOT: appRoot,
    ROBOREPO_STATE_DIR: path.join(home, ".roborepo"),
    ROBOREPO_MODE: "development",
    ...(skipMcp ? { ROBOREPO_SKIP_MCP: "1" } : {}),
    ...extra,
  };
}

// Convenience for the common shape: one isolated app root + home + env, and a cleanup that removes
// both. Callers that need several homes against one app root should use the pieces directly.
export function makeIsolatedCli({ prefix = "roborepo-", skipMcp = true, extra = {} } = {}) {
  const appRoot = makeAppRoot({ prefix: `${prefix}app-` });
  const home = makeHome({ prefix: `${prefix}home-` });
  return {
    appRoot,
    home,
    env: makeCliEnv({ appRoot, home, skipMcp, extra }),
    cleanup() {
      fs.rmSync(appRoot, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

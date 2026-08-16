#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The real checkout root (scripts/test/ -> two levels up). Used to prove dev mode never scaffolds here.
const realAppRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-workspace-resources-"));
const appRoot = path.join(tmp, "app");
const workspace = path.join(tmp, "workspace");
fs.mkdirSync(appRoot, { recursive: true });
// No .git and no local/skills -> package mode. Seed one built-in MCP server + package to conflict on.
fs.mkdirSync(path.join(appRoot, "manifests", "inventory"), { recursive: true });
fs.writeFileSync(
  path.join(appRoot, "manifests", "inventory", "mcp-servers.json"),
  JSON.stringify({ servers: [{ name: "builtin-srv", commandOrUrl: "npx", args: [], harnesses: ["claude"] }] }, null, 2),
);
fs.mkdirSync(path.join(appRoot, "globals", "packages", "builtin-pkg"), { recursive: true });
fs.writeFileSync(
  path.join(appRoot, "globals", "packages", "builtin-pkg", "package.config.json"),
  JSON.stringify({
    schemaVersion: 1,
    id: "builtin-pkg",
    label: "Built In",
    description: "Built in package.",
    lifecycle: "optional",
    presentation: { category: "integrations", order: 1 },
    resources: [],
  }, null, 2),
);
// Copy a package.json so version resolution works if touched.
fs.writeFileSync(path.join(appRoot, "package.json"), JSON.stringify({ version: "9.9.9" }, null, 2));

process.env.HOME = tmp;
process.env.ROBOREPO_APP_ROOT = appRoot;
process.env.ROBOREPO_STATE_ROOT = path.join(tmp, "state");
process.env.ROBOREPO_WORKSPACE_ROOT = workspace;

const { initializeWorkspace, packageMode, workspaceMcpServersPath, workspaceOverridesDir } =
  await import("../cli/paths.mjs");
assert.equal(packageMode, true, "fake tarball app root must be package mode");
initializeWorkspace();

const { loadWorkspaceMcpServers, hasReplaceOverride } = await import("../cli/workspace-resources.mjs");
const builtInNames = new Set(["builtin-srv"]);

// Workspace server that collides with a built-in and has no override -> throws.
fs.writeFileSync(
  workspaceMcpServersPath,
  JSON.stringify({ servers: [{ name: "builtin-srv", commandOrUrl: "x", args: [], harnesses: ["claude"] }] }, null, 2),
);
assert.throws(
  () => loadWorkspaceMcpServers({ builtInNames }),
  /conflicts with a built-in/,
  "collision without override must throw",
);

// Add a typed replace override -> allowed.
fs.writeFileSync(
  path.join(workspaceOverridesDir, "resources.json"),
  JSON.stringify({ schemaVersion: 1, overrides: [{ type: "mcp-server", id: "builtin-srv", mode: "replace" }] }, null, 2),
);
assert.equal(hasReplaceOverride("mcp-server", "builtin-srv"), true, "typed replace override is recognized");
const servers = loadWorkspaceMcpServers({ builtInNames });
assert.equal(servers.length, 1, "override lets the workspace server load");
assert.equal(servers[0].commandOrUrl, "x", "workspace server value is used");

// A non-replace override mode is rejected at parse time.
fs.writeFileSync(
  path.join(workspaceOverridesDir, "resources.json"),
  JSON.stringify({ schemaVersion: 1, overrides: [{ type: "mcp-server", id: "builtin-srv", mode: "merge" }] }, null, 2),
);
assert.throws(() => hasReplaceOverride("mcp-server", "builtin-srv"), /mode "replace"/, "only replace mode is accepted");

// Development mode must never scaffold into the checkout.
delete process.env.ROBOREPO_APP_ROOT;
delete process.env.ROBOREPO_WORKSPACE_ROOT;
assert.ok(!fs.existsSync(path.join(realAppRoot, "workspace.json")), "checkout must not gain a workspace.json");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("workspace-resources ok");

#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadPackageCatalog, validatePackageCatalog } from "../cli/package-catalog.mjs";
import { listPackageCommands } from "../cli/package-commands.mjs";
import { loadSlashCommandPlan } from "../cli/slash-commands.mjs";
import { readConfigSnapshot } from "../cli/config.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const catalog = loadPackageCatalog({ includeUnavailable: true });
validatePackageCatalog(catalog);

const packageIds = new Set(catalog.map((pkg) => pkg.id));
for (const id of ["jcodemunch", "jdocmunch", "telemetry", "caveman"]) {
  assert(packageIds.has(id), `missing package: ${id}`);
}
assert(!packageIds.has("code-intel"), "Code Intelligence composite package should not be present");

const commands = listPackageCommands({ includeUnavailable: true }).map((command) => command.name).sort();
for (const name of ["index code", "index docs", "watch code"]) {
  assert(commands.includes(name), `missing package CLI command: ${name}`);
}

const slashNames = loadSlashCommandPlan().commands.map((command) => command.name).sort();
for (const name of ["case-study", "frontend-design", "plan-docs", "tighten", "wrap-up"]) {
  assert(slashNames.includes(name), `missing slash command: ${name}`);
}

const snapshot = readConfigSnapshot();
const sections = new Map(snapshot.behaviorView.map((section) => [section.category, section]));
assert(sections.has("Token Optimization"), "missing Token Optimization section");
assert(sections.has("Commands"), "missing Commands section");
assert(sections.has("Code Conventions"), "missing Code Conventions section");
assert(sections.has("Chat-Time Output"), "missing Chat-Time Output section");
assert(sections.get("Token Optimization").items.some((item) => item.id === "jcodemunch"), "jcodemunch not visible in Token Optimization");
assert(sections.get("Commands").items.some((item) => item.label === "/tighten"), "/tighten not visible in Commands");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-package-catalog-"));
try {
  fs.mkdirSync(path.join(tempRoot, "manifests", "inventory"), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, "manifests", "inventory", "package-categories.json"),
    JSON.stringify({ schemaVersion: 1, categories: [{ id: "commands", label: "Commands", order: 1 }] }),
  );
  fs.mkdirSync(path.join(tempRoot, "globals", "packages", "legacy-shape"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "globals", "packages", "legacy-shape", "package.config.json"), JSON.stringify({
    schemaVersion: 1,
    id: "legacy-shape",
    label: "Legacy Shape",
    description: "Legacy package shape.",
    presentation: { category: "commands" },
    components: [],
  }));
  const result = spawnSync(process.execPath, [
    "-e",
    `import(${JSON.stringify(path.resolve("scripts/cli/package-catalog.mjs"))}).then((m) => { try { m.loadPackageCatalog({ includeUnavailable: true }); process.exit(1); } catch (err) { process.exit(String(err.message).includes("resources must be an array") ? 0 : 1); } })`,
  ], {
    env: { ...process.env, ROBOREPO_APP_ROOT: tempRoot, ROBOREPO_STATE_DIR: path.join(tempRoot, "state") },
    stdio: "ignore",
  });
  assert(result.status === 0, "package configs with legacy components should be rejected");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const scaffoldWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-package-scaffold-"));
try {
  const cliPath = path.resolve("scripts/cli/main.mjs");
  const env = { ...process.env, ROBOREPO_MODE: "package", ROBOREPO_WORKSPACE_ROOT: scaffoldWorkspace, ROBOREPO_STATE_DIR: path.join(scaffoldWorkspace, "state") };
  const create = spawnSync(process.execPath, [cliPath, "package", "create", "scaffold-check", "--kind=auto-skill"], { env, encoding: "utf8" });
  assert(create.status === 0, `package create should succeed: ${create.stderr}\n${create.stdout}`);
  assert(create.stdout.includes("next: roborepo package validate scaffold-check"), "create should print the next validate command");
  assert(fs.existsSync(path.join(scaffoldWorkspace, "packages", "scaffold-check", "package.config.json")), "scaffolded package.config.json should exist in the workspace");

  const validate = spawnSync(process.execPath, [cliPath, "package", "validate", "scaffold-check"], { env, encoding: "utf8" });
  assert(validate.status === 0, `scaffolded package should validate clean: ${validate.stderr}\n${validate.stdout}`);

  const collision = spawnSync(process.execPath, [cliPath, "package", "create", "scaffold-check", "--kind=auto-skill"], { env, encoding: "utf8" });
  assert(collision.status !== 0, "package create should refuse to overwrite an existing package");
} finally {
  fs.rmSync(scaffoldWorkspace, { recursive: true, force: true });
}

// Development-checkout mode: `roborepo package create` must scaffold directly into
// globals/packages/ (the real shared source), not a workspace dir — mirrors skill-new.mjs's
// packageMode ? workspaceSkillsDir : sharedSkillsDir branch.
const devRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-package-scaffold-dev-"));
try {
  fs.mkdirSync(path.join(devRoot, ".git"), { recursive: true });
  fs.cpSync(path.resolve("manifests"), path.join(devRoot, "manifests"), { recursive: true });
  const cliPath = path.resolve("scripts/cli/main.mjs");
  const env = { ...process.env, ROBOREPO_MODE: "development", ROBOREPO_APP_ROOT: devRoot, ROBOREPO_STATE_DIR: path.join(devRoot, "state") };
  const create = spawnSync(process.execPath, [cliPath, "package", "create", "dev-scaffold-check", "--kind=empty"], { env, encoding: "utf8" });
  assert(create.status === 0, `dev-mode package create should succeed: ${create.stderr}\n${create.stdout}`);
  assert(
    fs.existsSync(path.join(devRoot, "globals", "packages", "dev-scaffold-check", "package.config.json")),
    "dev-mode scaffold should write into globals/packages/, not a workspace dir",
  );
} finally {
  fs.rmSync(devRoot, { recursive: true, force: true });
}

console.log("ok: package catalog behavior");

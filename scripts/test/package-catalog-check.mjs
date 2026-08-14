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
for (const id of ["jcodemunch", "jdocmunch", "telemetry", "caveman", "plan-promote", "plan-start"]) {
  assert(packageIds.has(id), `missing package: ${id}`);
}
assert(!packageIds.has("code-intel"), "Code Intelligence composite package should not be present");

const commands = listPackageCommands({ includeUnavailable: true }).map((command) => command.name).sort();
for (const name of ["index code", "index docs", "watch code"]) {
  assert(commands.includes(name), `missing package CLI command: ${name}`);
}

const slashNames = loadSlashCommandPlan().commands.map((command) => command.name).sort();
for (const name of ["case-study", "plan-docs", "tighten", "wrap-up", "plan-promote", "plan-start"]) {
  assert(slashNames.includes(name), `missing slash command: ${name}`);
}

const snapshot = readConfigSnapshot();
const sections = new Map(snapshot.behaviorView.map((section) => [section.category, section]));

// Every category in the manifest that owns at least one package must reach the rendered view.
//
// Derived from the manifest rather than listed, so adding a category extends the assertion for
// free. This is a regression guard, not a reproduction: three categories once shipped invisible
// because portal/config/state.js kept a second hard-coded category->template map
// (SECTION_TEMPLATE_ID) that a new category had to be added to by hand. Commit 8c82f6e deleted that
// map and made the portal render from this manifest, so the failure is structurally gone. What this
// catches is a future reintroduction of per-category wiring anywhere between manifest and view.
//
// Categories with no packages are skipped: buildBehaviorView filters empty sections deliberately,
// so an unused category is absent by design, not by failure.
const categories = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../../manifests/inventory/package-categories.json"), "utf8"),
).categories;
const populated = new Set(catalog.map((pkg) => pkg.presentation?.category).filter(Boolean));
for (const category of categories) {
  if (!populated.has(category.id)) continue;
  assert(
    sections.has(category.label),
    `category "${category.id}" (${category.label}) has packages but renders no section — `
      + "every populated manifest category must appear in behaviorView",
  );
}

// Non-package sections are appended by buildBehaviorView rather than coming from the manifest, so
// they need their own assertion — the loop above cannot see them.
for (const label of ["Permissions", "Local Stores"]) {
  assert(sections.has(label), `missing ${label} section`);
}

assert(sections.get("Token Optimization").items.some((item) => item.id === "jcodemunch"), "jcodemunch not visible in Token Optimization");
assert(sections.get("Skills - Development Life Cycle").items.some((item) => item.id === "tighten"), "tighten not visible in Skills - Development Life Cycle");

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
  const create = spawnSync(process.execPath, [cliPath, "package", "dev", "create", "scaffold-check", "--kind=auto-skill"], { env, encoding: "utf8" });
  assert(create.status === 0, `package dev create should succeed: ${create.stderr}\n${create.stdout}`);
  assert(create.stdout.includes("next: roborepo package validate scaffold-check"), "create should print the next validate command");
  assert(fs.existsSync(path.join(scaffoldWorkspace, "packages", "scaffold-check", "package.config.json")), "scaffolded package.config.json should exist in the workspace");

  const validate = spawnSync(process.execPath, [cliPath, "package", "validate", "scaffold-check"], { env, encoding: "utf8" });
  assert(validate.status === 0, `scaffolded package should validate clean: ${validate.stderr}\n${validate.stdout}`);

  const collision = spawnSync(process.execPath, [cliPath, "package", "dev", "create", "scaffold-check", "--kind=auto-skill"], { env, encoding: "utf8" });
  assert(collision.status !== 0, "package dev create should refuse to overwrite an existing package");
} finally {
  fs.rmSync(scaffoldWorkspace, { recursive: true, force: true });
}

// Development-checkout mode: `roborepo package dev create` must scaffold directly into
// globals/packages/ (the real shared source), not a workspace dir — mirrors skill-new.mjs's
// packageMode ? workspaceSkillsDir : sharedSkillsDir branch.
const devRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-package-scaffold-dev-"));
try {
  fs.mkdirSync(path.join(devRoot, ".git"), { recursive: true });
  fs.cpSync(path.resolve("manifests"), path.join(devRoot, "manifests"), { recursive: true });
  // module-loader.mjs resolves "module" adapter commands (package dev create, ...) relative to
  // appRoot, mirroring the real npm package layout (scripts/cli/ ships under the install root) — so
  // a spawned CLI subprocess under a fake appRoot needs scripts/ too, not just manifests/.
  fs.cpSync(path.resolve("scripts"), path.join(devRoot, "scripts"), { recursive: true });
  // package-catalog.mjs resolves harnesses through scripts/harnesses/registry.mjs, whose Claude
  // and Codex provider modules read their manifest from globals/harnesses/<id>/provider.json —
  // needed here too, same gap the Phase 3 grounding notes describe for test-roborepo.sh sandboxes.
  fs.mkdirSync(path.join(devRoot, "globals"), { recursive: true });
  fs.cpSync(path.resolve("globals/harnesses"), path.join(devRoot, "globals", "harnesses"), { recursive: true });
  const cliPath = path.resolve("scripts/cli/main.mjs");
  const env = { ...process.env, ROBOREPO_MODE: "development", ROBOREPO_APP_ROOT: devRoot, ROBOREPO_STATE_DIR: path.join(devRoot, "state") };
  const create = spawnSync(process.execPath, [cliPath, "package", "dev", "create", "dev-scaffold-check", "--kind=empty"], { env, encoding: "utf8" });
  assert(create.status === 0, `dev-mode package dev create should succeed: ${create.stderr}\n${create.stdout}`);
  assert(
    fs.existsSync(path.join(devRoot, "globals", "packages", "dev-scaffold-check", "package.config.json")),
    "dev-mode scaffold should write into globals/packages/, not a workspace dir",
  );
} finally {
  fs.rmSync(devRoot, { recursive: true, force: true });
}

console.log("ok: package catalog behavior");

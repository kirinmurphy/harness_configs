#!/usr/bin/env node
// Generic per-package lifecycle contract: every catalog package must enable, re-enable (idempotent),
// disable, and re-disable (idempotent) without error, and the enabled-packages registry must reflect
// the expected state after each step. Complements system-package-ownership-characterization-check.mjs
// (which hand-asserts specific Codex hook content for 2 packages) by covering every package generically
// rather than by name.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadPackageCatalog } from "../cli/package-catalog.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(repoRoot, "scripts/cli/main.mjs");

function makeHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-package-lifecycle-"));
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(tmp, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".claude", "settings.json"), "{}");
  fs.writeFileSync(path.join(tmp, ".codex", "config.toml"), "");
  return tmp;
}

function readRegistry(tmp) {
  try {
    return JSON.parse(fs.readFileSync(path.join(tmp, ".roborepo", "enabled-packages.json"), "utf8")).packages || [];
  } catch {
    return [];
  }
}

const packageIds = loadPackageCatalog().map((pkg) => pkg.id);
assert.ok(packageIds.length > 0, "expected at least one package in the catalog");

for (const pkgId of packageIds) {
  const tmp = makeHome();
  const env = { ...process.env, HOME: tmp, ROBOREPO_STATE_DIR: path.join(tmp, ".roborepo"), ROBOREPO_SKIP_MCP: "1" };
  try {
    const enable1 = spawnSync(process.execPath, [cli, "package", "enable", pkgId], { env, encoding: "utf8" });
    assert.equal(enable1.status, 0, `${pkgId}: enable should succeed\n${enable1.stderr}`);
    assert.ok(readRegistry(tmp).includes(pkgId), `${pkgId}: registry should list package enabled after enable`);

    const enable2 = spawnSync(process.execPath, [cli, "package", "enable", pkgId], { env, encoding: "utf8" });
    assert.equal(enable2.status, 0, `${pkgId}: re-enable should be idempotent\n${enable2.stderr}`);

    const disable1 = spawnSync(process.execPath, [cli, "package", "disable", pkgId], { env, encoding: "utf8" });
    assert.equal(disable1.status, 0, `${pkgId}: disable should succeed\n${disable1.stderr}`);
    assert.ok(!readRegistry(tmp).includes(pkgId), `${pkgId}: registry should not list package enabled after disable`);

    const disable2 = spawnSync(process.execPath, [cli, "package", "disable", pkgId], { env, encoding: "utf8" });
    assert.equal(disable2.status, 0, `${pkgId}: re-disable should be idempotent\n${disable2.stderr}`);

    const enable3 = spawnSync(process.execPath, [cli, "package", "enable", pkgId], { env, encoding: "utf8" });
    assert.equal(enable3.status, 0, `${pkgId}: re-enable after disable should succeed\n${enable3.stderr}`);
    assert.ok(readRegistry(tmp).includes(pkgId), `${pkgId}: registry should list package enabled after re-enable`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`ok: package lifecycle contract (${packageIds.length} packages)`);

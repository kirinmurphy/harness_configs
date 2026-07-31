#!/usr/bin/env node
// Characterizes permissions-render.mjs's renderPermissionsTo (the LIVE home-config path used by
// config controls, distinct from scripts/build/render-agent-permissions.mjs's build-time repo
// SOURCE render, which stays Phase 8 scope and is already covered by doctor's real
// `render-agent-permissions.mjs --check` run) before Phase 5 replaces its two hardcoded
// `if (harness dir exists)` blocks with dispatch through provider permissions.render adapters
// (docs/plans/active/discoverable-harness-provider-architecture-plan.md). Pins: only present
// harness config gets written, Codex is skipped when its config.toml doesn't already exist (never
// fabricated from nothing), Claude's model key is always stripped, and both harnesses' generated
// blocks reflect the same resolved behaviors/overrides.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.ROBOREPO_APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { renderPermissionsTo, loadPermissionManifest } = await import("../cli/permissions-render.mjs");

const manifest = loadPermissionManifest();

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-permissions-live-"));
}

// --- Only present harness configs are touched; Codex is skipped entirely when config.toml doesn't
// already exist (a home with only .claude present) ---
{
  const home = makeHome();
  try {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{}");
    const { touched } = renderPermissionsTo(home, { manifest });
    assert.deepEqual(touched, [path.join(home, ".claude", "settings.json")], "only the present Claude settings file is touched");
    const settings = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
    assert.ok(settings.permissions, "permissions key rendered into Claude settings");
    assert.ok(Array.isArray(settings.permissions.allow), "Claude permissions.allow is an array");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// --- Both present, both existing configs: both get touched, model key stripped from Claude ---
{
  const home = makeHome();
  try {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ model: "some-model", other: "kept" }));
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(home, ".codex", "config.toml"), "model_reasoning_effort = \"high\"\n");
    const { touched } = renderPermissionsTo(home, { manifest });
    assert.equal(touched.length, 2, "both present+existing configs are touched");

    const settings = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
    assert.equal(settings.model, undefined, "model key is always stripped from Claude settings");
    assert.equal(settings.other, "kept", "unrelated existing Claude settings keys are preserved");

    const codexToml = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    assert.match(codexToml, /BEGIN GENERATED AGENT PERMISSIONS/, "Codex config gets the generated permissions block");
    assert.match(codexToml, /model_reasoning_effort = "high"/, "unrelated existing Codex config content is preserved");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// --- Codex home present but config.toml absent: never fabricated from nothing ---
{
  const home = makeHome();
  try {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{}");
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    // No config.toml written.
    renderPermissionsTo(home, { manifest });
    assert.equal(fs.existsSync(path.join(home, ".codex", "config.toml")), false, "Codex config.toml must never be fabricated when absent");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// --- Overrides change the resolved bucket for both harnesses consistently ---
{
  const home = makeHome();
  try {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{}");
    const writeFilesBehavior = manifest.behaviors.find((b) => b.id === "write-files");
    assert.ok(writeFilesBehavior, "fixture assumption: manifest declares a write-files behavior");
    const overrides = { behaviors: { "write-files": "deny" } };
    renderPermissionsTo(home, { manifest, overrides });
    const settings = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
    const writeTools = writeFilesBehavior.tools || [];
    for (const tool of writeTools) {
      assert.ok(!settings.permissions.allow.includes(tool), `${tool} must not be in allow when write-files is overridden to deny`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log("permissions-render-live-characterization-check: ok");

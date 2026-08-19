#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { configOnboardingNotice, hasOptionalPackageSelected } = await import(
  path.join(repoRoot, "portal/config/onboarding-state.js")
);

const catalog = [
  { id: "claude", displayName: "Claude Code" },
  { id: "codex", displayName: "Codex" },
];

{
  const snap = { harnesses: catalog, machineHarnesses: [], packages: [] };
  const notice = configOnboardingNotice(snap);
  assert.equal(notice.variant, "warning");
  assert.match(notice.title, /No active agent harness/);
  assert.match(notice.body, /Package selections are saved/);
  assert.match(notice.body, /Claude Code and Codex/);
}

{
  const snap = {
    harnesses: catalog,
    machineHarnesses: [{ id: "claude", displayName: "Claude Code", enabled: true }],
    onboarding: { libraryCompleted: false },
    packages: [{ id: "usage-statusline", enabled: true, defaultEnabled: true }],
  };
  const notice = configOnboardingNotice(snap);
  assert.equal(notice.variant, "info");
  assert.match(notice.title, /Finish choosing optional packages/);
  assert.equal(hasOptionalPackageSelected(snap), false);
}

{
  const snap = {
    harnesses: catalog,
    machineHarnesses: [{ id: "claude", displayName: "Claude Code", enabled: true }],
    onboarding: { libraryCompleted: true },
    packages: [{ id: "usage-statusline", enabled: true, defaultEnabled: true }],
  };
  const notice = configOnboardingNotice(snap);
  assert.equal(notice.variant, "info");
  assert.match(notice.title, /Add optional packages/);
}

{
  const snap = {
    harnesses: catalog,
    machineHarnesses: [{ id: "claude", displayName: "Claude Code", enabled: true }],
    onboarding: { libraryCompleted: true },
    packages: [
      { id: "usage-statusline", enabled: true, defaultEnabled: true },
      { id: "telemetry", enabled: true, defaultEnabled: false },
    ],
  };
  assert.equal(hasOptionalPackageSelected(snap), true);
  assert.equal(configOnboardingNotice(snap), null);
}

{
  const snap = {
    harnesses: catalog,
    machineHarnesses: [{ id: "codex", displayName: "Codex", enabled: false }],
    packages: [{ id: "telemetry", enabled: true, defaultEnabled: false }],
  };
  assert.equal(configOnboardingNotice(snap).variant, "warning", "disabled harnesses do not count as active");
}

console.log("config onboarding state checks passed");

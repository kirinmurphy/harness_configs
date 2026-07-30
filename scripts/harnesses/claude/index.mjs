// Claude Code harness provider. Phase 2 wires this into the registry with real discovery and
// placeholder capability adapters; Phases 3-6 replace the placeholders with migrated behavior
// from scripts/cli/{root-config-merge,mcp-claude,telemetry,...}.mjs one capability at a time.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineHarnessProvider } from "../contract.mjs";
import { detectHarnessProvider } from "../discovery.mjs";
import { stubAdapterGroups } from "../stub-adapter.mjs";
import { mergeClaudeSettings, normalizeRootConfigContent } from "../../cli/root-config-merge.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(here, "..", "..", "..", "globals", "harnesses", "claude", "provider.json");
const claudeManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function statusLineMatches(existing, desired) {
  return JSON.stringify(existing || null) === JSON.stringify(desired || null);
}

// merge/render/mergePackageComponent/unmergePackageComponent stay thin wrappers over
// root-config-merge.mjs's existing, characterization-tested functions
// (scripts/test/{root-config-merge,package-harness-config}-characterization-check.mjs) rather
// than a re-port — this phase moves OWNERSHIP behind the provider contract, not the
// implementation itself. mergePackageComponent/unmergePackageComponent take the already-read
// component config (not the raw component) so this module never needs package-harness-config.mjs's
// readHarnessConfig, which depends on paths.mjs -> registry.mjs -> this module — a cycle.
function mergePackageComponent(pkg, config, { claudeSettingsPath, readSettings, writeSettings }) {
  if (!config.statusLine || typeof config.statusLine !== "object") {
    throw new Error(`${pkg.id}: Claude harness-config needs statusLine`);
  }
  const settings = readSettings(claudeSettingsPath);
  if (settings.statusLine && !statusLineMatches(settings.statusLine, config.statusLine)) {
    console.warn("  conflict: Claude statusLine already exists; leaving unmanaged setting unchanged");
    return;
  }
  settings.statusLine = config.statusLine;
  writeSettings(claudeSettingsPath, settings);
  console.log(`  wired: Claude statusLine -> ${claudeSettingsPath}`);
}

function unmergePackageComponent(pkg, config, { claudeSettingsPath, readSettings, writeSettings }) {
  const settings = readSettings(claudeSettingsPath);
  if (!settings.statusLine) {
    console.log("  ok: Claude statusLine already absent");
    return;
  }
  if (!statusLineMatches(settings.statusLine, config.statusLine)) {
    console.warn("  conflict: Claude statusLine is unmanaged; leaving it unchanged");
    return;
  }
  delete settings.statusLine;
  writeSettings(claudeSettingsPath, settings);
  console.log(`  removed: Claude statusLine <- ${claudeSettingsPath}`);
}

const stubGroups = stubAdapterGroups("claude", {
  rules: ["render"],
  permissions: ["render"],
  skills: ["link"],
  commands: ["render"],
  hooks: ["read", "write"],
  mcp: ["add", "remove"],
  telemetry: ["wireCaptureHooks"],
  transcripts: ["locate", "parse"],
  session: ["launch"],
});

export const claudeProvider = defineHarnessProvider({
  manifest: claudeManifest,
  adapters: {
    discovery: { detect: () => detectHarnessProvider(claudeManifest) },
    ...stubGroups,
    rootConfig: {
      merge: (repoText, localText) => mergeClaudeSettings(repoText, localText),
      render: (content) => normalizeRootConfigContent("claude", content),
      mergePackageComponent,
      unmergePackageComponent,
    },
  },
});

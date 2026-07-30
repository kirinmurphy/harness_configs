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

// merge/render stay thin wrappers over root-config-merge.mjs / root-config-writes.mjs's existing,
// characterization-tested functions (scripts/test/root-config-merge-characterization-check.mjs)
// rather than a re-port — this phase moves OWNERSHIP behind the provider contract, not the
// implementation itself.
const stubGroups = stubAdapterGroups("claude", {
  rootConfig: ["mergePackageComponent"],
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
      ...stubGroups.rootConfig,
      merge: (repoText, localText) => mergeClaudeSettings(repoText, localText),
      render: (content) => normalizeRootConfigContent("claude", content),
    },
  },
});

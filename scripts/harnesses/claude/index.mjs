// Claude Code harness provider. Phase 2 wires this into the registry with real discovery and
// placeholder capability adapters; Phases 3-6 replace the placeholders with migrated behavior
// from scripts/cli/{root-config-merge,mcp-claude,telemetry,...}.mjs one capability at a time.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineHarnessProvider } from "../contract.mjs";
import { detectHarnessProvider } from "../discovery.mjs";
import { stubAdapterGroups } from "../stub-adapter.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(here, "..", "..", "..", "globals", "harnesses", "claude", "provider.json");
const claudeManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

export const claudeProvider = defineHarnessProvider({
  manifest: claudeManifest,
  adapters: {
    discovery: { detect: () => detectHarnessProvider(claudeManifest) },
    ...stubAdapterGroups("claude", {
      rootConfig: ["merge", "render", "mergePackageComponent"],
      rules: ["render"],
      permissions: ["render"],
      skills: ["link"],
      commands: ["render"],
      hooks: ["read", "write"],
      mcp: ["add", "remove"],
      telemetry: ["wireCaptureHooks"],
      transcripts: ["locate", "parse"],
      session: ["launch"],
    }),
  },
});

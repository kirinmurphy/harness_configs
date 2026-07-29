// Codex harness provider. Phase 2 wires this into the registry with real discovery and
// placeholder capability adapters; Phases 3-6 replace the placeholders with migrated behavior
// from scripts/cli/{root-config-merge,mcp-codex,telemetry,...}.mjs one capability at a time.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineHarnessProvider } from "../contract.mjs";
import { detectHarnessProvider } from "../discovery.mjs";
import { stubAdapterGroups } from "../stub-adapter.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(here, "..", "..", "..", "globals", "harnesses", "codex", "provider.json");
const codexManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

export const codexProvider = defineHarnessProvider({
  manifest: codexManifest,
  adapters: {
    discovery: { detect: () => detectHarnessProvider(codexManifest) },
    ...stubAdapterGroups("codex", {
      rootConfig: ["merge", "render", "mergePackageComponent"],
      rules: ["render"],
      permissions: ["render"],
      skills: ["link"],
      commands: ["render"],
      hooks: ["read", "write"],
      mcp: ["add", "remove"],
      telemetry: ["wireCaptureHooks", "parseRateLimits"],
      transcripts: ["locate", "parse"],
      session: ["launch"],
    }),
  },
});

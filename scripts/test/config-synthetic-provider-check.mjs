#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Phase 7 of discoverable-harness-provider-architecture-plan.md: prove the Config snapshot's
// `harnesses` list (grid columns, defaults popover) and root-config baseline/active path maps do
// not encode a two-provider assumption. Same subprocess-isolation technique as
// telemetry-synthetic-provider-check.mjs (registry.mjs's PROVIDERS map is a static import-time
// Map) — a fresh copy of scripts/+globals/harnesses/ with a fabricated third "acme" provider
// registered alongside the real claude/codex.
//
// Scoped to the pure per-provider derivations (configSnapshotHarnesses, rootConfigBaseline/Active),
// not the full readConfigSnapshot()/portal snapshot — that pulls in package catalog, skills,
// telemetry state, and other disk-backed machinery unrelated to the harness-genericness question
// this test exists to answer, and would need a fully faked $HOME/repoRoot to run in isolation.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-config-synthetic-provider-"));
const appRoot = path.join(tmp, "app");

fs.cpSync(path.resolve("scripts"), path.join(appRoot, "scripts"), { recursive: true });
fs.cpSync(path.resolve("globals/harnesses"), path.join(appRoot, "globals", "harnesses"), { recursive: true });
fs.cpSync(path.resolve("modules"), path.join(appRoot, "modules"), { recursive: true });
fs.cpSync(path.resolve("manifests"), path.join(appRoot, "manifests"), { recursive: true });

// A minimal third provider, "acme": declares root-config + rules (like claude/codex) with a
// dedicated-json-sidecar hooks file (like Codex) so configSnapshotHarnesses' hooksStorage branch
// has a real third case to generalize to, and a displayName distinct from its id.
const acmeDir = path.join(appRoot, "globals", "harnesses", "acme");
fs.mkdirSync(acmeDir, { recursive: true });
fs.writeFileSync(
  path.join(acmeDir, "provider.json"),
  JSON.stringify({
    schemaVersion: 1,
    id: "acme",
    displayName: "Acme Coder",
    commandName: "acme",
    adapter: "acme",
    detection: { minimumConfidence: "possible" },
    paths: {
      home: { path: "~/.acme", kind: "directory" },
      rootConfig: { path: "~/.acme/settings.json", kind: "file" },
      rules: { path: "~/.acme/AGENT.md", kind: "file" },
      hooks: { path: "~/.acme/hooks.json", kind: "file" },
      skills: { path: "~/.acme/skills", kind: "directory" },
      commands: { path: "~/.acme/commands", kind: "directory" },
    },
    capabilities: ["root-config", "rules", "hooks"],
    extensions: { roborepo: { hooksStorage: "dedicated-json-sidecar" } },
  }, null, 2),
);

const acmeAdapterDir = path.join(appRoot, "scripts", "harnesses", "acme");
fs.mkdirSync(acmeAdapterDir, { recursive: true });
fs.writeFileSync(
  path.join(acmeAdapterDir, "index.mjs"),
  [
    'import fs from "node:fs";',
    'import path from "node:path";',
    'import { fileURLToPath } from "node:url";',
    'import { defineHarnessProvider } from "../contract.mjs";',
    "",
    'const here = path.dirname(fileURLToPath(import.meta.url));',
    'const manifestPath = path.resolve(here, "..", "..", "..", "globals", "harnesses", "acme", "provider.json");',
    "const acmeManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));",
    "",
    "export const acmeProvider = defineHarnessProvider({",
    "  manifest: acmeManifest,",
    "  adapters: {",
    "    discovery: { detect: () => ({ providerId: 'acme', confidence: 'possible', evidence: [] }) },",
    "    rootConfig: { merge: (v) => v, render: () => '' },",
    "    rules: { render: () => '' },",
    "    hooks: { read: () => ({}), write: () => {}, merge: (v) => v, unmerge: (v) => v },",
    "  },",
    "});",
  ].join("\n"),
);

const registryPath = path.join(appRoot, "scripts", "harnesses", "registry.mjs");
fs.writeFileSync(
  registryPath,
  [
    'import { claudeProvider } from "./claude/index.mjs";',
    'import { codexProvider } from "./codex/index.mjs";',
    'import { acmeProvider } from "./acme/index.mjs";',
    "",
    "const PROVIDERS = new Map([",
    "  [claudeProvider.id, claudeProvider],",
    "  [codexProvider.id, codexProvider],",
    "  [acmeProvider.id, acmeProvider],",
    "]);",
    "",
    "export function listHarnessProviders() { return [...PROVIDERS.values()]; }",
    "export function getHarnessProvider(id) {",
    "  const provider = PROVIDERS.get(id);",
    '  if (!provider) throw new Error(`unsupported harness: ${id}`);',
    "  return provider;",
    "}",
    "export function hasHarnessProvider(id) { return PROVIDERS.has(id); }",
  ].join("\n"),
);

const probeScript = path.join(tmp, "probe.mjs");
fs.writeFileSync(
  probeScript,
  [
    `import { configSnapshotHarnesses } from ${JSON.stringify(path.join(appRoot, "scripts", "cli", "config.mjs"))};`,
    `import { rootConfigBaseline, rootConfigActive } from ${JSON.stringify(path.join(appRoot, "scripts", "cli", "paths.mjs"))};`,
    "",
    "const harnesses = configSnapshotHarnesses();",
    "",
    "// (1) three providers, not a hardcoded two.",
    "if (harnesses.length !== 3) {",
    "  console.error('FAIL harness count: ' + harnesses.length);",
    "  process.exit(1);",
    "}",
    "",
    "// (2) acme resolves its real manifest displayName and declared filenames, not its bare id or a",
    "// literal claude/codex-shaped guess.",
    "const acme = harnesses.find((h) => h.id === 'acme');",
    "if (!acme || acme.displayName !== 'Acme Coder' || acme.rulesFile !== 'AGENT.md' || acme.settingsFile !== 'settings.json') {",
    "  console.error('FAIL acme entry: ' + JSON.stringify(acme));",
    "  process.exit(1);",
    "}",
    "",
    "// (3) acme declares dedicated-json-sidecar hooksStorage (like Codex) -- hooksFile must follow",
    "// its own declared hooks path, not the root-config file an embedded-storage provider would show.",
    "if (acme.hooksFile !== 'hooks.json') {",
    "  console.error('FAIL acme hooksFile: ' + acme.hooksFile);",
    "  process.exit(1);",
    "}",
    "",
    "// (4) rootConfigBaseline/rootConfigActive both key by whatever's registered, not a hardcoded",
    "// claude/codex pair -- the exact gap that would otherwise make buildRootConfigView() call",
    "// fs.existsSync(undefined) for a genuine third provider.",
    "if (!('acme' in rootConfigBaseline) || !('acme' in rootConfigActive)) {",
    "  console.error('FAIL rootConfigBaseline/Active missing acme: ' + JSON.stringify({ rootConfigBaseline, rootConfigActive }));",
    "  process.exit(1);",
    "}",
    "if (!rootConfigBaseline.acme.endsWith('generated/acme/settings.json')) {",
    "  console.error('FAIL rootConfigBaseline.acme: ' + rootConfigBaseline.acme);",
    "  process.exit(1);",
    "}",
    "",
    "console.log('ok');",
  ].join("\n"),
);

const result = spawnSync(process.execPath, [probeScript], { encoding: "utf8" });
assert.equal(result.status, 0, `synthetic third-provider probe failed:\n${result.stdout}\n${result.stderr}`);
assert.match(result.stdout, /ok/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("config synthetic third-provider checks passed");

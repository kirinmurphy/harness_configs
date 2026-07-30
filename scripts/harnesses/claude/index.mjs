// Claude Code harness provider. Phase 2 wires this into the registry with real discovery and
// placeholder capability adapters; Phases 3-6 replace the placeholders with migrated behavior
// from scripts/cli/{root-config-merge,mcp-claude,telemetry,...}.mjs one capability at a time.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { defineHarnessProvider } from "../contract.mjs";
import { detectHarnessProvider } from "../discovery.mjs";
import { stubAdapterGroups } from "../stub-adapter.mjs";
import { mergeClaudeSettings, normalizeRootConfigContent } from "../../cli/root-config-merge.mjs";
import { repoRoot } from "../../cli/roots.mjs";

// Mirrors scripts/cli/mcp-config.mjs's MCP_SERVERS_PATH/MCP_SCOPES, duplicated rather than
// imported: mcp-config.mjs pulls in paths.mjs's registry-dependent half (rootConfigActive/
// rootConfigBaseline), which would cycle back through registry.mjs into this module — the same
// paths.mjs/roots.mjs import-cycle issue the Phase 3 grounding notes describe. roots.mjs is the
// registry-independent leaf, safe to import directly.
const MCP_SERVERS_PATH = path.join(repoRoot, "manifests", "inventory", "mcp-servers.json");
const MCP_SCOPES = ["user", "local", "project"];

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

// Ported from scripts/install/uninstall.sh's remove_mcp_servers (characterization test:
// scripts/test/harness-mcp-remove-characterization-check.mjs), which this replaces — the shell
// function now calls this adapter instead of its own inline bash+node. `claude mcp add` registers
// at a chosen scope (default "user"); `claude mcp remove` without --scope only checks the default
// ("local"), so a single remove leaks the other scopes. Removes from every scope via the CLI when
// available, then prunes ~/.claude.json directly as a fallback so the entry is gone even when the
// `claude` binary isn't present.
function mcpRemove({ homePath, dryRun = false } = {}) {
  const paths = [];
  const warnings = [];
  let names = [];
  try {
    const manifest = JSON.parse(fs.readFileSync(MCP_SERVERS_PATH, "utf8"));
    names = (manifest.servers || [])
      .filter((server) => (server.harnesses || []).includes("claude"))
      .map((server) => server.name);
  } catch (err) {
    warnings.push(`could not read ${MCP_SERVERS_PATH}: ${err.message}`);
  }

  if (names.length === 0) {
    return { ok: true, changed: false, providerId: "claude", action: "mcp.remove", paths, warnings };
  }

  if (dryRun) {
    return { ok: true, changed: false, providerId: "claude", action: "mcp.remove", paths, warnings: [...warnings, `dry-run: would remove ${names.join(", ")} from all scopes`] };
  }

  const hasClaudeCli = spawnSync("command", ["-v", "claude"], { shell: true }).status === 0;
  if (hasClaudeCli) {
    for (const name of names) {
      for (const scope of MCP_SCOPES) {
        spawnSync("claude", ["mcp", "remove", name, "--scope", scope], { stdio: "ignore" });
      }
    }
    warnings.push(`ran 'claude mcp remove' for ${names.join(", ")} across all scopes (best-effort; the CLI does not report whether anything was actually registered)`);
  }

  const claudeJsonPath = path.join(homePath, "..", ".claude.json");
  let changed = false;
  try {
    const raw = fs.readFileSync(claudeJsonPath, "utf8");
    const data = JSON.parse(raw);
    const nameSet = new Set(names);
    const prune = (servers) => {
      if (!servers) return;
      for (const name of nameSet) {
        if (name in servers) {
          delete servers[name];
          changed = true;
        }
      }
    };
    prune(data.mcpServers);
    for (const project of Object.values(data.projects || {})) prune(project.mcpServers);
    if (changed) {
      fs.writeFileSync(claudeJsonPath, `${JSON.stringify(data, null, 2)}\n`);
      paths.push(claudeJsonPath);
    }
  } catch (err) {
    if (err.code !== "ENOENT") warnings.push(`could not prune ${claudeJsonPath}: ${err.message}`);
  }

  return {
    ok: true,
    changed,
    providerId: "claude",
    action: "mcp.remove",
    paths,
    warnings,
  };
}

const stubGroups = stubAdapterGroups("claude", {
  rules: ["render"],
  permissions: ["render"],
  skills: ["link"],
  commands: ["render"],
  hooks: ["read", "write"],
  mcp: ["add"],
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
    mcp: {
      ...stubGroups.mcp,
      remove: mcpRemove,
    },
  },
});

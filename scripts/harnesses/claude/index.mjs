// Claude Code harness provider. Phase 2 wires this into the registry with real discovery and
// placeholder capability adapters; Phases 3-6 replace the placeholders with migrated behavior
// from scripts/cli/{root-config-merge,mcp-claude,telemetry,...}.mjs one capability at a time.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineHarnessProvider } from "../contract.mjs";
import { detectHarnessProvider } from "../discovery.mjs";
import { stubAdapterGroups } from "../stub-adapter.mjs";
import { isHooksMap, mergeHooksMap, unmergeHooksMap } from "../hooks-merge.mjs";
import { mergeClaudeSettings, normalizeRootConfigContent } from "../../cli/root-config-merge.mjs";
import { renderClaudeSettings } from "../permissions-render.mjs";
import { claudeMcpArgs, runClaudeMcpAdd, hasClaudeCli, claudeMcpRemove, claudeMcpList } from "../mcp-claude-cli.mjs";
import { repoRoot } from "../../cli/roots.mjs";

// Mirrors scripts/cli/mcp-config.mjs's MCP_SERVERS_PATH/MCP_SCOPES, duplicated rather than
// imported: mcp-config.mjs pulls in paths.mjs's registry-dependent half (rootConfigActive/
// rootConfigBaseline), which would cycle back through registry.mjs into this module — the same
// paths.mjs/roots.mjs import-cycle issue the Phase 3 grounding notes describe. roots.mjs is the
// registry-independent leaf, safe to import directly.
const MCP_SERVERS_PATH = path.join(repoRoot, "manifests", "inventory", "mcp-servers.json");
const MCP_SCOPES = ["user", "local", "project"];
const PACKAGES_DIR = path.join(repoRoot, "globals", "packages");

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

  if (hasClaudeCli()) {
    for (const name of names) {
      for (const scope of MCP_SCOPES) claudeMcpRemove(name, scope);
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

// Single-server add: shells to `claude mcp add` (the only way to register with Claude's own MCP
// client state — there is no direct config file to write into, unlike Codex's TOML table). Thin
// wrapper over the pure arg-construction/invocation in ../mcp-claude-cli.mjs; unchanged behavior
// from scripts/cli/mcp.mjs's existing mcpAdd, ownership moved behind the contract.
function mcpAddServer(spec, opts = {}) {
  const args = claudeMcpArgs({ scope: opts.scope || "user", transport: opts.transport || null }, spec);
  if (opts.dryRun) return { ok: true, changed: false, providerId: "claude", action: "mcp.addServer", warnings: [`dry-run: claude ${args.join(" ")}`] };
  runClaudeMcpAdd(args);
  return { ok: true, changed: true, providerId: "claude", action: "mcp.addServer", warnings: [] };
}

// Single-server remove: same "remove --scope without an explicit scope only checks one scope"
// gap mcpRemove (bulk) already accounts for -- sweeps every scope via the CLI when available, then
// prunes ~/.claude.json directly so the entry is gone even when the `claude` binary isn't present.
function mcpRemoveServer(name, { homePath, dryRun = false } = {}) {
  if (dryRun) return { ok: true, changed: false, providerId: "claude", action: "mcp.removeServer", warnings: [`dry-run: would remove ${name} from all scopes`] };

  const warnings = [];
  if (hasClaudeCli()) {
    for (const scope of MCP_SCOPES) claudeMcpRemove(name, scope);
    warnings.push(`ran 'claude mcp remove' for ${name} across all scopes (best-effort; the CLI does not report whether anything was actually registered)`);
  }

  const claudeJsonPath = path.join(homePath, "..", ".claude.json");
  let changed = false;
  const paths = [];
  try {
    const data = JSON.parse(fs.readFileSync(claudeJsonPath, "utf8"));
    const prune = (servers) => {
      if (servers && name in servers) { delete servers[name]; changed = true; }
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

  return { ok: true, changed, providerId: "claude", action: "mcp.removeServer", paths, warnings };
}

// Server names Claude currently has registered, via `claude mcp list`. Returns [] (not an error)
// when the CLI is unavailable or the call fails — listing is a best-effort read, not a capability
// gate.
function mcpList() {
  const output = claudeMcpList();
  if (!output) return [];
  return [...output.matchAll(/^([^\s:]+):/gm)].map((match) => match[1]);
}

// Ported from scripts/install/uninstall.sh's strip_package_hooks (characterization test:
// scripts/test/harness-hooks-write-remove-characterization-check.mjs). Strips BOTH package-
// injected hooks AND package-injected permission allow-entries from ~/.claude/settings.json in one
// atomic read/write pass — the bash original conflated the two for a single file write rather than
// two, and this keeps that exact behavior rather than splitting across capability groups (the
// permissions capability has no removal method of its own). "write" here means "removal semantics"
// per the plan's withdraw design, not a generic hook writer.
function hooksWriteRemove({ homePath, dryRun = false } = {}) {
  const settingsPath = path.join(homePath, "settings.json");
  const paths = [];
  const warnings = [];

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") warnings.push(`could not read ${settingsPath}: ${err.message}`);
    return { ok: true, changed: false, providerId: "claude", action: "hooks.write", paths, warnings };
  }

  if (!fs.existsSync(PACKAGES_DIR)) {
    return { ok: true, changed: false, providerId: "claude", action: "hooks.write", paths, warnings };
  }

  const packages = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGES_DIR, entry.name, "package.config.json"))
    .filter((file) => fs.existsSync(file))
    .flatMap((file) => {
      try {
        return [JSON.parse(fs.readFileSync(file, "utf8"))];
      } catch {
        return [];
      }
    });

  let changed = false;

  for (const pkg of packages) {
    const root = path.join(PACKAGES_DIR, pkg.id);
    for (const resource of pkg.resources || []) {
      if (resource.type !== "hooks" || resource.harness !== "claude") continue;
      const hooksFile = path.join(root, resource.source);
      if (!fs.existsSync(hooksFile)) continue;
      let fragment;
      try {
        fragment = JSON.parse(fs.readFileSync(hooksFile, "utf8"));
      } catch {
        continue;
      }
      const hooks = settings.hooks || {};
      for (const [event, entries] of Object.entries(fragment)) {
        const cmds = new Set(entries.map((e) => e.hooks?.[0]?.command).filter(Boolean));
        const existing = hooks[event] || [];
        const next = existing.filter((e) => {
          const cmd = e.hooks?.[0]?.command;
          if (cmd && cmds.has(cmd)) {
            changed = true;
            return false;
          }
          return true;
        });
        if (next.length === 0) delete hooks[event];
        else hooks[event] = next;
      }
      if (Object.keys(hooks).length === 0) delete settings.hooks;
      else settings.hooks = hooks;
    }
  }

  const toRemove = new Set(
    packages.flatMap((pkg) => (pkg.resources || []).filter((c) => c.type === "permissions").flatMap((c) => c.allow || []))
  );
  const existingAllow = settings.permissions?.allow || [];
  const nextAllow = existingAllow.filter((p) => !toRemove.has(p));
  if (nextAllow.length !== existingAllow.length) {
    if (nextAllow.length === 0) delete settings.permissions;
    else settings.permissions = { ...settings.permissions, allow: nextAllow };
    changed = true;
  }

  if (!changed) {
    return { ok: true, changed: false, providerId: "claude", action: "hooks.write", paths, warnings };
  }

  if (dryRun) {
    return { ok: true, changed: false, providerId: "claude", action: "hooks.write", paths, warnings: [...warnings, `dry-run: would remove package hooks/permissions from ${settingsPath}`] };
  }

  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  paths.push(settingsPath);
  return { ok: true, changed: true, providerId: "claude", action: "hooks.write", paths, warnings };
}

// Claude stores hooks nested under settings.json's "hooks" key, alongside permissions etc. Reads
// the file itself (plain fs, no paths.mjs) and returns { changed, content } rather than writing —
// the orchestrator (packages.mjs, which already imports paths.mjs directly with no cycle risk)
// performs the actual write, same pattern as mergePackageComponent/unmergePackageComponent above.
function readSettingsHooks(settingsPath) {
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
  return { settings, hooks: isHooksMap(settings.hooks) ? settings.hooks : {} };
}

function hooksMerge(settingsPath, hooksFragment) {
  const { settings, hooks } = readSettingsHooks(settingsPath);
  const { hooks: nextHooks, added } = mergeHooksMap(hooks, hooksFragment);
  const nextSettings = { ...settings, hooks: nextHooks };
  return { changed: added > 0, content: `${JSON.stringify(nextSettings, null, 2)}\n` };
}

function hooksUnmerge(settingsPath, hooksFragment) {
  const { settings, hooks } = readSettingsHooks(settingsPath);
  const { hooks: nextHooks, removed } = unmergeHooksMap(hooks, hooksFragment);
  const nextSettings = { ...settings };
  if (Object.keys(nextHooks).length > 0) nextSettings.hooks = nextHooks;
  else delete nextSettings.hooks;
  return { changed: removed > 0, content: `${JSON.stringify(nextSettings, null, 2)}\n` };
}

const stubGroups = stubAdapterGroups("claude", {
  rules: ["render"],
  skills: ["link"],
  commands: ["render"],
  hooks: ["read"],
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
      addServer: mcpAddServer,
      removeServer: mcpRemoveServer,
      list: mcpList,
    },
    hooks: {
      ...stubGroups.hooks,
      write: hooksWriteRemove,
      merge: hooksMerge,
      unmerge: hooksUnmerge,
    },
    // 4th param (target path) is Codex-only (used in an error message); Claude's render ignores it.
    permissions: {
      render: (current, manifest, overrides) => renderClaudeSettings(current, manifest, overrides),
    },
  },
});

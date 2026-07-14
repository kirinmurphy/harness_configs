import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { claudeJsonPath, repoRoot, rootConfigActive } from "./paths.mjs";
import { setPackageEnabled, renderHomeRules, readEnabledPackagesRegistry } from "./rules-render.mjs";
import { loadPackageCatalog, unavailablePackageMessage } from "./package-catalog.mjs";
import { packageCommandNames, validatePackageCommandOwnership } from "./package-commands.mjs";
import { buildPackageLiveState } from "./package-probes.mjs";
import { removeCodexMcp } from "./mcp-codex.mjs";
import { writeRootConfig } from "./root-config-writes.mjs";

export const USER_CLAUDE_SETTINGS = rootConfigActive.claude;
export const USER_CODEX_CONFIG = rootConfigActive.codex;


export function findPackage(pkgId) {
  return loadPackageCatalog().find((p) => p.id === pkgId) || null;
}

export function readSettings(settingsPath) {
  try { return JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { return {}; }
}

export function writeSettings(settingsPath, settings) {
  writeRootConfig("claude", settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

function mergePermissions(settingsPath, allow) {
  const settings = readSettings(settingsPath);
  const existing = settings.permissions?.allow || [];
  const toAdd = allow.filter((p) => !existing.includes(p));
  if (toAdd.length === 0) { console.log("ok: permissions already present"); return; }
  settings.permissions = { ...settings.permissions, allow: [...existing, ...toAdd] };
  writeSettings(settingsPath, settings);
  console.log(`wired: ${toAdd.length} permissions → ${settingsPath}`);
}

function mergeHooks(settingsPath, hooksFragment) {
  const settings = readSettings(settingsPath);
  const hooks = settings.hooks || {};
  let added = 0;
  for (const [event, entries] of Object.entries(hooksFragment)) {
    const existing = hooks[event] || [];
    for (const entry of entries) {
      const cmd = entry.hooks?.[0]?.command;
      const alreadyPresent = cmd && existing.some((e) => (e.hooks || []).some((h) => h.command === cmd));
      if (!alreadyPresent) { existing.push(entry); added++; }
    }
    hooks[event] = existing;
  }
  if (added > 0) {
    settings.hooks = hooks;
    writeSettings(settingsPath, settings);
    console.log(`wired: ${added} hook entries → ${settingsPath}`);
  } else {
    console.log(`ok: hooks already present → ${settingsPath}`);
  }
}

function tomlTableKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function codexToolApprovalTable(component, toolName) {
  return `[mcp_servers.${tomlTableKey(component.server)}.tools.${tomlTableKey(toolName)}]`;
}

function mergeCodexToolApprovals(configPath, component) {
  let text = "";
  try { text = fs.readFileSync(configPath, "utf8"); } catch {}
  let changed = false;
  for (const [toolName, approvalMode] of Object.entries(component.approvals || {})) {
    const table = codexToolApprovalTable(component, toolName);
    const tablePattern = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const blockPattern = new RegExp(`(^${tablePattern}\\n)([^[]*)`, "m");
    const nextLine = `approval_mode = ${JSON.stringify(approvalMode)}\n`;
    if (blockPattern.test(text)) {
      text = text.replace(blockPattern, (_match, header, body) => {
        if (/^approval_mode\s*=/m.test(body)) {
          const nextBody = body.replace(/^approval_mode\s*=.*$/m, nextLine.trim());
          if (nextBody !== body) changed = true;
          return `${header}${nextBody}`;
        }
        changed = true;
        return `${header}${nextLine}${body}`;
      });
    } else {
      text = `${text.endsWith("\n") ? text : `${text}\n`}\n${table}\n${nextLine}`;
      changed = true;
    }
  }
  if (changed) {
    writeRootConfig("codex", configPath, text);
    console.log(`wired: Codex tool approvals → ${configPath}`);
  } else {
    console.log(`ok: Codex tool approvals already present → ${configPath}`);
  }
}

function unmergeCodexToolApprovals(configPath, component) {
  let text = "";
  try { text = fs.readFileSync(configPath, "utf8"); } catch {}
  let changed = false;
  for (const toolName of Object.keys(component.approvals || {})) {
    const table = codexToolApprovalTable(component, toolName);
    const tablePattern = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const blockPattern = new RegExp(`\\n?^${tablePattern}\\n[^[]*(?=^\\[|$)`, "m");
    if (blockPattern.test(text)) {
      text = text.replace(blockPattern, (match) => {
        changed = true;
        return match.startsWith("\n") ? "\n" : "";
      });
    }
  }
  if (changed) {
    writeRootConfig("codex", configPath, text.replace(/\n{3,}/g, "\n\n"));
    console.log(`removed: Codex tool approvals ← ${configPath}`);
  } else {
    console.log(`ok: Codex tool approvals already absent ← ${configPath}`);
  }
}


function mcpAlreadyPresent(serverName) {
  const result = spawnSync("claude", ["mcp", "list"], { encoding: "utf8" });
  return !result.error && result.status === 0 && result.stdout.includes(`${serverName}:`);
}

function installMcpPreset(presetId) {
  // `roborepo mcp add` writes repo source (globals/claude/settings.json + manifests mcp-servers.json)
  // and shells out to the real `claude` CLI. Tests set ROBOREPO_SKIP_MCP=1 to exercise the rest of
  // the enable/disable flow without that registration (and without polluting tracked files).
  if (process.env.ROBOREPO_SKIP_MCP === "1") { console.log(`skip: mcp ${presetId} (ROBOREPO_SKIP_MCP)`); return; }
  if (mcpAlreadyPresent(presetId)) { console.log(`ok: mcp ${presetId} already present`); return; }
  // Delegate to `roborepo mcp add` subprocess: handles Claude CLI, Codex config, and preset
  // resolution. mcpAdd calls process.exit(0) directly, so we can't call it inline.
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "cli", "main.mjs"), "mcp", "add", presetId],
    { encoding: "utf8", stdio: "inherit" }
  );
  if (result.status !== 0 && result.status !== null) {
    throw new Error(`mcp add failed for preset: ${presetId}`);
  }
}

export async function enablePackage(rest, _seen = new Set()) {
  const [pkgId, ...flags] = rest;
  if (!pkgId) {
    console.error("usage: roborepo enable <package-id>");
    const catalog = loadPackageCatalog();
    console.error(`available: ${catalog.map((p) => p.id).join(", ")}`);
    process.exit(2);
  }

  const dryRun = flags.includes("--dry-run");
  const reconcile = flags.includes("--reconcile");
  const catalog = loadPackageCatalog({ includeUnavailable: reconcile });
  const pkg = catalog.find((p) => p.id === pkgId);
  if (!pkg) {
    console.error(unavailablePackageMessage(pkgId));
    console.error(`available: ${catalog.map((p) => p.id).join(", ")}`);
    process.exit(2);
  }

  if (_seen.has(pkg.id)) return; // already handled in this enable pass (cycle / shared dependency)
  _seen.add(pkg.id);

  const enabledIds = readEnabledPackagesRegistry().packages || [];
  const ownership = validatePackageCommandOwnership(pkg, { catalog, enabledIds });
  if (!ownership.ok) {
    console.error(ownership.message);
    process.exit(2);
  }

  // A package can compose others via `requires`: enable its dependencies first (deduped, cycle-safe).
  // A composite package (one with `requires`) bundles the component-packages it depends on. NOTE:
  // distinct from an install "bundle" (manifests/platform/presets.json), which groups file-copy rows
  // at install time — composition here is runtime feature enablement.
  for (const depId of pkg.requires ?? []) {
    if (!catalog.find((p) => p.id === depId)) {
      console.warn(`  warn: ${pkg.id} requires unknown package: ${depId}`);
      continue;
    }
    await enablePackage([depId, ...flags], _seen);
  }

  if (dryRun) { console.log(`[dry-run] would enable: ${pkg.label}`); }
  else { console.log(reconcile ? `reconcile: ${pkg.label}` : `enabling: ${pkg.label}`); }

  if (dryRun) {
    console.log(`  [dry-run] mark package enabled in registry`);
  } else if (!reconcile) {
    setPackageEnabled(pkg.id, true);
  }

  const servicePromises = [];
  for (const component of pkg.components) {
    switch (component.type) {
      case "mcp":
        if (dryRun) { console.log(`  [dry-run] mcp add ${component.preset}`); break; }
        installMcpPreset(component.preset);
        break;
      case "permissions":
        if (dryRun) { console.log(`  [dry-run] merge ${component.allow.length} permissions`); break; }
        mergePermissions(USER_CLAUDE_SETTINGS, component.allow);
        break;
      case "codex_tool_approvals":
        if (dryRun) { console.log(`  [dry-run] merge Codex tool approvals for ${component.server}`); break; }
        mergeCodexToolApprovals(USER_CODEX_CONFIG, component);
        break;
      case "rules": {
        if (dryRun) { console.log(`  [dry-run] register rules from ${component.source} (${component.harness})`); break; }
        renderHomeRules({ harness: component.harness === "both" ? undefined : component.harness });
        break;
      }
      case "command":
        if (dryRun) { console.log(`  [dry-run] register command ${component.name}`); }
        break;
      case "hooks": {
        const hooksPath = path.join(repoRoot, component.source);
        if (dryRun) { console.log(`  [dry-run] merge hooks from ${component.source}`); break; }
        const hooksFragment = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
        const settingsPath = component.harness === "claude" ? USER_CLAUDE_SETTINGS : null;
        if (settingsPath) mergeHooks(settingsPath, hooksFragment);
        break;
      }
      case "plugin":
        if (dryRun) { console.log(`  [dry-run] enable plugin ${component.id}`); break; }
        enablePlugin(USER_CLAUDE_SETTINGS, component);
        break;
      case "service":
        if (dryRun) { console.log(`  [dry-run] enable service ${component.id}`); break; }
        servicePromises.push(setService(component.id, true));
        break;
      case "skill":
        if (dryRun) { console.log(`  [dry-run] install skill ${component.id}`); break; }
        servicePromises.push(setSkillComponent(component.id, true));
        break;
      default:
        console.log(`  skip: unknown component type: ${component.type}`);
    }
  }
  // Service/skill components run async handlers (lazy-imported to avoid import cycles); await them so
  // the function doesn't resolve before the side effects land.
  if (servicePromises.length) await Promise.all(servicePromises);

  if (!dryRun && !reconcile) {
    const commandNames = packageCommandNames(pkg);
    if (commandNames.length) {
      console.log(`\ncli commands available: ${commandNames.map((c) => `roborepo ${c}`).join(", ")}`);
    }
  }
}

export async function reconcileEnabledPackages(rest = []) {
  const dryRun = rest.includes("--dry-run");
  const enabledIds = readEnabledPackagesRegistry().packages || [];
  if (enabledIds.length === 0) {
    console.log("reconcile: no enabled packages");
    return;
  }
  const catalog = loadPackageCatalog({ includeUnavailable: true });
  const known = new Set(catalog.map((pkg) => pkg.id));
  for (const id of enabledIds) {
    if (!known.has(id)) {
      console.warn(`  warn: enabled package not in catalog: ${id}`);
      continue;
    }
    await enablePackage([id, "--reconcile", ...(dryRun ? ["--dry-run"] : [])]);
  }
}

export function adoptLivePackages({ dryRun = false } = {}) {
  const catalog = loadPackageCatalog({ includeUnavailable: true });
  const liveState = buildPackageLiveState(catalog);
  const registry = readEnabledPackagesRegistry();
  const alreadyEnabled = new Set(registry.packages || []);
  const adopters = [];

  for (const pkg of catalog) {
    if (alreadyEnabled.has(pkg.id)) continue;
    const state = liveState.get(pkg.id);
    const adoptable = (state?.components || []).some((component) =>
      component.state === "external" &&
      !["mcp", "command", "requires"].includes(component.type)
    );
    if (adoptable) adopters.push(pkg.id);
  }

  if (adopters.length === 0) {
    console.log("adopt-live: no live packages to adopt");
    return [];
  }

  if (dryRun) {
    console.log(`adopt-live: would mark enabled packages: ${adopters.join(", ")}`);
    return adopters;
  }

  for (const id of adopters) setPackageEnabled(id, true);
  console.log(`adopt-live: marked enabled packages: ${adopters.join(", ")}`);
  return adopters;
}

// --------------------------------------------------------------------------- disable (reversal)

function unmergePermissions(settingsPath, allow) {
  const settings = readSettings(settingsPath);
  const existing = settings.permissions?.allow || [];
  const toRemove = new Set(allow);
  const next = existing.filter((p) => !toRemove.has(p));
  if (next.length === existing.length) { console.log("ok: permissions already absent"); return; }
  settings.permissions = { ...settings.permissions, allow: next };
  writeSettings(settingsPath, settings);
  console.log(`removed: ${existing.length - next.length} permissions ← ${settingsPath}`);
}

function unmergeHooks(settingsPath, hooksFragment) {
  const settings = readSettings(settingsPath);
  const hooks = settings.hooks || {};
  let removed = 0;
  for (const [event, entries] of Object.entries(hooksFragment)) {
    const cmds = new Set(entries.map((e) => e.hooks?.[0]?.command).filter(Boolean));
    const existing = hooks[event] || [];
    const next = existing.filter((e) => {
      const cmd = e.hooks?.[0]?.command;
      if (cmd && cmds.has(cmd)) { removed++; return false; }
      return true;
    });
    if (next.length) hooks[event] = next;
    else delete hooks[event];
  }
  if (removed > 0) {
    settings.hooks = hooks;
    writeSettings(settingsPath, settings);
    console.log(`removed: ${removed} hook entries ← ${settingsPath}`);
  } else {
    console.log(`ok: hooks already absent ← ${settingsPath}`);
  }
}


function pruneClaudeMcpStore(serverName) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(claudeJsonPath, "utf8"));
  } catch {
    return;
  }

  let changed = false;
  const prune = (mcpServers) => {
    if (mcpServers && Object.hasOwn(mcpServers, serverName)) {
      delete mcpServers[serverName];
      changed = true;
    }
  };
  prune(data.mcpServers);
  for (const project of Object.values(data.projects || {})) prune(project.mcpServers);
  if (!changed) return;
  fs.writeFileSync(claudeJsonPath, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`  pruned: Claude MCP store ${serverName}`);
}

function removeMcpPreset(presetId, dryRun) {
  if (dryRun) { console.log(`  [dry-run] mcp remove ${presetId}`); return; }
  if (spawnSync("claude", ["--version"], { encoding: "utf8" }).status === 0) {
    for (const scope of ["user", "local", "project"]) {
      spawnSync("claude", ["mcp", "remove", presetId, "--scope", scope], { encoding: "utf8" });
    }
    console.log(`  removed: mcp ${presetId} from Claude scopes`);
  } else {
    console.log(`  ok: claude CLI unavailable for mcp ${presetId}`);
  }
  pruneClaudeMcpStore(presetId);
  removeCodexMcp(presetId);
}

export async function disablePackage(rest) {
  const [pkgId, ...flags] = rest;
  if (!pkgId) {
    console.error("usage: roborepo disable <package-id>");
    console.error(`available: ${loadPackageCatalog().map((p) => p.id).join(", ")}`);
    process.exit(2);
  }
  const pkg = findPackage(pkgId);
  if (!pkg) {
    console.error(unavailablePackageMessage(pkgId));
    console.error(`available: ${loadPackageCatalog().map((p) => p.id).join(", ")}`);
    process.exit(2);
  }

  const dryRun = flags.includes("--dry-run");
  console.log(dryRun ? `[dry-run] would disable: ${pkg.label}` : `disabling: ${pkg.label}`);
  if (dryRun) {
    console.log(`  [dry-run] mark package disabled in registry`);
  } else {
    setPackageEnabled(pkg.id, false);
  }

  const servicePromises = [];
  for (const component of pkg.components) {
    switch (component.type) {
      case "mcp":
        removeMcpPreset(component.preset, dryRun);
        break;
      case "permissions":
        if (dryRun) { console.log(`  [dry-run] remove ${component.allow.length} permissions`); break; }
        unmergePermissions(USER_CLAUDE_SETTINGS, component.allow);
        break;
      case "codex_tool_approvals":
        if (dryRun) { console.log(`  [dry-run] remove Codex tool approvals for ${component.server}`); break; }
        unmergeCodexToolApprovals(USER_CODEX_CONFIG, component);
        break;
      case "rules": {
        if (dryRun) { console.log(`  [dry-run] deregister rules from ${component.source} (${component.harness})`); break; }
        renderHomeRules({ harness: component.harness === "both" ? undefined : component.harness });
        break;
      }
      case "command":
        if (dryRun) { console.log(`  [dry-run] deregister command ${component.name}`); }
        break;
      case "hooks": {
        if (dryRun) { console.log(`  [dry-run] remove hooks from ${component.source}`); break; }
        const hooksFragment = JSON.parse(fs.readFileSync(path.join(repoRoot, component.source), "utf8"));
        if (component.harness === "claude") unmergeHooks(USER_CLAUDE_SETTINGS, hooksFragment);
        break;
      }
      case "plugin":
        if (dryRun) { console.log(`  [dry-run] disable plugin ${component.id}`); break; }
        disablePlugin(USER_CLAUDE_SETTINGS, component);
        break;
      case "service":
        if (dryRun) { console.log(`  [dry-run] disable service ${component.id}`); break; }
        servicePromises.push(setService(component.id, false));
        break;
      case "skill":
        if (dryRun) { console.log(`  [dry-run] remove skill ${component.id}`); break; }
        servicePromises.push(setSkillComponent(component.id, false));
        break;
      default:
        console.log(`  skip: unknown component type: ${component.type}`);
    }
  }
  if (servicePromises.length) await Promise.all(servicePromises);
}

// --------------------------------------------------------------------------- service component
//
// A service component delegates to a registered async handler that owns the feature's bespoke
// install (state file, hooks, server, …) — telemetry is the first. Handlers are lazy-imported so
// packages.mjs has no static dependency on (and no import cycle with) the feature modules. Adding a
// new service = register its { id → loader } here; the package model itself stays generic.
const SERVICE_HANDLERS = {
  telemetry: async () => (await import("./telemetry.mjs")).setTelemetryEnabled,
};

async function setService(id, enabled) {
  const loader = SERVICE_HANDLERS[id];
  if (!loader) { console.log(`  skip: unknown service: ${id}`); return; }
  const handler = await loader();
  const result = handler(enabled);
  if (result?.message) console.log(`  ${result.message}`);
  return result;
}

// Skill component: link/unlink a shared skill into the harness skill dirs. setSkillInstalled lives
// in config-mutate.mjs (which imports this module), so it's lazy-imported to avoid the cycle.
async function setSkillComponent(id, enabled) {
  const { setSkillInstalled } = await import("./config-mutate.mjs");
  const result = setSkillInstalled(id, enabled);
  if (result?.message) console.log(`  ${result.message}`);
  return result;
}

// --------------------------------------------------------------------------- plugin component
//
// A plugin component owns two settings keys: extraKnownMarketplaces[<marketplace.name>] (so the
// harness knows where to fetch it) and enabledPlugins[<id>] (the on/off bool). enable writes both;
// the harness performs the actual download on its next launch — we can't fetch it from here, so a
// freshly enabled plugin shows as enabled but only takes effect once the harness installs it.
// disable flips the bool to false and removes our marketplace entry, leaving any already-downloaded
// plugin files for the harness to clean up.

function enablePlugin(settingsPath, component) {
  const settings = readSettings(settingsPath);
  let changed = false;

  if (component.marketplace?.name) {
    settings.extraKnownMarketplaces ||= {};
    if (!settings.extraKnownMarketplaces[component.marketplace.name]) {
      settings.extraKnownMarketplaces[component.marketplace.name] = { source: component.marketplace.source };
      changed = true;
    }
  }

  settings.enabledPlugins ||= {};
  if (settings.enabledPlugins[component.id] !== true) {
    settings.enabledPlugins[component.id] = true;
    changed = true;
  }

  if (changed) {
    writeSettings(settingsPath, settings);
    console.log(`  plugin enabled: ${component.id} → ${settingsPath}`);
    console.log(`  note: the harness installs the plugin from the marketplace on its next launch`);
  } else {
    console.log(`  ok: plugin ${component.id} already enabled`);
  }
}

function disablePlugin(settingsPath, component) {
  const settings = readSettings(settingsPath);
  let changed = false;

  if (settings.enabledPlugins && component.id in settings.enabledPlugins) {
    delete settings.enabledPlugins[component.id];
    changed = true;
  }
  if (component.marketplace?.name && settings.extraKnownMarketplaces?.[component.marketplace.name]) {
    delete settings.extraKnownMarketplaces[component.marketplace.name];
    changed = true;
  }

  if (changed) {
    writeSettings(settingsPath, settings);
    console.log(`  plugin disabled: ${component.id} ← ${settingsPath}`);
  } else {
    console.log(`  ok: plugin ${component.id} already absent`);
  }
}

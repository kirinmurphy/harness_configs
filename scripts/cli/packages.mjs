import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./paths.mjs";

export const PACKAGES_PATH = path.join(repoRoot, "manifests", "inventory", "packages.json");
export const USER_CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
export const USER_CLAUDE_MD = path.join(os.homedir(), ".claude", "CLAUDE.md");

export function loadPackageCatalog() {
  return JSON.parse(fs.readFileSync(PACKAGES_PATH, "utf8")).packages;
}

export function findPackage(pkgId) {
  return loadPackageCatalog().find((p) => p.id === pkgId) || null;
}

export function readSettings(settingsPath) {
  try { return JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { return {}; }
}

export function writeSettings(settingsPath, settings) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
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

function mergeRules(claudeMdPath, rulesContent) {
  const existing = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, "utf8") : "";
  // Idempotency: check for a unique first line of the rules block
  const firstLine = rulesContent.split("\n").find((l) => l.trim());
  if (firstLine && existing.includes(firstLine)) {
    console.log(`ok: rules already present → ${claudeMdPath}`);
    return;
  }
  const separator = existing.length > 0 && !existing.endsWith("\n\n") ? "\n\n" : "";
  fs.mkdirSync(path.dirname(claudeMdPath), { recursive: true });
  fs.writeFileSync(claudeMdPath, existing + separator + rulesContent.trimEnd() + "\n");
  console.log(`wired: rules → ${claudeMdPath}`);
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

export function enablePackage(rest) {
  const [pkgId, ...flags] = rest;
  if (!pkgId) {
    console.error("usage: roborepo enable <package-id>");
    const catalog = loadPackageCatalog();
    console.error(`available: ${catalog.map((p) => p.id).join(", ")}`);
    process.exit(2);
  }

  const catalog = loadPackageCatalog();
  const pkg = catalog.find((p) => p.id === pkgId);
  if (!pkg) {
    console.error(`unknown package: ${pkgId}`);
    console.error(`available: ${catalog.map((p) => p.id).join(", ")}`);
    process.exit(2);
  }

  const dryRun = flags.includes("--dry-run");
  if (dryRun) { console.log(`[dry-run] would enable: ${pkg.label}`); }
  else { console.log(`enabling: ${pkg.label}`); }

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
      case "rules": {
        const rulesPath = path.join(repoRoot, component.source);
        if (dryRun) { console.log(`  [dry-run] merge rules from ${component.source}`); break; }
        const rulesContent = fs.readFileSync(rulesPath, "utf8");
        const claudeMdPath = component.harness === "claude" ? USER_CLAUDE_MD : null;
        if (claudeMdPath) mergeRules(claudeMdPath, rulesContent);
        break;
      }
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
      default:
        console.log(`  skip: unknown component type: ${component.type}`);
    }
  }

  if (!dryRun && pkg.cliCommands?.length) {
    console.log(`\ncli commands available: ${pkg.cliCommands.map((c) => `roborepo ${c}`).join(", ")}`);
  }
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

function unmergeRules(claudeMdPath, rulesContent) {
  if (!fs.existsSync(claudeMdPath)) { console.log(`ok: rules already absent → ${claudeMdPath}`); return; }
  const existing = fs.readFileSync(claudeMdPath, "utf8");
  const block = rulesContent.trimEnd();
  const idx = existing.indexOf(block);
  if (idx === -1) {
    // Fall back to the first-line anchor enablePackage uses, in case trailing whitespace drifted.
    const firstLine = block.split("\n").find((l) => l.trim());
    if (!firstLine || !existing.includes(firstLine)) { console.log(`ok: rules already absent → ${claudeMdPath}`); return; }
    console.log(`warn: rules block in ${claudeMdPath} drifted from source; leaving in place for manual review`);
    return;
  }
  // Remove the block plus a single leading/trailing blank-line separator so we don't leave a gap.
  let start = idx;
  let end = idx + block.length;
  if (existing.slice(0, start).endsWith("\n\n")) start -= 1;
  if (existing.slice(end).startsWith("\n")) end += 1;
  const next = (existing.slice(0, start) + existing.slice(end)).replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(claudeMdPath, next.endsWith("\n") ? next : next + "\n");
  console.log(`removed: rules ← ${claudeMdPath}`);
}

function removeMcpPreset(presetId, dryRun) {
  if (dryRun) { console.log(`  [dry-run] mcp remove ${presetId}`); return; }
  const result = spawnSync("claude", ["mcp", "remove", presetId], { encoding: "utf8" });
  if (result.error || (result.status !== 0 && result.status !== null)) {
    console.log(`  ok: mcp ${presetId} not registered (or claude CLI unavailable)`);
    return;
  }
  console.log(`  removed: mcp ${presetId}`);
}

export function disablePackage(rest) {
  const [pkgId, ...flags] = rest;
  if (!pkgId) {
    console.error("usage: roborepo disable <package-id>");
    console.error(`available: ${loadPackageCatalog().map((p) => p.id).join(", ")}`);
    process.exit(2);
  }
  const pkg = findPackage(pkgId);
  if (!pkg) {
    console.error(`unknown package: ${pkgId}`);
    console.error(`available: ${loadPackageCatalog().map((p) => p.id).join(", ")}`);
    process.exit(2);
  }

  const dryRun = flags.includes("--dry-run");
  console.log(dryRun ? `[dry-run] would disable: ${pkg.label}` : `disabling: ${pkg.label}`);

  for (const component of pkg.components) {
    switch (component.type) {
      case "mcp":
        removeMcpPreset(component.preset, dryRun);
        break;
      case "permissions":
        if (dryRun) { console.log(`  [dry-run] remove ${component.allow.length} permissions`); break; }
        unmergePermissions(USER_CLAUDE_SETTINGS, component.allow);
        break;
      case "rules": {
        if (dryRun) { console.log(`  [dry-run] remove rules from ${component.source}`); break; }
        const rulesContent = fs.readFileSync(path.join(repoRoot, component.source), "utf8");
        if (component.harness === "claude") unmergeRules(USER_CLAUDE_MD, rulesContent);
        break;
      }
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
      default:
        console.log(`  skip: unknown component type: ${component.type}`);
    }
  }
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

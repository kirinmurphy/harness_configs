import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./paths.mjs";

const PACKAGES_PATH = path.join(repoRoot, "manifests", "inventory", "packages.json");
const USER_CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const USER_CLAUDE_MD = path.join(os.homedir(), ".claude", "CLAUDE.md");

function loadPackageCatalog() {
  return JSON.parse(fs.readFileSync(PACKAGES_PATH, "utf8")).packages;
}

function readSettings(settingsPath) {
  try { return JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { return {}; }
}

function writeSettings(settingsPath, settings) {
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
      default:
        console.log(`  skip: unknown component type: ${component.type}`);
    }
  }

  if (!dryRun && pkg.cliCommands?.length) {
    console.log(`\ncli commands available: ${pkg.cliCommands.map((c) => `roborepo ${c}`).join(", ")}`);
  }
}

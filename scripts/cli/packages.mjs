import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { claudeJsonPath, repoRoot, rootConfigActive, harnessHome, workspacePackagesDir, packageMode, initializeWorkspace } from "./paths.mjs";
import { setPackageEnabled, renderHomeRules, effectiveEnabledIds } from "./rules-render.mjs";
import { loadPackageCatalog, unavailablePackageMessage, validatePackageCatalog, BUILT_IN_PACKAGES_DIR } from "./package-catalog.mjs";
import { packageCommandNames, validatePackageCommandOwnership } from "./package-commands.mjs";
import { buildPackageLiveState } from "./package-probes.mjs";
import { removeCodexMcp } from "./mcp-codex.mjs";
import { writeRootConfig } from "./root-config-writes.mjs";
import { hookFilePath, mergeHooksInto, unmergeHooksFrom, installHookScripts, removeHookScripts } from "./hook-composition.mjs";
import { installPackageCommands, removePackageCommands } from "./slash-commands.mjs";
import { SLASH_COMMAND_HARNESS_NAMES } from "./skill-command-config.mjs";

export const USER_CLAUDE_SETTINGS = rootConfigActive.claude;
export const USER_CODEX_CONFIG = rootConfigActive.codex;


export function findPackage(pkgId) {
  return loadPackageCatalog().find((p) => p.id === pkgId) || null;
}

export function packageCommand(args = []) {
  const [sub, ...rest] = args;
  switch (sub) {
    case "list":
      return listPackages(rest);
    case "inspect":
      return inspectPackage(rest);
    case "create":
      return createPackage(rest);
    case "enable":
      return enablePackage(rest);
    case "disable":
      return disablePackage(rest);
    case "validate":
      return validatePackages(rest);
    case "reconcile":
      return reconcileEnabledPackages(rest);
    case "adopt-live":
      return adoptLivePackages({ dryRun: rest.includes("--dry-run") });
    default:
      console.error("usage: roborepo package list|inspect|create|enable|disable|validate|reconcile|adopt-live");
      process.exit(2);
  }
}

function createPackage(rest) {
  const opts = parseCreateArgs(rest);
  // Mirrors skill-new.mjs: package mode scaffolds into the portable workspace; a development
  // checkout scaffolds directly into the real shared source (globals/packages/), matching where
  // `roborepo package validate`/the built-in catalog actually reads from.
  const packagesDir = packageMode ? workspacePackagesDir : BUILT_IN_PACKAGES_DIR;
  if (packageMode) initializeWorkspace();
  const packageDir = path.join(packagesDir, opts.id);
  const configPath = path.join(packageDir, "package.config.json");
  if (fs.existsSync(configPath)) throw new Error(`package already exists: ${opts.id}`);
  const config = packageTemplate(opts);
  fs.mkdirSync(packageDir, { recursive: true });
  for (const resource of config.resources) {
    if (resource.type === "skill") {
      const skillDir = path.join(packageDir, resource.source);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillBody(resource.id, config.description));
    } else if (resource.type === "slash-command") {
      const commandPath = path.join(packageDir, resource.source);
      fs.mkdirSync(path.dirname(commandPath), { recursive: true });
      fs.writeFileSync(commandPath, commandBody(resource.name, config.description));
    }
  }
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`created package: ${configPath}`);
  console.log(`next: roborepo package validate ${opts.id}`);
}

function parseCreateArgs(rest) {
  const flags = new Map();
  const positional = [];
  for (const arg of rest) {
    if (arg.startsWith("--") && arg.includes("=")) {
      const [key, value] = arg.slice(2).split(/=(.*)/s);
      flags.set(key, value);
    } else if (arg.startsWith("--")) {
      flags.set(arg.slice(2), "true");
    } else {
      positional.push(arg);
    }
  }
  const id = positional[0] || flags.get("id") || flags.get("name");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(id || ""))) {
    console.error("usage: roborepo package create <id> [--kind=empty|auto-skill|skill-command|standalone-command] [--description=<text>] [--default-enabled=true]");
    process.exit(2);
  }
  return {
    id,
    kind: flags.get("kind") || "empty",
    description: flags.get("description") || `Custom package ${id}`,
    command: flags.get("command") || id,
    defaultEnabled: flags.get("default-enabled") === "true",
  };
}

function packageTemplate(opts) {
  const base = {
    schemaVersion: 1,
    id: opts.id,
    label: titleize(opts.id),
    description: opts.description,
    lifecycle: "optional",
    presentation: { category: opts.kind.includes("command") ? "commands" : "code-conventions", order: 100 },
    resources: [],
  };
  if (opts.defaultEnabled) base.defaultEnabled = true;
  if (opts.kind === "auto-skill") {
    base.resources.push({ type: "skill", id: opts.id, source: `skills/${opts.id}`, invocation: "auto", risk: "low" });
  } else if (opts.kind === "skill-command") {
    base.resources.push({
      type: "skill",
      id: opts.id,
      source: `skills/${opts.id}`,
      invocation: "manual",
      risk: "medium",
      entrypoints: [
        { type: "slash-command", name: opts.command, description: opts.description, harnesses: ["claude", "codex"] },
      ],
    });
  } else if (opts.kind === "standalone-command") {
    base.resources.push({
      type: "slash-command",
      id: opts.command,
      name: opts.command,
      source: `commands/${opts.command}.md`,
      description: opts.description,
      harnesses: ["claude", "codex"],
    });
  } else if (opts.kind !== "empty") {
    throw new Error(`unknown package template: ${opts.kind}`);
  }
  return base;
}

function titleize(id) {
  return id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function skillBody(id, description) {
  return `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${titleize(id)}\n\n${description}\n`;
}

function commandBody(name, description) {
  return `---\ndescription: ${description}\n---\n\n# /${name}\n\n${description}\n`;
}

function listPackages() {
  const catalog = loadPackageCatalog({ includeUnavailable: true });
  for (const pkg of catalog) {
    const state = buildPackageLiveState(catalog).get(pkg.id);
    console.log(`${pkg.id}\t${state?.status || "disabled"}\t${pkg.presentation.category}\t${pkg.label}`);
  }
}

function inspectPackage(rest) {
  const [pkgId] = rest;
  if (!pkgId) {
    console.error("usage: roborepo package inspect <package-id>");
    process.exit(2);
  }
  const pkg = loadPackageCatalog({ includeUnavailable: true }).find((entry) => entry.id === pkgId);
  if (!pkg) {
    console.error(unavailablePackageMessage(pkgId));
    process.exit(2);
  }
  console.log(JSON.stringify({
    id: pkg.id,
    label: pkg.label,
    description: pkg.description,
    lifecycle: pkg.lifecycle,
    status: pkg.status || "available",
    presentation: pkg.presentation,
    requires: pkg.requires || [],
    resources: pkg.resources || [],
    sourceRoot: pkg.sourceRoot,
  }, null, 2));
}

function validatePackages(rest) {
  const catalog = loadPackageCatalog({ includeUnavailable: true });
  const [pkgId] = rest.filter((arg) => !arg.startsWith("--"));
  if (pkgId && !catalog.some((pkg) => pkg.id === pkgId)) {
    console.error(`unknown package: ${pkgId}`);
    process.exit(2);
  }
  validatePackageCatalog(catalog);
  console.log(pkgId ? `ok: package ${pkgId} valid` : `ok: ${catalog.length} package(s) valid`);
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
  // Wires a built-in package's own MCP preset. `mcp add` shells out to the real `claude` CLI and
  // writes the active Codex config; `--builtin` skips the workspace record because this preset
  // already lives in the app's manifests/inventory/mcp-servers.json (recording it would duplicate a
  // built-in into user workspace content and trip assertMcpRecordAllowed in package mode). Tests set
  // ROBOREPO_SKIP_MCP=1 to exercise the rest of enable/disable without the live registration.
  if (process.env.ROBOREPO_SKIP_MCP === "1") { console.log(`skip: mcp ${presetId} (ROBOREPO_SKIP_MCP)`); return; }
  if (mcpAlreadyPresent(presetId)) { console.log(`ok: mcp ${presetId} already present`); return; }
  // Delegate to `roborepo mcp add` subprocess: handles Claude CLI, Codex config, and preset
  // resolution. mcpAdd calls process.exit(0) directly, so we can't call it inline.
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "cli", "main.mjs"), "mcp", "add", "--builtin", presetId],
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

  const enabledIds = effectiveEnabledIds(catalog);
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
        if (dryRun) {
          console.log(`  [dry-run] merge hooks from ${component.source} (${component.harness})`);
          if (component.scripts?.length) installHookScripts(component.harness, component.scripts, repoRoot, { dryRun: true });
          break;
        }
        const hooksFragment = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
        const targetPath = hookFilePath(component.harness, { claudeSettingsPath: USER_CLAUDE_SETTINGS });
        if (targetPath) mergeHooksInto(component.harness, targetPath, hooksFragment);
        if (component.scripts?.length) installHookScripts(component.harness, component.scripts, repoRoot);
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
        if (dryRun) {
          console.log(`  [dry-run] install skill ${component.id}`);
          for (const harnessName of SLASH_COMMAND_HARNESS_NAMES) {
            installPackageCommands(pkg, harnessHome[harnessName], harnessName, { dryRun: true });
          }
          break;
        }
        servicePromises.push(setSkillComponent(component.id, true));
        for (const harnessName of SLASH_COMMAND_HARNESS_NAMES) {
          installPackageCommands(pkg, harnessHome[harnessName], harnessName);
        }
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
  const catalog = loadPackageCatalog({ includeUnavailable: true });
  const enabledIds = effectiveEnabledIds(catalog);
  if (enabledIds.length === 0) {
    console.log("reconcile: no enabled packages");
    return;
  }
  const known = new Set(catalog.map((pkg) => pkg.id));
  const stale = [];
  for (const id of enabledIds) {
    if (!known.has(id)) {
      stale.push(id);
      console.warn(`${dryRun ? "  [dry-run] would remove" : "  remove"} stale enabled package not in catalog: ${id}`);
      continue;
    }
    await enablePackage([id, "--reconcile", ...(dryRun ? ["--dry-run"] : [])]);
  }
  if (!dryRun) {
    for (const id of stale) setPackageEnabled(id, false);
  }
}

export function adoptLivePackages({ dryRun = false } = {}) {
  const catalog = loadPackageCatalog({ includeUnavailable: true });
  const liveState = buildPackageLiveState(catalog);
  // Effective, not raw registry: a default-enabled package is already known-desired and should
  // never be offered for adoption even if its live state happens to look external.
  const alreadyEnabled = new Set(effectiveEnabledIds(catalog));
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
  const cascade = flags.includes("--cascade");
  const catalog = loadPackageCatalog({ includeUnavailable: true });
  const dependents = enabledDependents(pkg.id, catalog);
  if (dependents.length > 0 && !cascade) {
    console.error(`cannot disable ${pkg.id}; enabled packages depend on it: ${dependents.join(", ")}`);
    console.error(`rerun with --cascade to disable dependents first`);
    process.exit(2);
  }
  if (cascade) {
    for (const dependent of [...dependents].reverse()) {
      await disablePackage([dependent, ...flags.filter((flag) => flag !== "--cascade"), "--cascade"]);
    }
  }
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
        if (dryRun) {
          console.log(`  [dry-run] remove hooks from ${component.source} (${component.harness})`);
          if (component.scripts?.length) removeHookScripts(component.harness, component.scripts, repoRoot, { dryRun: true });
          break;
        }
        const hooksFragment = JSON.parse(fs.readFileSync(path.join(repoRoot, component.source), "utf8"));
        const targetPath = hookFilePath(component.harness, { claudeSettingsPath: USER_CLAUDE_SETTINGS });
        if (targetPath) unmergeHooksFrom(component.harness, targetPath, hooksFragment);
        if (component.scripts?.length) removeHookScripts(component.harness, component.scripts, repoRoot);
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
        if (dryRun) {
          console.log(`  [dry-run] remove skill ${component.id}`);
          for (const harnessName of SLASH_COMMAND_HARNESS_NAMES) {
            removePackageCommands(pkg, harnessHome[harnessName], harnessName, { dryRun: true });
          }
          break;
        }
        servicePromises.push(setSkillComponent(component.id, false));
        for (const harnessName of SLASH_COMMAND_HARNESS_NAMES) {
          removePackageCommands(pkg, harnessHome[harnessName], harnessName);
        }
        break;
      default:
        console.log(`  skip: unknown component type: ${component.type}`);
    }
  }
  if (servicePromises.length) await Promise.all(servicePromises);
}

function enabledDependents(pkgId, catalog) {
  const enabled = new Set(effectiveEnabledIds(catalog));
  const direct = catalog
    .filter((pkg) => enabled.has(pkg.id) && (pkg.requires || []).includes(pkgId))
    .map((pkg) => pkg.id);
  const out = new Set(direct);
  for (const id of direct) {
    for (const nested of enabledDependents(id, catalog)) out.add(nested);
  }
  return [...out];
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

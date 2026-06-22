import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { repoRoot } from "./paths.mjs";
import { installStatePath, presetsStatePath, telemetryDir, activeProfilePath } from "./state-paths.mjs";
import { readProjectProfile } from "./config-mutate.mjs";

const PACKAGES_PATH = path.join(repoRoot, "manifests", "inventory", "packages.json");
const PRESETS_PATH = path.join(repoRoot, "manifests", "platform", "presets.json");
const SKILL_INVOCATION_PATH = path.join(repoRoot, "manifests", "inventory", "skill-invocation.json");
const SLASH_COMMANDS_PATH = path.join(repoRoot, "manifests", "inventory", "slash-commands.json");
const AGENT_PERMISSIONS_PATH = path.join(repoRoot, "manifests", "inventory", "agent-permissions.json");
const CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

// A composite package (one with `requires`) is enabled iff its own components are enabled AND every
// required package is enabled. Cycle-safe via `seen`. `byId` is the catalog map for dependency lookup.
function isPackageEnabled(pkg, settings, serviceState, byId = new Map(), seen = new Set()) {
  if (seen.has(pkg.id)) return true; // already counted in this traversal (cycle guard)
  seen.add(pkg.id);
  if (!ownComponentsEnabled(pkg, settings, serviceState)) return false;
  for (const depId of pkg.requires ?? []) {
    const dep = byId.get(depId);
    if (dep && !isPackageEnabled(dep, settings, serviceState, byId, seen)) return false;
  }
  return true;
}

function ownComponentsEnabled(pkg, settings, serviceState) {
  // A plugin package is enabled iff its enabledPlugins bool is true. Checked first so plugin-only
  // packages (e.g. caveman) are identified by their own marker, not by other component types.
  const pluginComp = pkg.components.find((c) => c.type === "plugin");
  if (pluginComp) {
    return settings?.enabledPlugins?.[pluginComp.id] === true;
  }
  // A service package is enabled iff its handler's state says so (telemetry: the spool state file).
  const serviceComp = pkg.components.find((c) => c.type === "service");
  if (serviceComp) {
    return serviceState?.[serviceComp.id] === true;
  }
  // A skill package is enabled iff every bundled skill is linked into the Claude skills dir.
  const skillComps = pkg.components.filter((c) => c.type === "skill");
  if (skillComps.length) {
    const skillsDir = path.join(os.homedir(), ".claude", "skills");
    return skillComps.every((c) => fs.existsSync(path.join(skillsDir, c.id)));
  }
  const permComp = pkg.components.find((c) => c.type === "permissions");
  if (permComp) {
    const allow = settings?.permissions?.allow || [];
    return permComp.allow.every((p) => allow.includes(p));
  }
  const hookComp = pkg.components.find((c) => c.type === "hooks");
  if (hookComp) {
    const hooksPath = path.join(repoRoot, hookComp.source);
    const fragment = readJson(hooksPath, {});
    const settingsHooks = settings?.hooks || {};
    for (const [event, entries] of Object.entries(fragment)) {
      const existing = settingsHooks[event] || [];
      for (const entry of entries) {
        const cmd = entry.hooks?.[0]?.command;
        if (cmd && existing.some((e) => (e.hooks || []).some((h) => h.command === cmd))) return true;
      }
    }
    return false;
  }
  // No recognized own components → a pure-composite package; its enabled state is decided entirely
  // by its `requires` (handled by the caller).
  return pkg.components.length === 0;
}

export function readConfigSnapshot() {
  const packagesCatalog = readJson(PACKAGES_PATH, { packages: [] });
  const presetsCatalog = readJson(PRESETS_PATH, { bundles: [], default: [] });
  const presetState = readJson(presetsStatePath, {});
  const installState = readJson(installStatePath, null);
  const telemetryState = readJson(path.join(telemetryDir, "state.json"), null);
  const settings = readJson(CLAUDE_SETTINGS, {});
  const skillInvocation = readJson(SKILL_INVOCATION_PATH, { skills: [] });
  const slashCommands = readJson(SLASH_COMMANDS_PATH, { commands: [] });
  const agentPermissions = readJson(AGENT_PERMISSIONS_PATH, null);
  // Active per-machine (global) profile recorded by the config controls; falls back to repo default.
  const activeProfile = readJson(activeProfilePath, {})?.profile || agentPermissions?.default_profile || null;
  // Per-project override profile detected from <cwd>/.claude/settings.json, if any.
  const projectProfile = readProjectProfile();

  const selectedBundles = new Set(presetState.selected ?? presetsCatalog.default);

  const packagesById = new Map((packagesCatalog.packages || []).map((p) => [p.id, p]));
  const packages = packagesCatalog.packages.map((pkg) => ({
    id: pkg.id,
    label: pkg.label,
    description: pkg.description || null,
    cliCommands: pkg.cliCommands || [],
    enabled: isPackageEnabled(pkg, settings, { telemetry: !!telemetryState?.enabled }, packagesById),
    components: pkg.components.map((c) => c.type),
    requires: pkg.requires || [],
  }));

  const bundles = presetsCatalog.bundles.map((b) => ({
    id: b.id,
    label: b.label,
    description: b.description || null,
    selected: selectedBundles.has(b.id),
  }));

  const hooks = {};
  for (const [event, entries] of Object.entries(settings.hooks || {})) {
    hooks[event] = Array.isArray(entries) ? entries.length : 0;
  }

  // Build tool list: skills cross-referenced with commands to assign badges.
  // installed = symlink at ~/.claude/skills/<name> exists (source of truth for Phase 2 toggles).
  const skillsDir = path.join(os.homedir(), ".claude", "skills");
  const commandBySkill = {};
  for (const cmd of (slashCommands.commands || [])) {
    if (cmd.skill) commandBySkill[cmd.skill] = { name: cmd.name, description: cmd.description };
  }
  const tools = (skillInvocation.skills || []).map((s) => ({
    id: s.skill,
    label: s.skill,
    invocation: s.invocation,
    hasCommand: !!s.explicit_command,
    command: commandBySkill[s.skill]?.name || null,
    description: commandBySkill[s.skill]?.description || null,
    installed: fs.existsSync(path.join(skillsDir, s.skill)),
  }));

  return {
    packages,
    bundles,
    tools,
    agentPermissions,
    activeProfile,
    projectProfile,
    profiles: Object.keys(agentPermissions?.profiles ?? {}),
    plugins: {
      caveman: settings?.enabledPlugins?.["caveman@caveman"] === true,
    },
    install: installState
      ? { mode: installState.mode || null, updatedAt: installState.updatedAt || null }
      : null,
    onboardedAt: presetState.onboardedAt || null,
    telemetry: telemetryState
      ? { enabled: !!telemetryState.enabled, updatedAt: telemetryState.updatedAt || null }
      : { enabled: false, updatedAt: null },
    settings: {
      hooks,
      permissions: {
        allow: (settings?.permissions?.allow || []).length,
        deny: (settings?.permissions?.deny || []).length,
      },
    },
  };
}

// Maps the raw technical snapshot onto user-facing behavior categories matching README § Global Behavior.
export function buildBehaviorView(snap) {
  const pkg = (id) => snap.packages.find((p) => p.id === id);
  const bundle = (id) => snap.bundles.find((b) => b.id === id);
  const tel = snap.telemetry;
  const perms = snap.agentPermissions;

  return [
    {
      category: "Token Optimization",
      items: [
        {
          id: "jcodemunch",
          label: "jcodemunch",
          description: "Code indexer — find code via symbol search instead of reading files",
          active: pkg("jcodemunch")?.enabled ?? false,
          hint: pkg("jcodemunch")?.enabled ? null : "roborepo enable jcodemunch",
        },
        {
          id: "jdocmunch",
          label: "jdocmunch",
          description: "Docs indexer — query sections instead of reading whole files",
          active: pkg("jdocmunch")?.enabled ?? false,
          hint: pkg("jdocmunch")?.enabled ? null : "roborepo enable jdocmunch  (coming soon)",
        },
        {
          id: "caveman",
          label: "Caveman plugin",
          description: "Keeps agent output terse to reduce token use",
          active: pkg("caveman")?.enabled ?? !!snap.plugins?.caveman,
          toggle: "package",
          hint: (pkg("caveman")?.enabled ?? snap.plugins?.caveman) ? null : "enables on the harness's next launch",
        },
        {
          id: "telemetry",
          label: "Telemetry",
          description: "Capture and visualize token usage across harnesses",
          active: pkg("telemetry")?.enabled ?? !!tel?.enabled,
          toggle: "package",
          hint: (pkg("telemetry")?.enabled ?? tel?.enabled) ? "roborepo telemetry serve" : null,
        },
      ],
    },
    {
      category: "Workflows",
      description: "Named commands that frame a specific use case.",
      items: snap.tools
        .filter((t) => t.command && t.id !== "roborepo-support")
        .map((t) => ({
          id: t.id,
          label: t.label,
          description: t.description,
          active: t.installed,
          badges: ["skill", `/${t.command}`],
        })),
    },
    {
      category: "Code Conventions",
      description: "Skills auto-loaded when relevant — shape output without an explicit command.",
      items: snap.tools
        .filter((t) => !t.command && t.id !== "roborepo-support")
        .map((t) => ({
          id: t.id,
          label: t.label,
          description: t.description,
          active: t.installed,
          badges: ["skill"],
        })),
      footnote: "roborepo-support — help skill for this repo, always loaded.",
    },
    {
      category: "Permissions",
      items: [
        {
          id: "profile",
          label: snap.activeProfile || perms?.default_profile || "interactive",
          description: perms?.profiles?.[snap.activeProfile || perms?.default_profile]?.description || null,
          active: true,
          kind: "profile",
          globalProfile: snap.activeProfile || perms?.default_profile || null,
          projectProfile: snap.projectProfile || null, // null = no project override (uses global)
          // Selectable profiles for the interactive controls (terminal onboarding + web toggle).
          options: (snap.profiles || []).map((id) => ({
            id,
            description: perms?.profiles?.[id]?.description || null,
            current: id === (snap.activeProfile || perms?.default_profile),
            looser: id === "workspace" || id === "networked",
          })),
        },
        {
          id: "deny",
          label: `${perms?.commands?.deny?.length || 0} blocked commands`,
          description: (perms?.commands?.deny || []).map((c) => c.join(" ")).join(" · "),
          active: true,
          kind: "info",
        },
        {
          id: "allow",
          label: `${perms?.commands?.allow?.length || 0} pre-approved commands`,
          description: null,
          active: true,
          kind: "expandable",
          detail: (perms?.commands?.allow || []).map((c) => c.join(" ")),
        },
      ],
    },
  ];
}

export function configCommand(args) {
  const [sub = "status"] = args;
  if (sub !== "status") {
    console.error("usage: roborepo config status");
    process.exit(2);
  }

  const snap = readConfigSnapshot();
  const view = buildBehaviorView(snap);
  const check = (v) => (v ? "[x]" : "[ ]");

  for (const section of view) {
    const header = section.description
      ? `\n${section.category}  (${section.description})`
      : `\n${section.category}`;
    console.log(header);
    for (const item of section.items) {
      if (item.kind === "profile") {
        console.log(`  profile:   ${item.label}`);
        if (item.description) console.log(`             ${item.description}`);
      } else if (item.kind === "info") {
        console.log(`  ${item.label}`);
        if (item.description) console.log(`    ${item.description}`);
      } else if (item.kind === "expandable") {
        console.log(`  ${item.label}`);
        if (item.detail?.length) {
          const show = item.detail.slice(0, 5);
          for (const d of show) console.log(`    · ${d}`);
          if (item.detail.length > 5) console.log(`    … (${item.detail.length - 5} more)`);
        }
      } else {
        const badges = item.badges?.length ? "  " + item.badges.map((b) => `[${b}]`).join(" ") : "";
        console.log(`  ${check(item.active)} ${item.label}${badges}`);
        if (item.description) console.log(`      ${item.description}`);
        if (!item.active && item.hint) console.log(`      → ${item.hint}`);
      }
    }
    if (section.footnote) console.log(`\n  * ${section.footnote}`);
  }

  console.log("\ninstall");
  if (snap.install) {
    console.log(`  mode:      ${snap.install.mode}`);
    if (snap.install.updatedAt) console.log(`  updated:   ${snap.install.updatedAt}`);
  } else {
    console.log("  mode:      not installed  (shim / manual config)");
  }
  if (snap.onboardedAt) console.log(`  onboarded: ${snap.onboardedAt}`);
  console.log("");
}

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { repoRoot } from "./paths.mjs";
import { installStatePath, presetsStatePath, telemetryDir, activeProfilePath } from "./state-paths.mjs";
import { readProjectProfile } from "./config-mutate.mjs";
import { renderMarkdown } from "./markdown-render.mjs";
import {
  readEnabledPackagesRegistry,
  renderRulesPreview,
  renderSharedRulesPreview,
  renderHarnessRulesPreview,
  renderEnabledPackageRulesPreview,
} from "./rules-render.mjs";

const PACKAGES_PATH = path.join(repoRoot, "manifests", "inventory", "packages.json");
const PRESETS_PATH = path.join(repoRoot, "manifests", "platform", "presets.json");
const SKILL_INVOCATION_PATH = path.join(repoRoot, "manifests", "inventory", "skill-invocation.json");
const SLASH_COMMANDS_PATH = path.join(repoRoot, "manifests", "inventory", "slash-commands.json");
const AGENT_PERMISSIONS_PATH = path.join(repoRoot, "manifests", "inventory", "agent-permissions.json");
const CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const LIVE_RULE_FILES = {
  claude: path.join(os.homedir(), ".claude", "CLAUDE.md"),
  codex: path.join(os.homedir(), ".codex", "AGENTS.md"),
};

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function readText(filePath, fallback = "") {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return fallback; }
}

function renderEntry(text) {
  return { text, html: renderMarkdown(text) };
}

function readLiveRulesFile(harness) {
  const filePath = LIVE_RULE_FILES[harness];
  if (!filePath) return { installed: false, path: null, content: "", html: "" };
  const content = readText(filePath, "");
  return {
    installed: fs.existsSync(filePath),
    path: filePath,
    content,
    html: renderMarkdown(content),
  };
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
  const rulesEnabled = () => {
    const rulesComp = pkg.components.find((c) => c.type === "rules");
    if (!rulesComp) return true;
    const { exists, packages: enabledPkgs } = readEnabledPackagesRegistry();
    if (exists) return enabledPkgs.includes(pkg.id);
    const rulesFile = rulesComp.harness === "codex"
      ? path.join(os.homedir(), ".codex", "AGENTS.md")
      : path.join(os.homedir(), ".claude", "CLAUDE.md");
    let live = "";
    try { live = fs.readFileSync(rulesFile, "utf8"); } catch { return false; }
    const firstLine = fs.readFileSync(path.join(repoRoot, rulesComp.source), "utf8").split("\n").find((l) => l.trim());
    return !!firstLine && live.includes(firstLine);
  };

  // A plugin package is enabled iff its enabledPlugins bool is true. If it also carries rules, the
  // rules registry must include the package too so the UI doesn't show a half-applied package as on.
  const pluginComp = pkg.components.find((c) => c.type === "plugin");
  if (pluginComp) {
    return settings?.enabledPlugins?.[pluginComp.id] === true && rulesEnabled();
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
  // A rules package is enabled iff it's in the enabled-packages registry (Phase 3+). On a
  // pre-Phase-3 machine without the registry, fall back to text scanning the live rules file.
  const rulesComp = pkg.components.find((c) => c.type === "rules");
  if (rulesComp) {
    return rulesEnabled();
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
    urls: pkg.urls || [],
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
    if (cmd.skill) commandBySkill[cmd.skill] = { name: cmd.name, description: cmd.description, harnesses: cmd.harnesses || [] };
  }
  const tools = (skillInvocation.skills || []).map((s) => ({
    id: s.skill,
    label: s.skill,
    invocation: s.invocation,
    hasCommand: !!s.explicit_command,
    command: commandBySkill[s.skill]?.name || null,
    description: commandBySkill[s.skill]?.description || null,
    // Which harness(es) actually have a command file on disk — drives the inspect popup's harness so
    // a codex-only command isn't requested as claude (404). Defaults to claude when unspecified.
    commandHarnesses: commandBySkill[s.skill]?.harnesses || [],
    installed: fs.existsSync(path.join(skillsDir, s.skill)),
  }));

  const snapshot = {
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
    // Harness-agnostic rules + global settings shown in the /config "Globals" section. Each rules
    // entry carries raw markdown plus rendered HTML: shared = baseline every harness gets,
    // claude/codex = harness-specific deltas, packages = enabled package rule slices. The live
    // home files are also included so the portal can render the actual on-disk CLAUDE.md / AGENTS.md.
    globals: {
      rules: {
        shared: renderEntry(renderSharedRulesPreview()),
        claude: renderEntry(renderHarnessRulesPreview("claude")),
        codex: renderEntry(renderHarnessRulesPreview("codex")),
        packages: renderEntry(renderEnabledPackageRulesPreview()),
      },
      liveRules: {
        claude: readLiveRulesFile("claude"),
        codex: readLiveRulesFile("codex"),
      },
      settings: {
        activeProfile,
        projectProfile,
        profiles: Object.keys(agentPermissions?.profiles ?? {}),
        plugins: { caveman: settings?.enabledPlugins?.["caveman@caveman"] === true },
        hooks,
      },
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
  // Computed once here so terminal and web render from the identical view (no client-side fork).
  snapshot.behaviorView = buildBehaviorView(snapshot);
  return snapshot;
}

// Maps the raw technical snapshot onto user-facing behavior categories matching README § Global
// Behavior. SINGLE SOURCE OF TRUTH for both the terminal `roborepo config` view and the web /config
// page: the snapshot ships this under `behaviorView`, the web client renders it directly (no parallel
// JS reimplementation to drift). Items carry both terminal fields (hint) and web fields (toggle,
// inspect, urls, badges); each consumer reads what it needs and ignores the rest.
export function buildBehaviorView(snap) {
  const pkg = (id) => snap.packages.find((p) => p.id === id);
  const bundle = (id) => snap.bundles.find((b) => b.id === id);
  const tel = snap.telemetry;
  const perms = snap.agentPermissions;
  const pkgUrls = (id) => pkg(id)?.urls || [];

  return [
    {
      category: "Token Optimization",
      items: [
        {
          id: "jcodemunch",
          label: "jcodemunch",
          description: "Code indexer — find code via symbol search instead of reading files",
          active: pkg("jcodemunch")?.enabled ?? false,
          toggle: "package",
          urls: pkgUrls("jcodemunch"),
          hint: pkg("jcodemunch")?.enabled ? null : "roborepo enable jcodemunch",
        },
        {
          id: "jdocmunch",
          label: "jdocmunch",
          description: "Docs indexer — query sections instead of reading whole files",
          active: pkg("jdocmunch")?.enabled ?? false,
          toggle: "package",
          urls: pkgUrls("jdocmunch"),
          hint: pkg("jdocmunch")?.enabled ? null : "roborepo enable jdocmunch  (coming soon)",
        },
        {
          id: "caveman",
          label: "Caveman plugin",
          description: "Keeps agent output terse to reduce token use",
          active: pkg("caveman")?.enabled ?? !!snap.plugins?.caveman,
          toggle: "package",
          urls: pkgUrls("caveman"),
          hint: (pkg("caveman")?.enabled ?? snap.plugins?.caveman) ? null : "enables on the harness's next launch",
        },
        {
          id: "telemetry",
          label: "Telemetry",
          description: "Capture and visualize token usage across harnesses",
          active: pkg("telemetry")?.enabled ?? !!tel?.enabled,
          toggle: "package",
          urls: pkgUrls("telemetry"),
          hint: (pkg("telemetry")?.enabled ?? tel?.enabled) ? "roborepo serve" : null,
        },
      ],
    },
    {
      category: "Commands",
      description: "Named slash-command workflows you start intentionally.",
      items: snap.tools
        .filter((t) => t.command && t.id !== "roborepo-support")
        .map((t) => ({
          id: t.id,
          label: `/${t.command}`,
          description: t.description,
          active: t.installed,
          toggle: "skill",
          badges: [`/${t.command}`, "skill"],
          // Inspect the command wrapper plus the backing SKILL.md. Pick a harness the command
          // actually exists for (codex-only → codex).
          inspect: {
            kind: "command-skill",
            id: t.command,
            skill: t.id,
            harness: (t.commandHarnesses || []).includes("claude") ? "claude" : (t.commandHarnesses || [])[0] || "claude",
            label: `/${t.command}`,
          },
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
          toggle: "skill",
          badges: ["skill"],
          inspect: { kind: "skill", id: t.id, label: t.label },
        })),
      footnote: "roborepo-support — help skill for this repo, always loaded.",
    },
    {
      category: "Chat-Time Output",
      description: "Inline chat notes the agent adds while responding — no files written, no workflow started.",
      items: [
        {
          id: "convention-capture",
          label: "Convention capture",
          description: "Surfaces newly confirmed conventions inline (> 📌 Capture candidate:)",
          active: pkg("convention-capture")?.enabled ?? false,
          toggle: "package",
          inspect: { kind: "rules", id: "convention-capture", label: "Convention capture" },
        },
        {
          id: "impact-awareness",
          label: "Impact awareness",
          description: "Flags how a proposed change collides with existing functionality (> 🧭 Impact:)",
          active: pkg("impact-awareness")?.enabled ?? false,
          toggle: "package",
          inspect: { kind: "rules", id: "impact-awareness", label: "Impact awareness" },
        },
        {
          id: "skill-visibility",
          label: "Skill visibility",
          description: "Reports which skills shaped a response (> 🧩 Skills loaded:)",
          active: pkg("skill-visibility")?.enabled ?? false,
          toggle: "package",
          inspect: { kind: "rules", id: "skill-visibility", label: "Skill visibility" },
        },
      ],
    },
    {
      category: "Permissions",
      kind: "permissions",
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
          value: (perms?.commands?.deny || []).map((c) => c.join(" ")).join(" · "), // web info renderer reads `value`
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

// Read the full source that DEFINES a tool, for the /config click-to-inspect popup. Strictly
// whitelisted: kind+id are resolved against the catalogs/known dirs, never used to build a path
// directly, so an attacker can't request arbitrary files (no traversal — ids are matched against
// catalog entries and basenames only). Returns { ok, title, path, content } or { ok:false, error }.
export function loadConfigSource({ kind, id, harness = "claude" }) {
  const harnessSafe = harness === "codex" ? "codex" : "claude";
  const fail = (error) => ({ ok: false, error });

  if (kind === "skill") {
    // Validate id against the skill-invocation catalog so only known skills are readable.
    const skills = readJson(SKILL_INVOCATION_PATH, { skills: [] }).skills || [];
    if (!skills.some((s) => s.skill === id)) return fail(`unknown skill: ${id}`);
    const abs = path.join(repoRoot, "globals", "agents", "skills", id, "SKILL.md");
    return readSourceFile(abs, `skill: ${id}`);
  }

  if (kind === "command") {
    // id is the command NAME (no slash); validate against the slash-commands catalog.
    const commands = readJson(SLASH_COMMANDS_PATH, { commands: [] }).commands || [];
    const cmd = commands.find((c) => c.name === id);
    if (!cmd) return fail(`unknown command: ${id}`);
    const abs = path.join(repoRoot, "globals", harnessSafe, "commands", `${id}.md`);
    return readSourceFile(abs, `/${id} (${harnessSafe})`);
  }

  if (kind === "command-skill") {
    // id is the command NAME (no slash). Read both the generated command wrapper and the SKILL.md
    // it points at, so the popup shows the loading instruction plus the actual skill content.
    const commands = readJson(SLASH_COMMANDS_PATH, { commands: [] }).commands || [];
    const cmd = commands.find((c) => c.name === id);
    if (!cmd) return fail(`unknown command: ${id}`);
    const skills = readJson(SKILL_INVOCATION_PATH, { skills: [] }).skills || [];
    if (!cmd.skill || !skills.some((s) => s.skill === cmd.skill)) return fail(`unknown skill for command: ${id}`);

    const commandAbs = path.join(repoRoot, "globals", harnessSafe, "commands", `${id}.md`);
    const skillAbs = path.join(repoRoot, "globals", "agents", "skills", cmd.skill, "SKILL.md");
    const command = readSourceFile(commandAbs, `/${id} (${harnessSafe})`);
    if (!command.ok) return command;
    const skill = readSourceFile(skillAbs, `skill: ${cmd.skill}`);
    if (!skill.ok) return skill;
    return {
      ok: true,
      title: `/${id} + ${cmd.skill}`,
      path: `${command.path} + ${skill.path}`,
      content: [
        `# /${id} (${harnessSafe})`,
        command.content.trimEnd(),
        "",
        `# skill: ${cmd.skill}`,
        skill.content.trimEnd(),
        "",
      ].join("\n"),
      html: renderMarkdown([
        `# /${id} (${harnessSafe})`,
        command.content.trimEnd(),
        "",
        `# skill: ${cmd.skill}`,
        skill.content.trimEnd(),
        "",
      ].join("\n")),
    };
  }

  if (kind === "globals-rules") {
    // Full rendered home-rules for one harness (what lands in CLAUDE.md / AGENTS.md). Served on
    // demand so the 10s config poll doesn't carry ~13KB of rules text it rarely needs.
    const content = renderRulesPreview(harnessSafe);
    const file = harnessSafe === "codex" ? "~/.codex/AGENTS.md" : "~/.claude/CLAUDE.md";
    return { ok: true, title: `Rendered rules — ${harnessSafe}`, path: file, content, html: renderMarkdown(content) };
  }

  if (kind === "live-rules") {
    const live = readLiveRulesFile(harnessSafe);
    if (!live.installed && !live.content) return fail(`live rules file not found: ${harnessSafe}`);
    const file = harnessSafe === "codex" ? "~/.codex/AGENTS.md" : "~/.claude/CLAUDE.md";
    return { ok: true, title: `Live rules — ${harnessSafe}`, path: file, content: live.content, html: live.html };
  }

  if (kind === "rules" || kind === "hooks") {
    // Resolve the package's component source from the catalog — never trust a caller-supplied path.
    const pkgs = readJson(PACKAGES_PATH, { packages: [] }).packages || [];
    const pkg = pkgs.find((p) => p.id === id);
    if (!pkg) return fail(`unknown package: ${id}`);
    const comp = pkg.components.find((c) => c.type === kind);
    if (!comp?.source) return fail(`package ${id} has no ${kind} source`);
    const abs = path.join(repoRoot, comp.source);
    return readSourceFile(abs, `${pkg.label} — ${kind}`);
  }

  return fail(`unknown kind: ${kind}`);
}

function readSourceFile(abs, title) {
  // Defense in depth: the resolved path must stay inside the repo even though it's catalog-derived.
  const resolved = path.resolve(abs);
  if (resolved !== repoRoot && !resolved.startsWith(repoRoot + path.sep)) {
    return { ok: false, error: "path escapes repo" };
  }
  try {
    const content = fs.readFileSync(resolved, "utf8");
    return { ok: true, title, path: path.relative(repoRoot, resolved), content, html: renderMarkdown(content) };
  } catch {
    return { ok: false, error: `not found: ${path.relative(repoRoot, resolved)}` };
  }
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

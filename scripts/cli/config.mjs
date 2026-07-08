import fs from "node:fs";
import path from "node:path";
import { repoRoot, harnessHome, rootConfigBaseline, rootConfigActive } from "./paths.mjs";
import { presetsStatePath, telemetryDir } from "./state-paths.mjs";
import { effectivePermissions } from "./config-mutate.mjs";
import { renderMarkdown } from "./markdown-render.mjs";
import {
  renderRulesPreview,
  renderSharedRulesPreview,
  renderHarnessRulesPreview,
  renderEnabledPackageRulesPreview,
} from "./rules-render.mjs";
import {
  loadPackageCatalog,
  isPackageAvailable,
} from "./package-catalog.mjs";
import { buildPackageLiveState } from "./package-probes.mjs";
import { inspectSkill, skillInventorySource } from "./skill-inventory.mjs";
import { checkDrift } from "./root-config-state.mjs";
import { findSiblingArtifact } from "./staging-lib.mjs";

const PRESETS_PATH = path.join(repoRoot, "manifests", "platform", "presets.json");
const SKILL_INVOCATION_PATH = path.join(repoRoot, "manifests", "inventory", "skill-invocation.json");
const SLASH_COMMANDS_PATH = path.join(repoRoot, "manifests", "inventory", "slash-commands.json");
const CLAUDE_SETTINGS = rootConfigActive.claude;
const CODEX_CONFIG = rootConfigActive.codex;
const CODEX_HOOKS = path.join(harnessHome.codex, "hooks.json");
const LIVE_RULE_FILES = {
  claude: path.join(harnessHome.claude, "CLAUDE.md"),
  codex: path.join(harnessHome.codex, "AGENTS.md"),
};

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function readText(filePath, fallback = "") {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return fallback; }
}

function readExternalSourceFile(abs, title, pathText, language = "json") {
  try {
    const content = fs.readFileSync(abs, "utf8");
    return {
      ok: true,
      title,
      path: pathText,
      content,
      html: renderMarkdown(`\`\`\`${language}\n${content.trimEnd()}\n\`\`\``),
    };
  } catch {
    return { ok: false, error: `not found: ${pathText}` };
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderEntry(text) {
  return { text, html: renderMarkdown(text) };
}

function stripGeneratedRulesPreamble(content) {
  const lines = content.split("\n");
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== "# Generated Harness Rules") {
      kept.push(lines[i]);
      continue;
    }
    while (
      i + 1 < lines.length &&
      (
        lines[i + 1].trim() === "" ||
        lines[i + 1].startsWith("Generated from ") ||
        lines[i + 1].startsWith("Enabled packages ") ||
        lines[i + 1].startsWith("Do not edit ")
      )
    ) {
      i += 1;
    }
  }
  return collapseDuplicateCavemanCommunication(kept.join("\n")).replace(/\n{3,}/g, "\n\n");
}

function collapseDuplicateCavemanCommunication(content) {
  let seen = false;
  const normalized = [
    "## Communication",
    "",
    "Use caveman full by default. Terse, no filler, fragments OK.",
    "",
    "Switch to normal mode only when the user explicitly says `normal mode` or `stop caveman`.",
  ].join("\n");
  return content.replace(
    /## Communication\s*\n+Use caveman full by default\. Terse, no filler, fragments OK\.\s*\n+Switch to normal mode only when the user explicitly says `normal mode` or `stop caveman`\./g,
    () => {
      if (seen) return "";
      seen = true;
      return normalized;
    },
  );
}

function readLiveRulesFile(harness) {
  const filePath = LIVE_RULE_FILES[harness];
  if (!filePath) return { installed: false, path: null, content: "", html: "" };
  const content = stripGeneratedRulesPreamble(readText(filePath, ""));
  return {
    installed: fs.existsSync(filePath),
    path: filePath,
    content,
    html: renderMarkdown(content),
  };
}

export function readConfigSnapshot() {
  const allPackages = loadPackageCatalog({ includeUnavailable: true });
  const availablePackages = allPackages.filter((pkg) => isPackageAvailable(pkg));
  const presetsCatalog = readJson(PRESETS_PATH, { bundles: [], default: [] });
  const presetState = readJson(presetsStatePath, {});
  const telemetryState = readJson(path.join(telemetryDir, "state.json"), null);
  const settings = readJson(CLAUDE_SETTINGS, {});
  const skillInvocation = readJson(SKILL_INVOCATION_PATH, { skills: [] });
  const slashCommands = readJson(SLASH_COMMANDS_PATH, { commands: [] });
  // Named behaviors + arbitrary commands, manifest defaults merged with personal overrides.
  // Global only — no per-project scope (see permissions-render.mjs / config-mutate.mjs).
  const permissions = effectivePermissions();

  const selectedBundles = new Set(presetState.selected ?? presetsCatalog.default);

  const packageLiveState = buildPackageLiveState(availablePackages);
  const unavailableSkillIds = new Set(
    allPackages
      .filter((pkg) => !isPackageAvailable(pkg))
      .flatMap((pkg) => (pkg.components || []).filter((c) => c.type === "skill").map((c) => c.id)),
  );
  const packages = availablePackages.map((pkg) => ({
    id: pkg.id,
    label: pkg.label,
    description: pkg.description || null,
    status: packageLiveState.get(pkg.id)?.status || "disabled",
    catalogStatus: pkg.status || "available",
    desired: packageLiveState.get(pkg.id)?.desired || false,
    cliCommands: [...new Set([...(pkg.cliCommands || []), ...pkg.components.filter((c) => c.type === "command").map((c) => c.name)])],
    enabled: packageLiveState.get(pkg.id)?.desired || false,
    componentStatus: packageLiveState.get(pkg.id)?.components || [],
    components: pkg.components.map((c) => c.type),
    skillIds: pkg.components.filter((c) => c.type === "skill").map((c) => c.id),
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
  const skillsDir = path.join(harnessHome.claude, "skills");
  const commandBySkill = {};
  for (const cmd of (slashCommands.commands || [])) {
    if (cmd.skill) commandBySkill[cmd.skill] = { name: cmd.name, description: cmd.description, harnesses: cmd.harnesses || [] };
  }
  const tools = (skillInvocation.skills || [])
    .filter((s) => !unavailableSkillIds.has(s.skill))
    .map((s) => ({
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
      inventory: inspectSkill(s.skill),
    }));

  const snapshot = {
    packages,
    bundles,
    tools,
    permissions,
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
        plugins: { caveman: settings?.enabledPlugins?.["caveman@caveman"] === true },
        hooks,
      },
    },
    // Root-config drift state per harness (in-sync / drifted / staged-pending / …), same signal the
    // terminal `roborepo config root inspect` reports. The portal renders a status chip from this.
    rootConfig: buildRootConfigView().map((row) => ({
      harness: row.harness,
      state: row.state,
      hasStagedUpdate: !!row.stagedUpdate,
    })),
    telemetry: telemetryState
      ? { enabled: !!telemetryState.enabled }
      : { enabled: false },
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
  const tel = snap.telemetry;
  const perms = snap.permissions;
  const pkgUrls = (id) => pkg(id)?.urls || [];
  const pkgBadges = (id) => {
    const item = pkg(id);
    return [
      ...(item?.catalogStatus === "pending" ? ["pending"] : []),
      ...(item?.status && item.status !== "enabled" && item.status !== "disabled" ? [item.status] : []),
    ];
  };
  const packageBySkill = new Map(
    snap.packages
      .flatMap((p) => (p.skillIds || []).map((skillId) => [skillId, p]))
  );

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
          badges: pkgBadges("jcodemunch"),
          hint: null,
        },
        {
          id: "jdocmunch",
          label: "jdocmunch",
          description: "Docs indexer — query sections instead of reading whole files",
          active: pkg("jdocmunch")?.enabled ?? false,
          toggle: "package",
          urls: pkgUrls("jdocmunch"),
          badges: pkgBadges("jdocmunch"),
          hint: null,
        },
        {
          id: "caveman",
          label: "Caveman plugin",
          description: "Keeps agent output terse to reduce token use",
          active: pkg("caveman")?.enabled ?? !!snap.plugins?.caveman,
          toggle: "package",
          urls: pkgUrls("caveman"),
          badges: pkgBadges("caveman"),
          hint: (pkg("caveman")?.enabled ?? snap.plugins?.caveman) ? null : "enables on the harness's next launch",
        },
        {
          id: "telemetry",
          label: "Telemetry",
          description: "Capture and visualize token usage across harnesses",
          active: pkg("telemetry")?.enabled ?? !!tel?.enabled,
          toggle: "package",
          urls: pkgUrls("telemetry"),
          badges: pkgBadges("telemetry"),
          hint: (pkg("telemetry")?.enabled ?? tel?.enabled) ? "roborepo serve" : null,
        },
      ],
    },
    {
      category: "Commands",
      description: "Named slash-command workflows you start intentionally.",
      items: snap.tools
        .filter((t) => t.command && t.id !== "roborepo-support")
        .map((t) => {
          const ownerPackage = packageBySkill.get(t.id);
          return {
            id: ownerPackage?.id || t.id,
            label: `/${t.command}`,
            description: t.description,
            active: ownerPackage ? ownerPackage.enabled : t.installed,
            toggle: ownerPackage ? "package" : "skill",
            badges: [
              ...(ownerPackage?.catalogStatus === "pending" ? ["pending"] : []),
              ...(ownerPackage?.status && ownerPackage.status !== "enabled" && ownerPackage.status !== "disabled" ? [ownerPackage.status] : []),
            ],
            // Inspect the command wrapper plus the backing SKILL.md. Pick a harness the command
            // actually exists for (codex-only → codex).
            inspect: {
              kind: "command-skill",
              id: t.command,
              skill: t.id,
              harness: (t.commandHarnesses || []).includes("claude") ? "claude" : (t.commandHarnesses || [])[0] || "claude",
              label: `/${t.command}`,
            },
          };
        }),
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
      // Flat model: every behavior (named — pinned, shown first — or arbitrary, user-added) is
      // independently deny/ask/allow. No separate profile bundle or project scope; global only.
      // `perms` (snap.permissions, from config-mutate.mjs effectivePermissions()) already merges
      // manifest defaults with personal overrides — this just reshapes it for display.
      items: [
        ...(perms?.behaviors || []).map((b) => ({
          id: b.id,
          label: b.label,
          description: b.description,
          active: true,
          kind: "behavior",
          bucket: b.bucket,
          overridden: b.overridden,
          defaultBucket: b.defaultBucket,
          // "go-online" has no Claude equivalent (Claude doesn't sandbox network); surfaced so the
          // UI can note it rather than silently implying parity across harnesses.
          codexOnly: !!b.codexOnly,
          // Codex has no per-command ask tier — an ask-bucket behavior/command falls through to
          // Codex's approval_policy fallback instead of a real per-item prompt. Flagged here so
          // the UI can show the caveat next to any behavior currently set to ask.
          noCodexAsk: b.bucket === "ask",
        })),
        {
          id: "arbitrary-commands",
          label: "Other commands",
          description: "Commands not covered by the behaviors above — added and edited here.",
          active: true,
          kind: "arbitrary-list",
          items: (perms?.arbitrary || []).map((c) => ({
            id: c.id,
            label: c.label,
            bucket: c.bucket,
            overridden: c.overridden,
            defaultBucket: c.defaultBucket,
            noCodexAsk: c.bucket === "ask",
          })),
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
    const source = skillInventorySource(id);
    if (!source.ok) return fail(source.error);
    return readSkillSource(source.item.inspectPath, `skill: ${id}`, source.item);
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
    const command = readSourceFile(commandAbs, `/${id} (${harnessSafe})`);
    if (!command.ok) return command;
    const inventorySource = skillInventorySource(cmd.skill);
    if (!inventorySource.ok) return fail(inventorySource.error);
    const skill = readSkillSource(inventorySource.item.inspectPath, `skill: ${cmd.skill}`, inventorySource.item);
    if (!skill.ok) return skill;
    const skillParts = [
      renderCommandSourceHtml(`/${id} (${harnessSafe})`, command.content),
      skill.html,
    ].join("\n");
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
      html: skillParts,
    };
  }

  if (kind === "globals-rules") {
    // Full rendered home-rules for one harness (what lands in CLAUDE.md / AGENTS.md). Served on
    // demand so the 10s config poll doesn't carry ~13KB of rules text it rarely needs.
    const content = renderRulesPreview(harnessSafe);
    const file = harnessSafe === "codex" ? "~/.codex/AGENTS.md" : "~/.claude/CLAUDE.md";
    return { ok: true, title: `Rendered rules — ${harnessSafe}`, path: file, content, html: renderMarkdown(content) };
  }

  if (kind === "harness-hooks") {
    const abs = harnessSafe === "codex"
      ? path.join(repoRoot, "globals", "codex", "hooks.json")
      : path.join(repoRoot, "globals", "claude", "settings.json");
    const source = readSourceFile(abs, `${harnessSafe === "codex" ? "Codex" : "Claude"} hooks`);
    if (!source.ok) return source;
    if (harnessSafe === "codex") {
      return {
        ...source,
        html: renderMarkdown("```json\n" + source.content.trimEnd() + "\n```"),
      };
    }

    const settings = readJson(abs, {});
    const content = JSON.stringify(settings.hooks || {}, null, 2) + "\n";
    return {
      ok: true,
      title: "Claude hooks",
      path: `${source.path}#hooks`,
      content,
      html: renderMarkdown("```json\n" + content + "```"),
    };
  }

  if (kind === "config-file") {
    if (id === "claude-settings") {
      return readExternalSourceFile(CLAUDE_SETTINGS, "Claude settings", "~/.claude/settings.json", "json");
    }
    if (id === "codex-config") {
      return readExternalSourceFile(CODEX_CONFIG, "Codex config", "~/.codex/config.toml", "toml");
    }
    if (id === "codex-hooks") {
      return readExternalSourceFile(CODEX_HOOKS, "Codex hooks", "~/.codex/hooks.json", "json");
    }
    return fail(`unknown config file: ${id}`);
  }

  if (kind === "live-rules") {
    const live = readLiveRulesFile(harnessSafe);
    if (!live.installed && !live.content) return fail(`live rules file not found: ${harnessSafe}`);
    const file = harnessSafe === "codex" ? "~/.codex/AGENTS.md" : "~/.claude/CLAUDE.md";
    return { ok: true, title: `Live rules — ${harnessSafe}`, path: file, content: live.content, html: live.html };
  }

  if (kind === "rules" || kind === "hooks") {
    // Resolve the package's component source from the catalog — never trust a caller-supplied path.
    const pkgs = loadPackageCatalog();
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

function readSkillSource(abs, title, inventory = null) {
  const resolved = path.resolve(abs);
  const source = (resolved === repoRoot || resolved.startsWith(repoRoot + path.sep))
    ? readSourceFile(resolved, title)
    : readExternalSkillSource(resolved, title);
  if (!source.ok) return source;
  const parsed = parseSkillMarkdown(source.content);
  return {
    ...source,
    html: renderSkillSourceHtml({
      title,
      meta: parsed.meta,
      body: parsed.body,
      contextFiles: listSkillContextFiles(path.dirname(path.resolve(abs))),
      inventory,
    }),
  };
}

function readExternalSkillSource(abs, title) {
  try {
    const content = fs.readFileSync(abs, "utf8");
    return { ok: true, title, path: abs, content, html: renderMarkdown(content) };
  } catch {
    return { ok: false, error: `not found: ${abs}` };
  }
}

function parseSkillMarkdown(content) {
  const normalized = String(content ?? "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!match) return { meta: {}, body: normalized };
  return {
    meta: parseSkillFrontmatter(match[1]),
    body: match[2],
  };
}

function parseSkillFrontmatter(frontmatter) {
  const lines = frontmatter.split("\n");
  const meta = {};
  for (let i = 0; i < lines.length; i += 1) {
    const keyValue = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(lines[i]);
    if (!keyValue) continue;
    const [, key, rawValue = ""] = keyValue;
    if (rawValue === ">" || rawValue === "|") {
      const block = [];
      while (i + 1 < lines.length && /^(?:\s{2,}|\t)/.test(lines[i + 1])) {
        i += 1;
        block.push(lines[i].replace(/^(?:\s{2}|\t)/, ""));
      }
      meta[key] = block.join(rawValue === ">" ? " " : "\n").trim();
      continue;
    }
    meta[key] = rawValue.replace(/^["']|["']$/g, "").trim();
  }
  return meta;
}

function listSkillContextFiles(skillDir) {
  const files = [];
  collectSkillContextFiles(skillDir, "", files);
  return files.slice(0, 40);
}

function collectSkillContextFiles(baseDir, relDir, files) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(baseDir, relDir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "SKILL.md" || entry.name === ".roborepo-managed" || entry.name === ".DS_Store") continue;
    const rel = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      collectSkillContextFiles(baseDir, rel, files);
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
}

function renderCommandSourceHtml(title, content) {
  return [
    '<section class="source-section command-source">',
    `<div class="source-section-label">${escapeHtml(title)}</div>`,
    renderMarkdown(content),
    "</section>",
  ].join("\n");
}

function renderSkillSourceHtml({ title, meta, body, contextFiles, inventory }) {
  const triggerDescription = meta.description || "(no trigger description)";
  const bodyHtml = body.trim()
    ? renderMarkdown(body)
    : '<p class="source-empty">(no skill body)</p>';
  const contextHtml = contextFiles.length
    ? `<ul>${contextFiles.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join("")}</ul>`
    : '<p class="source-empty">No additional context files.</p>';
  const inventoryHtml = inventory ? renderSkillInventoryHtml(inventory) : "";
  return [
    '<div class="skill-source-view">',
    inventoryHtml,
    '<section class="source-section skill-trigger">',
    '<div class="source-section-label">When the LLM should load this skill</div>',
    meta.name ? `<div class="skill-name"><code>${escapeHtml(meta.name)}</code></div>` : "",
    `<p>${escapeHtml(triggerDescription)}</p>`,
    "</section>",
    '<section class="source-section skill-body">',
    `<div class="source-section-label">${escapeHtml(title)} content</div>`,
    bodyHtml,
    "</section>",
    '<section class="source-section skill-context">',
    '<div class="source-section-label">Additional context bundled with this skill</div>',
    contextHtml,
    "</section>",
    "</div>",
  ].join("\n");
}

function renderSkillInventoryHtml(inventory) {
  const harnessRows = Object.entries(inventory.harnesses).map(([harness, state]) => {
    const details = [
      state.linkTarget ? `link ${state.linkTarget}` : null,
      state.nativeMetadata.length ? `native metadata: ${state.nativeMetadata.map((m) => m.file).join(", ")}` : null,
    ].filter(Boolean).join(" · ");
    return `<li><strong>${escapeHtml(harness)}</strong>: ${escapeHtml(state.state)}${details ? ` <span>${escapeHtml(details)}</span>` : ""}</li>`;
  }).join("");
  const nativeMeta = inventory.nativeMetadata.length
    ? `<p>Native metadata: ${escapeHtml(inventory.nativeMetadata.map((m) => m.file).join(", "))}</p>`
    : "";
  return [
    '<section class="source-section skill-inventory">',
    '<div class="source-section-label">Install and ownership</div>',
    `<p>Ownership: ${escapeHtml(inventory.ownership)} · Managed: ${inventory.managed ? "yes" : "no"} · Native collision: ${inventory.nativeCollision ? escapeHtml(inventory.nativeCollisions.join(", ")) : "no"}</p>`,
    `<p>Source: ${escapeHtml(inventory.source.path ? path.relative(repoRoot, inventory.source.path) : "native only")}</p>`,
    `<ul>${harnessRows}</ul>`,
    nativeMeta,
    "</section>",
  ].join("\n");
}

const ROOT_CONFIG_HARNESSES = {
  claude: { active: rootConfigActive.claude, baseline: rootConfigBaseline.claude },
  codex: { active: rootConfigActive.codex, baseline: rootConfigBaseline.codex },
};

// One user-facing drift "state" per harness, plus the raw drift details. This is the SINGLE SOURCE
// OF TRUTH for both the terminal `roborepo config root inspect` report and the web /config panel —
// the snapshot ships buildRootConfigView() under `rootConfig` so neither surface recomputes the
// state label. States:
//   not-installed  — no active file on disk.
//   in-sync        — active file matches roborepo's last recorded write ("clean").
//   drifted        — active file changed since roborepo's last write.
//   staged-pending — a *_update_TIMESTAMP baseline sits beside the active file (a `keep`-policy
//                    install/update left the new baseline staged for the user to reconcile).
//   unwritten      — no recorded roborepo write yet (pre-dates drift tracking, or never installed
//                    via roborepo).
// staged-pending is reported when a staged sibling exists regardless of drift status, because a
// pending staged update is the actionable thing to surface even on an otherwise-clean file.
function describeDrift(harness, { active, baseline }) {
  const activeExists = fs.existsSync(active);
  const baselineExists = fs.existsSync(baseline);
  const drift = activeExists ? checkDrift(harness, active) : { status: "missing" };
  const stagedUpdate = activeExists ? findSiblingArtifact(active, "update") : null;

  let state;
  if (!activeExists) state = "not-installed";
  else if (stagedUpdate) state = "staged-pending";
  else if (drift.status === "clean") state = "in-sync";
  else if (drift.status === "drifted") state = "drifted";
  else state = "unwritten"; // covers "unwritten" and any other non-clean/non-drifted status

  return {
    harness,
    active,
    baseline,
    activeExists,
    baselineExists,
    state,
    stagedUpdate,
    lastHash: drift.lastHash ?? null,
    currentHash: drift.currentHash ?? null,
  };
}

// Per-harness root-config drift view, shared by the terminal report and the web portal.
export function buildRootConfigView() {
  return Object.entries(ROOT_CONFIG_HARNESSES).map(([harness, paths]) => describeDrift(harness, paths));
}

// Human-readable one-liner for a row's state, reused by the CLI report.
const ROOT_CONFIG_STATE_LABEL = {
  "not-installed": "not installed",
  "in-sync": "in sync (unchanged since roborepo's last write)",
  drifted: "drifted (changed since roborepo's last write)",
  "staged-pending": "staged update pending (a new baseline is staged beside the active file)",
  unwritten: "no recorded roborepo write yet (pre-dates drift tracking, or never installed via roborepo)",
};

// Read-only report of baseline vs. active root config vs. drift state, per harness. No writes —
// see docs/plans/completed/root-config-layered-inheritance.md for the update/repair behavior that acts on
// this same drift signal.
export function configRootInspect() {
  for (const row of buildRootConfigView()) {
    console.log(`\n${row.harness}`);
    console.log(`  baseline: ${row.baseline}${row.baselineExists ? "" : "  (missing)"}`);
    console.log(`  active:   ${row.active}${row.activeExists ? "" : "  (missing)"}`);
    console.log(`  status:   ${ROOT_CONFIG_STATE_LABEL[row.state] ?? row.state}`);
    if (row.state === "drifted") {
      console.log(`  last-known hash:  ${row.lastHash}`);
      console.log(`  current hash:     ${row.currentHash}`);
      console.log(`  run \`roborepo update\` to resolve — see docs/reference/internal/config-collision-handling.md`);
      // Codex owns a native profile mechanism for permanent personal config; point drifted Codex
      // users at it instead of re-drifting the managed baseline every update. Claude has no
      // equivalent, so this hint is Codex-only. See config-collision-handling.md "Codex Native Profiles".
      if (row.harness === "codex") {
        console.log(`  for a permanent personal slice, use a Codex profile (~/.codex/<name>.config.toml, --profile <name>)`);
      }
    }
    if (row.stagedUpdate) {
      console.log(`  staged update:    ${row.stagedUpdate}`);
    }
  }
  console.log("");
}

export function configCommand(args) {
  const [sub = "status", ...rest] = args;
  if (sub === "root") {
    const [rootSub] = rest;
    if (rootSub !== "inspect") {
      console.error("usage: roborepo config root inspect");
      process.exit(2);
    }
    return configRootInspect();
  }
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
      if (item.kind === "behavior") {
        const override = item.overridden ? `  (custom, default: ${item.defaultBucket})` : "";
        const codexNote = item.codexOnly ? "  [Codex only]" : item.noCodexAsk ? "  [no per-command ask on Codex]" : "";
        console.log(`  ${item.bucket.padEnd(6)} ${item.label}${override}${codexNote}`);
        if (item.description) console.log(`         ${item.description}`);
      } else if (item.kind === "arbitrary-list") {
        console.log(`  ${item.label}`);
        if (item.description) console.log(`    ${item.description}`);
        const show = (item.items || []).slice(0, 5);
        for (const c of show) {
          const override = c.overridden ? "  (custom)" : "";
          console.log(`    ${c.bucket.padEnd(6)} ${c.label}${override}`);
        }
        if ((item.items || []).length > 5) console.log(`    … (${item.items.length - 5} more — see: roborepo web)`);
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

  console.log("");
}

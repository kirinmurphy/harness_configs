import fs from "node:fs";
import path from "node:path";
import { repoRoot, harnessHome, rootConfigActive } from "./paths.mjs";
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
  readPackageCategories,
} from "./package-catalog.mjs";
import { buildPackageLiveState } from "./package-probes.mjs";
import { inspectSkill, skillInventorySource } from "./skill-inventory.mjs";
import { readLiveRulesFile } from "./config-live-rules.mjs";
import { buildRootConfigView } from "./root-config-view.mjs";
import { configRootInspect, printConfigStatus } from "./config-cli-print.mjs";
import {
  packageSkillIds,
  packageSlashCommands,
  readExternalSourceFile,
  readSourceFile,
  readSkillSource,
} from "./config-source-lookup.mjs";
import { renderCommandSourceHtml } from "./config-source-render.mjs";
import { buildContextCost } from "./context-cost.mjs";

const PRESETS_PATH = path.join(repoRoot, "manifests", "platform", "presets.json");
const CLAUDE_SETTINGS = rootConfigActive.claude;
const CODEX_CONFIG = rootConfigActive.codex;
const CODEX_HOOKS = path.join(harnessHome.codex, "hooks.json");

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function renderEntry(text) {
  return { text, html: renderMarkdown(text) };
}

export function readConfigSnapshot() {
  const allPackages = loadPackageCatalog({ includeUnavailable: true });
  const availablePackages = allPackages.filter((pkg) => isPackageAvailable(pkg));
  const presetsCatalog = readJson(PRESETS_PATH, { bundles: [], default: [] });
  const presetState = readJson(presetsStatePath, {});
  const telemetryState = readJson(path.join(telemetryDir, "state.json"), null);
  const settings = readJson(CLAUDE_SETTINGS, {});
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
    components: pkg.resources.map((c) => c.type),
    resources: pkg.resources.map((resource) => resource.type),
    presentation: pkg.presentation,
    sourceRoot: pkg.sourceRoot,
    skillIds: pkg.resources.filter((c) => c.type === "skill").map((c) => c.id),
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

  // Build tool list from package resources. installed = symlink at ~/.claude/skills/<name> exists.
  const skillsDir = path.join(harnessHome.claude, "skills");
  const tools = availablePackages
    .flatMap((pkg) => (pkg.resources || [])
      .filter((resource) => resource.type === "skill")
      .map((resource) => {
        const command = (resource.entrypoints || []).find((entrypoint) => entrypoint.type === "slash-command");
        return {
          id: resource.id,
          label: resource.id,
          packageId: pkg.id,
          invocation: resource.invocation,
          hasCommand: !!command,
          command: command?.name || null,
          description: command?.description || pkg.description || null,
          commandHarnesses: command?.harnesses || [],
          installed: fs.existsSync(path.join(skillsDir, resource.id)),
          inventory: inspectSkill(resource.id),
        };
      }))
    .filter((s) => !unavailableSkillIds.has(s.id));

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
  // Token-cost estimates need the full catalog objects (rule sources, sourceFile), which the
  // presentation `packages` list strips — so this is computed here from availablePackages, not
  // rebuilt from the snapshot. Cached by stat signature, so polling stays cheap.
  snapshot.contextCost = buildContextCost({
    catalog: availablePackages,
    enabledIds: packages.filter((pkg) => pkg.enabled).map((pkg) => pkg.id),
    tools,
  });
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
  const perms = snap.permissions;
  const categories = readPackageCategories();
  const byCategory = new Map(categories.map((category) => [category.id, { ...category, items: [] }]));
  const toolByPackage = new Map((snap.tools || []).map((tool) => [tool.packageId, tool]));
  const packageCosts = snap.contextCost?.packages || {};
  for (const item of snap.packages) {
    const section = byCategory.get(item.presentation?.category);
    if (!section) continue;
    section.items.push(packagePresentationItem(item, toolByPackage.get(item.id), packageCosts[item.id] || null));
  }

  const sections = categories
    .map((category) => byCategory.get(category.id))
    .filter((section) => section && section.items.length > 0)
    .map((section) => ({
      category: section.label,
      categoryId: section.id,
      items: section.items.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)),
      contextCost: sectionContextCost(section.items),
    }));

  return [
    ...sections,
    {
      category: "Permissions",
      kind: "permissions",
      // Permission entries are config syntax, not prompt text — never given a token number.
      contextCost: { label: "not-prompt-context" },
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

// Active rollups only count enabled items; potential totals let the UI show what enabling the
// rest would add without mixing disabled cost into the primary number.
function sectionContextCost(items) {
  const totals = {
    activeStartupTokens: 0,
    activeOnDemandTokens: 0,
    potentialStartupTokens: 0,
    potentialOnDemandTokens: 0,
  };
  for (const item of items) {
    const cost = item.contextCost;
    if (!cost) continue;
    totals.activeStartupTokens += cost.activeStartupTokens || 0;
    totals.activeOnDemandTokens += cost.activeOnDemandTokens || 0;
    totals.potentialStartupTokens += cost.startupTokens || 0;
    totals.potentialOnDemandTokens += cost.onDemandTokens || 0;
  }
  return totals;
}

function packagePresentationItem(item, tool, contextCost = null) {
  const command = tool?.command || null;
  const resources = item.resources || item.components || [];
  const inspect = command
    ? {
        kind: "command-skill",
        id: command,
        skill: tool.id,
        harness: (tool.commandHarnesses || []).includes("claude") ? "claude" : (tool.commandHarnesses || [])[0] || "claude",
        label: `/${command}`,
      }
    : resources.includes("skill") && item.skillIds?.length
      ? { kind: "skill", id: item.skillIds[0], label: item.label }
      : resources.includes("rules")
        ? { kind: "rules", id: item.id, label: item.label }
        : null;
  return {
    id: item.id,
    label: command ? `/${command}` : item.label,
    description: item.description,
    order: item.presentation?.order || 0,
    active: item.enabled,
    toggle: "package",
    urls: item.urls || [],
    badges: [
      ...(item.catalogStatus === "pending" ? ["pending"] : []),
      ...(item.status && item.status !== "enabled" && item.status !== "disabled" ? [item.status] : []),
    ],
    resources,
    inspect,
    contextCost,
    hint: item.id === "telemetry" && item.enabled ? "roborepo serve" : null,
  };
}

// Read the full source that DEFINES a tool, for the /config click-to-inspect popup. Strictly
// whitelisted: kind+id are resolved against the catalogs/known dirs, never used to build a path
// directly, so an attacker can't request arbitrary files (no traversal — ids are matched against
// catalog entries and basenames only). Returns { ok, title, path, content } or { ok:false, error }.
export function loadConfigSource({ kind, id, harness = "claude" }) {
  const harnessSafe = harness === "codex" ? "codex" : "claude";
  const fail = (error) => ({ ok: false, error });

  if (kind === "skill") {
    if (!packageSkillIds().has(id)) return fail(`unknown skill: ${id}`);
    const source = skillInventorySource(id);
    if (!source.ok) return fail(source.error);
    return readSkillSource(source.item.inspectPath, `skill: ${id}`, source.item);
  }

  if (kind === "command") {
    const cmd = packageSlashCommands().find((c) => c.name === id);
    if (!cmd) return fail(`unknown command: ${id}`);
    const abs = path.join(repoRoot, "generated", "packages", cmd.packageId, harnessSafe, "commands", `${id}.md`);
    return readSourceFile(abs, `/${id} (${harnessSafe})`);
  }

  if (kind === "command-skill") {
    // id is the command NAME (no slash). Read both the generated command wrapper and the SKILL.md
    // it points at, so the popup shows the loading instruction plus the actual skill content.
    const cmd = packageSlashCommands().find((c) => c.name === id);
    if (!cmd) return fail(`unknown command: ${id}`);
    if (!cmd.skill || !packageSkillIds().has(cmd.skill)) return fail(`unknown skill for command: ${id}`);

    const commandAbs = path.join(repoRoot, "generated", "packages", cmd.packageId, harnessSafe, "commands", `${id}.md`);
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
      ? path.join(repoRoot, "generated", "codex", "hooks.json")
      : path.join(repoRoot, "generated", "claude", "settings.json");
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
  printConfigStatus(buildBehaviorView(snap));
}

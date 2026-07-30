// Shared paths for roborepo command modules.
//
// appRoot is the immutable application root: release files, built-ins, manifests, scripts, and CLI.
// workspaceRoot is the editable portable user workspace. In a development checkout it defaults to
// appRoot for backward compatibility; in package mode it defaults under ~/.roborepo/workspace.
// stateRoot is machine-local state.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function envPath(name) {
  const value = process.env[name];
  return value ? path.resolve(value) : null;
}

function defaultAppRoot() {
  return path.resolve(here, "..", "..");
}

// Mode heuristic: a Git checkout (.git) or a dev-only local/skills dir means development mode;
// anything else (e.g. an extracted release tarball) is package mode. Because a `git clone` run from
// a copy stripped of .git would silently flip to package mode, ROBOREPO_MODE=development|package
// forces the mode explicitly for those edge cases.
function isDevelopmentCheckout(root) {
  const forced = process.env.ROBOREPO_MODE;
  if (forced === "development") return true;
  if (forced === "package") return false;
  return fs.existsSync(path.join(root, ".git")) || fs.existsSync(path.join(root, "local", "skills"));
}

export const appRoot = envPath("ROBOREPO_APP_ROOT") || defaultAppRoot();
export const stateRoot =
  envPath("ROBOREPO_STATE_ROOT") ||
  envPath("ROBOREPO_STATE_DIR") ||
  path.join(os.homedir(), ".roborepo");
export const developmentMode = isDevelopmentCheckout(appRoot);
export const packageMode = !developmentMode;
function selectedWorkspaceRoot() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(stateRoot, "workspace-root.json"), "utf8"));
    return data.workspaceRoot ? path.resolve(data.workspaceRoot) : null;
  } catch {
    return null;
  }
}
export const workspaceRoot =
  envPath("ROBOREPO_WORKSPACE_ROOT") ||
  selectedWorkspaceRoot() ||
  (developmentMode ? appRoot : path.join(stateRoot, "workspace"));

// Backward-compatible names for modules that still operate on release/built-in files.
export const repoRoot = appRoot;
export const sharedSkillsDir = path.join(appRoot, "globals", "system", "skills");
export const workspaceSkillsDir = path.join(workspaceRoot, "skills");
export const workspaceCommandsDir = path.join(workspaceRoot, "commands");
export const workspaceMcpServersPath = path.join(workspaceRoot, "mcp", "servers.json");
export const workspacePackagesDir = path.join(workspaceRoot, "packages");
export const workspaceOverridesDir = path.join(workspaceRoot, "overrides");

export function requireDevelopmentCheckout(action) {
  if (!packageMode) return;
  const suffix = action ? ` for ${action}` : "";
  console.error(`requires development checkout${suffix}: this roborepo install is running in package mode.`);
  console.error(`appRoot: ${appRoot}`);
  console.error("Use a Git checkout for built-in source changes, or write custom content to the workspace.");
  process.exit(1);
}

export function workspaceManifestPath(root = workspaceRoot) {
  return path.join(root, "workspace.json");
}

export function initializeWorkspace({ root = workspaceRoot, dryRun = false } = {}) {
  // In a development checkout workspaceRoot IS the checkout, so scaffolding these dirs would
  // litter the repo with untracked skills/ commands/ mcp/ packages/ overrides/ that also shadow
  // built-in resolution. Custom workspace content is a package-mode concept only.
  if (path.resolve(root) === path.resolve(appRoot) && developmentMode) {
    return { root, manifestPath: workspaceManifestPath(root), created: false };
  }
  const dirs = [
    root,
    path.join(root, "skills"),
    path.join(root, "commands"),
    path.join(root, "mcp"),
    path.join(root, "packages"),
    path.join(root, "overrides"),
  ];
  const manifestPath = workspaceManifestPath(root);
  const manifest = {
    schemaVersion: 1,
    kind: "roborepo-workspace",
    directories: {
      skills: "skills",
      commands: "commands",
      mcp: "mcp",
      packages: "packages",
      overrides: "overrides",
    },
  };

  if (dryRun) {
    for (const dir of dirs) console.log(`would create: ${dir}`);
    if (!fs.existsSync(manifestPath)) console.log(`would create: ${manifestPath}`);
    return { root, manifestPath, created: false };
  }

  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const mcpServersPath = path.join(root, "mcp", "servers.json");
  if (!fs.existsSync(mcpServersPath)) {
    fs.writeFileSync(mcpServersPath, `${JSON.stringify({ servers: [] }, null, 2)}\n`);
  }
  return { root, manifestPath, created: true };
}

// Harness home/root-config/live-store paths below are derived from each provider's manifest
// (globals/harnesses/<id>/provider.json, resolved via scripts/harnesses/paths.mjs) rather than
// hardcoded here — the manifest is the single source of truth for these home-relative locations
// now (Phase 3 of discoverable-harness-provider-architecture-plan.md). This module keeps the same
// plain-object-keyed-by-id export shape so existing consumers (presets.mjs, update-report.mjs,
// config.mjs, and everything using Object.keys(rootConfigActive) to iterate harnesses) are
// unaffected by the migration.
import { listHarnessProviders } from "../harnesses/registry.mjs";
import { resolveHarnessPath, hasHarnessPath } from "../harnesses/paths.mjs";

function pathById(key) {
  return Object.fromEntries(
    listHarnessProviders()
      .filter((provider) => hasHarnessPath(provider.manifest, key))
      .map((provider) => [provider.id, resolveHarnessPath(provider.manifest, key)])
  );
}

export const harnessHome = pathById("home");
// Root config baseline paths (the repo-tracked templates for mutable harness config). This is
// repo build output, not a harness's own home-relative location, so it is not part of the
// provider manifest's declarative paths — it stays hardcoded to generated/<id>/... here.
export const rootConfigBaseline = {
  claude: path.join(appRoot, "generated", "claude", "settings.json"),
  codex: path.join(appRoot, "generated", "codex", "config.toml"),
};
// Root config active paths (what the harness actually reads).
export const rootConfigActive = pathById("rootConfig");
// Claude's per-user MCP live store (~/.claude.json), distinct from ~/.claude/settings.json.
export const claudeJsonPath = resolveHarnessPath(
  listHarnessProviders().find((provider) => provider.id === "claude").manifest,
  "mcpLiveStore"
);
// Codex hooks live in a dedicated file, not inside config.toml — single source of truth for the
// live path (previously re-derived independently in package-probes.mjs, config.mjs, telemetry.mjs).
export const codexHooksPath = resolveHarnessPath(
  listHarnessProviders().find((provider) => provider.id === "codex").manifest,
  "hooks"
);

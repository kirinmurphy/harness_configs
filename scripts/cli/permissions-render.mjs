import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { repoRoot } from "./paths.mjs";

// Pure agent-permission render core. Lives under scripts/cli/ so the CLI stays self-contained
// (no reach into scripts/build/). The build entrypoint scripts/build/render-agent-permissions.mjs
// imports these to render the repo SOURCE (globals/); the config controls import renderProfileToHome
// to render a consumer's LIVE home config (~/.claude, ~/.codex).

const manifestPath = path.join(repoRoot, "manifests", "inventory", "agent-permissions.json");
const begin = "# BEGIN GENERATED AGENT PERMISSIONS";
const end = "# END GENERATED AGENT PERMISSIONS";

export function loadPermissionManifest(p = manifestPath) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function resolveProfile(manifest, profileName) {
  const name = profileName ?? manifest.default_profile;
  const profile = manifest.profiles?.[name];
  if (!profile) {
    const names = Object.keys(manifest.profiles ?? {}).join(", ");
    throw new Error(`unknown agent permission profile: ${name} (available: ${names})`);
  }
  return { name, profile };
}

function quoteToml(value) {
  return JSON.stringify(String(value));
}

function codexApprovalPolicy(profile) {
  return profile.approval === "never" ? "never" : "on-request";
}

function codexSandboxMode(profile) {
  return profile.filesystem === "read" ? "read-only" : "workspace-write";
}

function renderCodexPermissionBlock(profile, profileName) {
  const sandboxMode = codexSandboxMode(profile);
  const lines = [
    begin,
    `# Source: manifests/inventory/agent-permissions.json profile ${profileName}`,
    `approval_policy = ${quoteToml(codexApprovalPolicy(profile))}`,
    `sandbox_mode = ${quoteToml(sandboxMode)}`,
  ];

  if (sandboxMode === "workspace-write") {
    lines.push("", "[sandbox_workspace_write]", `network_access = ${profile.network ? "true" : "false"}`);
  }

  lines.push(end);
  return `${lines.join("\n")}\n`;
}

export function renderCodexConfig(current, profile, profileName, target) {
  const block = renderCodexPermissionBlock(profile, profileName);
  const oldBegin = "# BEGIN GENERATED CODEX PERMISSIONS";
  const oldEnd = "# END GENERATED CODEX PERMISSIONS";
  const start = current.includes(begin) ? current.indexOf(begin) : current.indexOf(oldBegin);
  const markerEnd = current.includes(begin) ? end : oldEnd;
  const finish = current.indexOf(markerEnd);

  if (start !== -1 || finish !== -1) {
    if (start === -1 || finish === -1 || finish < start) {
      throw new Error(`malformed generated permissions block in ${target}`);
    }
    const afterEnd = finish + markerEnd.length;
    const suffix = current.slice(afterEnd).replace(/^\n*/, "\n");
    return `${current.slice(0, start)}${block}${suffix}`;
  }

  const stripped = current
    .replace(/^approval_policy\s*=.*\n/m, "")
    .replace(/^sandbox_mode\s*=.*\n/m, "")
    .replace(/\n?\[sandbox_workspace_write\]\nnetwork_access\s*=.*\n/m, "\n");

  const marker = /^model_reasoning_effort\s*=.*\n/m;
  const match = marker.exec(stripped);
  if (!match) {
    return `${block}\n${stripped}`;
  }

  const insertAt = match.index + match[0].length;
  return `${stripped.slice(0, insertAt)}${block}\n${stripped.slice(insertAt).replace(/^\n+/, "")}`;
}

function renderCodexRule(pattern, decision) {
  const formattedPattern = `[${pattern.map((item) => JSON.stringify(String(item))).join(", ")}]`;
  return `prefix_rule(pattern=${formattedPattern}, decision=${JSON.stringify(decision)})`;
}

export function renderCodexRules(manifest) {
  const deny = manifest.commands?.deny ?? [];
  const allow = manifest.commands?.allow ?? [];
  return `${[
    ...deny.map((pattern) => renderCodexRule(pattern, "forbidden")),
    ...allow.map((pattern) => renderCodexRule(pattern, "allow")),
  ].join("\n")}\n`;
}

function commandToClaude(pattern) {
  const joined = pattern.map(String).join(" ");
  return `Bash(${joined}:*)`;
}

export function claudePermissions(manifest, profile) {
  const allow = [...(manifest.tools?.read ?? [])];
  if (profile.filesystem !== "read") {
    allow.push(...(manifest.tools?.write ?? []));
  }

  for (const [server, tools] of Object.entries(manifest.mcp ?? {})) {
    for (const tool of tools) {
      allow.push(`mcp__${server}__${tool}`);
    }
  }

  for (const pattern of manifest.commands?.allow ?? []) {
    allow.push(commandToClaude(pattern));
  }

  const deny = (manifest.commands?.deny ?? []).map(commandToClaude);
  return {
    allow: [...new Set(allow)],
    deny: [...new Set(deny)],
  };
}

// Merge generated permissions into existing Claude settings, preserving every other key
// (hooks, plugins, model, …). `current` may be "" for a fresh file.
//
// stampProfileName: when set, record the profile name under `roborepoProfile` so it can be read back
// unambiguously. Needed because some profiles share a Claude allow-list (interactive vs workspace
// differ only in Codex approval policy), so the allow-list alone can't identify the profile. The
// repo-source build render does NOT stamp (keeps globals/claude/settings.json free of runtime state).
export function renderClaudeSettings(current, manifest, profile, stampProfileName = null) {
  const settings = current.trim() ? JSON.parse(current) : {};
  settings.permissions = claudePermissions(manifest, profile);
  if (stampProfileName) settings.roborepoProfile = stampProfileName;
  return `${JSON.stringify(settings, null, 2)}\n`;
}

// Render a profile into the .claude/.codex config under `baseDir`. For scope "global" the base is
// the home dir (~/.claude, ~/.codex); for scope "project" it's a repo root (<repo>/.claude,
// <repo>/.codex), which the harness reads as a per-project override of the global config.
//
// createClaude: when true (project scope), create <baseDir>/.claude even if it doesn't exist, so a
// fresh project can be given a profile. When false (global scope), only write where the dir already
// exists — we never fabricate a missing harness home.
export function renderProfileTo(profileName, { baseDir, manifest = loadPermissionManifest(), createClaude = false } = {}) {
  const { name, profile } = resolveProfile(manifest, profileName);
  const claudeDir = path.join(baseDir, ".claude");
  const claudeSettings = path.join(claudeDir, "settings.json");
  const codexConfig = path.join(baseDir, ".codex", "config.toml");
  const touched = [];

  if (createClaude || fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
    const cur = fs.existsSync(claudeSettings) ? fs.readFileSync(claudeSettings, "utf8") : "";
    fs.writeFileSync(claudeSettings, renderClaudeSettings(cur, manifest, profile, name));
    touched.push(claudeSettings);
  }
  if (fs.existsSync(codexConfig)) {
    // Only rewrite Codex config if it already exists — we merge into a generated marker block and
    // don't want to fabricate a config.toml from nothing.
    const cur = fs.readFileSync(codexConfig, "utf8");
    fs.writeFileSync(codexConfig, renderCodexConfig(cur, profile, name, codexConfig));
    touched.push(codexConfig);
  }
  return { profile: name, touched };
}

// Back-compat shim: global-scope render into the home dir.
export function renderProfileToHome(profileName, { home = os.homedir(), manifest = loadPermissionManifest() } = {}) {
  return renderProfileTo(profileName, { baseDir: home, manifest });
}

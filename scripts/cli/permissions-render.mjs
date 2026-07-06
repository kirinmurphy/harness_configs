import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { repoRoot } from "./paths.mjs";

// Pure agent-permission render core. Lives under scripts/cli/ so the CLI stays self-contained
// (no reach into scripts/build/). The build entrypoint scripts/build/render-agent-permissions.mjs
// imports these to render the repo SOURCE (globals/); the config controls import renderPermissionsToHome
// to render a consumer's LIVE home config (~/.claude, ~/.codex).
//
// Flat model: manifest.behaviors is a small list of named, pinned actions (write files, delete
// files, go online, commit code, push/pull/PRs) — each one resolves to a single deny/ask/allow
// bucket, same as an arbitrary command. There is no separate "profile" bundle anymore; what used
// to be filesystem/approval/network profile dimensions are now just three of the named behaviors
// (write-files, <ask-bucket-derived-approval>, go-online) read directly off the flat list.

const manifestPath = path.join(repoRoot, "manifests", "inventory", "agent-permissions.json");
const begin = "# BEGIN GENERATED AGENT PERMISSIONS";
const end = "# END GENERATED AGENT PERMISSIONS";

export function loadPermissionManifest(p = manifestPath) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Merge personal overrides (keyed by behavior id) on top of the manifest's default buckets for
// the small set of named behaviors. Returns a NEW array; never mutates the manifest's own
// behavior objects. `overrides` here is the flat { behaviorId: bucket } shape — see
// config-mutate.mjs's behaviorOverridesFor for how the full override file maps to this.
export function resolveBehaviors(manifest, overrides = {}) {
  return (manifest.behaviors ?? []).map((b) => ({
    ...b,
    bucket: overrides[b.id] ?? b.bucket,
  }));
}

// Arbitrary (non-named) commands: manifest.commands.allow are the repo-tracked defaults (always
// "allow" — that array has no other bucket by construction), plus any personal additions/bucket
// changes from the override file's `commands` map (keyed by joined-token string, each entry
// { tokens, bucket }). An override commands entry whose key matches a manifest.commands.allow
// entry changes its bucket instead of duplicating it. Returns [{ tokens, bucket }, ...].
export function resolveArbitraryCommands(manifest, commandOverrides = {}) {
  const byKey = new Map();
  for (const tokens of manifest.commands?.allow ?? []) {
    byKey.set(tokens.map(String).join(" "), { tokens, bucket: "allow" });
  }
  for (const [key, entry] of Object.entries(commandOverrides)) {
    byKey.set(key, { tokens: entry.tokens, bucket: entry.bucket });
  }
  return [...byKey.values()];
}

function quoteToml(value) {
  return JSON.stringify(String(value));
}

// Codex has no per-command "ask" tier (see renderCodexRules below) — approval_policy is the
// session-wide fallback for anything without an explicit forbidden/allow rule. If at least one
// resolved behavior OR arbitrary command is "ask", something in the flat list needs that
// fallback to ever prompt, so approval_policy is "on-request". If nothing is "ask" (everything
// is a firm allow or deny), the fallback is never exercised and can safely be "never".
function codexApprovalPolicy(behaviors, arbitraryCommands) {
  return behaviors.some((b) => b.bucket === "ask") || arbitraryCommands.some((c) => c.bucket === "ask")
    ? "on-request"
    : "never";
}

function findBehavior(behaviors, id) {
  return behaviors.find((b) => b.id === id) ?? null;
}

// Filesystem write access derives from the write-files behavior specifically. "deny" or "ask"
// both mean Codex's sandbox should not be opened for arbitrary writes (ask has no per-command
// Codex tier, so the safer sandbox-level read-only default applies instead of silently allowing
// writes); only an explicit "allow" opens workspace-write.
function codexSandboxMode(behaviors) {
  const writeFiles = findBehavior(behaviors, "write-files");
  return writeFiles?.bucket === "allow" ? "workspace-write" : "read-only";
}

// Network access derives from the go-online behavior (Codex-only concept; Claude has no sandbox
// network gate at all, so this never affects claudePermissions).
function codexNetworkAccess(behaviors) {
  return findBehavior(behaviors, "go-online")?.bucket === "allow";
}

function renderCodexPermissionBlock(behaviors, arbitraryCommands) {
  const sandboxMode = codexSandboxMode(behaviors);
  const lines = [
    begin,
    "# Source: manifests/inventory/agent-permissions.json",
    `approval_policy = ${quoteToml(codexApprovalPolicy(behaviors, arbitraryCommands))}`,
    `sandbox_mode = ${quoteToml(sandboxMode)}`,
  ];

  if (sandboxMode === "workspace-write") {
    lines.push("", "[sandbox_workspace_write]", `network_access = ${codexNetworkAccess(behaviors) ? "true" : "false"}`);
  }

  lines.push(end);
  return `${lines.join("\n")}\n`;
}

export function renderCodexConfig(current, behaviors, arbitraryCommands, target) {
  const block = renderCodexPermissionBlock(behaviors, arbitraryCommands);
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

// Codex's prefix_rule decision is binary (forbidden/allow) — there is no per-command "ask" tier.
// A behavior/command resolved to "ask" gets NO rule at all: omitting a rule falls through to
// approval_policy (see codexApprovalPolicy above), which is Codex's actual equivalent of "always
// prompt." Writing forbidden or allow for an ask-bucket entry would misrepresent it. Named
// behaviors of kind "tools" or "network" have no command pattern at all and are skipped here —
// they're expressed via sandbox_mode/network_access instead (see renderCodexPermissionBlock).
export function renderCodexRules(manifest, overrides = {}) {
  const behaviors = resolveBehaviors(manifest, overrides.behaviors);
  const arbitraryCommands = resolveArbitraryCommands(manifest, overrides.commands);
  const lines = [];
  for (const b of behaviors) {
    if (b.kind !== "commands" || b.bucket === "ask") continue;
    const decision = b.bucket === "deny" ? "forbidden" : "allow";
    for (const pattern of b.commands ?? []) lines.push(renderCodexRule(pattern, decision));
  }
  for (const c of arbitraryCommands) {
    if (c.bucket === "ask") continue;
    lines.push(renderCodexRule(c.tokens, c.bucket === "deny" ? "forbidden" : "allow"));
  }
  return `${lines.join("\n")}\n`;
}

function commandToClaude(pattern) {
  const joined = pattern.map(String).join(" ");
  return `Bash(${joined}:*)`;
}

// Claude has a real 3-state permissions model (allow/deny/ask), so every resolved behavior and
// arbitrary command maps directly with no fallback/approximation needed — unlike the Codex side.
export function claudePermissions(manifest, overrides = {}) {
  const behaviors = resolveBehaviors(manifest, overrides.behaviors);
  const arbitraryCommands = resolveArbitraryCommands(manifest, overrides.commands);
  const allow = [...(manifest.tools?.read ?? [])];
  const deny = [];
  const ask = [];

  for (const b of behaviors) {
    if (b.kind === "tools") {
      if (b.bucket === "allow") allow.push(...(b.tools ?? []));
      // "deny"/"ask" for a tools-kind behavior (e.g. write-files) simply omits Write/Edit from
      // allow — Claude has no per-tool deny/ask list, only an allow list tools are granted from.
      continue;
    }
    if (b.kind === "network") continue; // Codex-only concept; no Claude equivalent to render.
    if (b.kind !== "commands") continue;
    const bucket = b.bucket === "deny" ? deny : b.bucket === "ask" ? ask : allow;
    for (const pattern of b.commands ?? []) bucket.push(commandToClaude(pattern));
  }

  for (const [server, tools] of Object.entries(manifest.mcp ?? {})) {
    for (const tool of tools) allow.push(`mcp__${server}__${tool}`);
  }
  for (const c of arbitraryCommands) {
    const bucket = c.bucket === "deny" ? deny : c.bucket === "ask" ? ask : allow;
    bucket.push(commandToClaude(c.tokens));
  }

  return {
    allow: [...new Set(allow)],
    deny: [...new Set(deny)],
    ask: [...new Set(ask)],
  };
}

// Merge generated permissions into existing Claude settings, preserving every other key
// (hooks, plugins, model, …). `current` may be "" for a fresh file.
export function renderClaudeSettings(current, manifest, overrides = {}) {
  const settings = current.trim() ? JSON.parse(current) : {};
  settings.permissions = claudePermissions(manifest, overrides);
  return `${JSON.stringify(settings, null, 2)}\n`;
}

// Render the manifest (+ overrides) into the .claude/.codex config under `baseDir`. Always
// global scope — no project override. `createClaude` retained for callers that might target a
// fresh directory (e.g. a scratch/test harness home); default global-only usage never needs it.
// `overrides` is the FULL override-file shape: { behaviors: {id: bucket}, commands: {key: {tokens, bucket}} }.
export function renderPermissionsTo(baseDir, { manifest = loadPermissionManifest(), overrides = {}, createClaude = false } = {}) {
  const behaviors = resolveBehaviors(manifest, overrides.behaviors);
  const arbitraryCommands = resolveArbitraryCommands(manifest, overrides.commands);
  const claudeDir = path.join(baseDir, ".claude");
  const claudeSettings = path.join(claudeDir, "settings.json");
  const codexConfig = path.join(baseDir, ".codex", "config.toml");
  const touched = [];

  if (createClaude || fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
    const cur = fs.existsSync(claudeSettings) ? fs.readFileSync(claudeSettings, "utf8") : "";
    fs.writeFileSync(claudeSettings, renderClaudeSettings(cur, manifest, overrides));
    touched.push(claudeSettings);
  }
  if (fs.existsSync(codexConfig)) {
    // Only rewrite Codex config if it already exists — we merge into a generated marker block and
    // don't want to fabricate a config.toml from nothing.
    const cur = fs.readFileSync(codexConfig, "utf8");
    fs.writeFileSync(codexConfig, renderCodexConfig(cur, behaviors, arbitraryCommands, codexConfig));
    touched.push(codexConfig);
  }
  return { touched };
}

// Back-compat shim: global-scope render into the home dir.
export function renderPermissionsToHome({ home = os.homedir(), manifest = loadPermissionManifest(), overrides = {} } = {}) {
  return renderPermissionsTo(home, { manifest, overrides });
}

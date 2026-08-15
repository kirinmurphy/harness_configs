// Pure agent-permission render core, extracted from scripts/cli/permissions-render.mjs so provider
// adapters (scripts/harnesses/{claude,codex}/index.mjs) can call it without importing
// scripts/cli/permissions-render.mjs directly — that module's top-level import of
// root-config-writes.mjs (used only by its orchestrator, renderPermissionsTo, never by the pure
// functions below) pulls in paths.mjs's registry-dependent half, which cycles back through
// registry.mjs into the importing provider itself. This module has zero such imports.
//
// Flat model: manifest.behaviors is a small list of named, pinned actions (write files, delete
// files, go online, commit code, push/pull/PRs) — each one resolves to a single deny/ask/allow
// bucket, same as an arbitrary command.

import os from "node:os";

const begin = "# BEGIN GENERATED AGENT PERMISSIONS";
const end = "# END GENERATED AGENT PERMISSIONS";

// Merge personal overrides (keyed by behavior id) on top of the manifest's default buckets for
// the small set of named behaviors. Returns a NEW array; never mutates the manifest's own
// behavior objects.
export function resolveBehaviors(manifest, overrides = {}) {
  return (manifest.behaviors ?? []).map((b) => ({
    ...b,
    bucket: overrides[b.id] ?? b.bucket,
  }));
}

// Arbitrary (non-named) commands: manifest.commands.allow are the repo-tracked defaults (always
// "allow"), plus any personal additions/bucket changes from the override file's `commands` map.
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
// session-wide fallback for anything without an explicit forbidden/allow rule.
function codexApprovalPolicy(behaviors, arbitraryCommands) {
  return behaviors.some((b) => b.bucket === "ask") || arbitraryCommands.some((c) => c.bucket === "ask")
    ? "on-request"
    : "never";
}

function findBehavior(behaviors, id) {
  return behaviors.find((b) => b.id === id) ?? null;
}

// Filesystem write access derives from the write-files behavior specifically. "deny" or "ask"
// both mean Codex's sandbox should not be opened for arbitrary writes; only an explicit "allow"
// opens workspace-write.
//
// This is also Codex's implementation of the platform's `repo-write-boundary` behavior. Codex has
// no per-path permission rules, so it cannot ask per write the way Claude's hook does; what it has
// is a sandbox whose writable area is the workspace. Leaving the boundary on therefore means
// `workspace-write` — writes stay inside the workspace and anything outside is refused by the
// sandbox rather than prompted. Switching the boundary off ("allow") is the only case where a
// wider `danger-full-access` would be correct, and that is deliberately NOT rendered here: opening
// the whole filesystem is a bigger step than turning off a prompt, and should be an explicit
// Codex-side choice rather than a side effect of a permissions toggle.
function codexSandboxMode(behaviors) {
  const writeFiles = findBehavior(behaviors, "write-files");
  return writeFiles?.bucket === "allow" ? "workspace-write" : "read-only";
}

// Network access derives from the go-online behavior (Codex-only concept; Claude has no sandbox
// network gate at all).
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
// approval_policy, Codex's actual equivalent of "always prompt."
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

// Claude path-scoped tool rules are `Tool(//absolute/glob)` — a leading `//` after the tool name,
// so a `~` in the manifest has to be expanded to a real home path at render time. The manifest
// stays machine-portable (it ships `~/projects/**`); only the rendered output is absolute.
function expandHome(p, home) {
  if (p === "~") return home;
  if (p.startsWith("~/")) return `${home}/${p.slice(2)}`;
  return p;
}

function scopedToolToClaude(tool, scopePath, home) {
  const abs = expandHome(scopePath, home).replace(/^\/+/, "");
  return `${tool}(//${abs})`;
}

// Claude has a real 3-state permissions model (allow/deny/ask), so every resolved behavior and
// arbitrary command maps directly with no fallback/approximation needed — unlike the Codex side.
export function claudePermissions(manifest, overrides = {}, { home = os.homedir() } = {}) {
  const behaviors = resolveBehaviors(manifest, overrides.behaviors);
  const arbitraryCommands = resolveArbitraryCommands(manifest, overrides.commands);
  const allow = [...(manifest.tools?.read ?? [])];
  const deny = [];
  const ask = [];

  // A gate behavior gets the final say over its scoped partner: when the gate is not "allow",
  // the scoped rules it governs are dropped entirely rather than rendered, so flipping the gate
  // to deny/ask actually shuts the tool off instead of leaving the scoped allows standing.
  const gateFor = new Map();
  for (const b of behaviors) {
    if (b.kind === "tools-gate" && b.scopedBy) gateFor.set(b.scopedBy, b.bucket);
  }

  for (const b of behaviors) {
    if (b.kind === "tools") {
      if (b.bucket === "allow") allow.push(...(b.tools ?? []));
      continue;
    }
    // The gate itself renders nothing: an unscoped `Write`/`Edit` entry would out-rank every
    // path-scoped rule and defeat the scoping it exists to enable.
    if (b.kind === "tools-gate") continue;
    if (b.kind === "tools-scoped") {
      const gate = gateFor.get(b.id);
      if (gate !== undefined && gate !== "allow") continue;
      const bucket = b.bucket === "deny" ? deny : b.bucket === "ask" ? ask : allow;
      for (const tool of b.tools ?? []) {
        for (const scopePath of b.paths ?? []) bucket.push(scopedToolToClaude(tool, scopePath, home));
      }
      continue;
    }
    // A repo-scope behavior states an intent no permission rule can express — the boundary is the
    // checkout the session is in, and rule paths are literal. Each provider enforces it in whatever
    // mechanism it has (Claude: a PreToolUse hook; Codex: its workspace sandbox), so the platform
    // renders nothing here and the bucket travels to the provider instead.
    if (b.kind === "repo-scope") continue;
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

// Merge generated permissions into existing Claude settings, preserving every other key except
// `model`. Global roborepo settings must not pin Claude's model; leave that to the harness/user.
export function renderClaudeSettings(current, manifest, overrides = {}) {
  const settings = current.trim() ? JSON.parse(current) : {};
  delete settings.model;
  settings.permissions = claudePermissions(manifest, overrides);
  return `${JSON.stringify(settings, null, 2)}\n`;
}

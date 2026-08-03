import { MCP_SCOPES, MCP_TRANSPORTS } from "./mcp-config.mjs";
import { hasHarnessProvider, listHarnessProviders } from "../harnesses/registry.mjs";

export function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function slugMcpName(value) {
  return value
    .replace(/^https?:\/\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .split("/")
    .pop()
    .replace(/\.git$/i, "")
    .replace(/-mcp$/i, "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function parseMcpAdd(rest, mcpPresets) {
  const opts = {
    scope: "user",
    name: null,
    transport: null,
    dryRun: false,
    // null = no --harness given at all -> every registered harness. A given --harness always
    // narrows to exactly the ids named, however many times the flag repeats.
    harnesses: null,
    updateClaudePermission: true,
    builtIn: false,
    passthrough: [],
  };
  const positional = [];
  let afterDoubleDash = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (afterDoubleDash) { opts.passthrough.push(arg); continue; }
    if (arg === "--") { afterDoubleDash = true; continue; }
    if (arg === "--dry-run") { opts.dryRun = true; continue; }
    if (arg === "--harness" || arg.startsWith("--harness=")) {
      const value = arg === "--harness" ? rest[++i] : arg.slice("--harness=".length);
      if (!value || value.startsWith("--")) {
        console.error(`--harness requires a value (one of: ${listHarnessProviders().map((p) => p.id).join(", ")})`);
        process.exit(2);
      }
      if (!hasHarnessProvider(value)) {
        console.error(`unknown harness: ${value} (one of: ${listHarnessProviders().map((p) => p.id).join(", ")})`);
        process.exit(2);
      }
      opts.harnesses ??= [];
      if (!opts.harnesses.includes(value)) opts.harnesses.push(value);
      continue;
    }
    if (arg === "--skip-claude-permission") { opts.updateClaudePermission = false; continue; }
    // Internal flag for the package-enable path: this add wires a built-in package's own preset,
    // which already lives in manifests/inventory/mcp-servers.json. Skip the workspace record so the
    // built-in is not duplicated into user workspace content (and does not trip the built-in guard).
    if (arg === "--builtin") { opts.builtIn = true; continue; }
    if (arg.startsWith("--scope=")) { opts.scope = arg.slice("--scope=".length); continue; }
    if (arg.startsWith("--name=")) { opts.name = arg.slice("--name=".length); continue; }
    if (arg.startsWith("--transport=")) { opts.transport = arg.slice("--transport=".length); continue; }
    if (arg.startsWith("--")) {
      console.error(`unknown flag for "mcp add": ${arg}`);
      process.exit(2);
    }
    positional.push(arg);
  }

  validateMcpOptions(opts, positional);
  const spec = resolveMcpSpec(positional[0], opts, mcpPresets);
  spec.args.push(...opts.passthrough);
  return { opts, spec };
}

function validateMcpOptions(opts, positional) {
  if (positional.length !== 1) {
    console.error(
      `usage: roborepo mcp add <name-or-url> [--scope=user|local|project] [--name=<name>] [--dry-run] [--harness <id>] [--skip-claude-permission]`,
    );
    process.exit(2);
  }
  if (!MCP_SCOPES.includes(opts.scope)) {
    console.error(`--scope must be ${MCP_SCOPES.join(", ")}`);
    process.exit(2);
  }
  if (opts.transport && !MCP_TRANSPORTS.includes(opts.transport)) {
    console.error(`--transport must be ${MCP_TRANSPORTS.join(", ")}`);
    process.exit(2);
  }
}

// opts.harnesses is null when --harness was never passed (all registered harnesses) or the
// deduped id list otherwise. Callers gating per-harness behavior (e.g. mcpAdd's Claude/Codex
// branches) want the concrete id set either way.
export function resolveMcpHarnesses(opts) {
  return opts.harnesses ?? listHarnessProviders().map((p) => p.id);
}

function resolveMcpSpec(input, opts, mcpPresets) {
  const preset = mcpPresets.get(input.toLowerCase());
  let spec;
  if (preset) {
    spec = { ...preset, args: [...preset.args] };
  } else if (isHttpUrl(input)) {
    spec = { name: opts.name || slugMcpName(input), commandOrUrl: input, args: [] };
    opts.transport ||= "http";
  } else {
    spec = { name: opts.name || slugMcpName(input), commandOrUrl: "uvx", args: [input] };
  }

  if (!spec.name) {
    console.error(`could not derive MCP server name; pass --name=<name>`);
    process.exit(2);
  }
  if (opts.name) spec.name = opts.name;
  return spec;
}

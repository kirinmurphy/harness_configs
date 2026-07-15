import { MCP_SCOPES, MCP_TRANSPORTS } from "./mcp-config.mjs";

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
    target: "all",
    updateClaudePermission: true,
    builtIn: false,
    passthrough: [],
  };
  const positional = [];
  let afterDoubleDash = false;

  for (const arg of rest) {
    if (afterDoubleDash) opts.passthrough.push(arg);
    else if (arg === "--") afterDoubleDash = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--only-claude") opts.target = opts.target === "only-codex" ? "conflict" : "only-claude";
    else if (arg === "--only-codex") opts.target = opts.target === "only-claude" ? "conflict" : "only-codex";
    else if (arg === "--skip-claude-permission") opts.updateClaudePermission = false;
    // Internal flag for the package-enable path: this add wires a built-in package's own preset,
    // which already lives in manifests/inventory/mcp-servers.json. Skip the workspace record so the
    // built-in is not duplicated into user workspace content (and does not trip the built-in guard).
    else if (arg === "--builtin") opts.builtIn = true;
    else if (arg.startsWith("--scope=")) opts.scope = arg.slice("--scope=".length);
    else if (arg.startsWith("--name=")) opts.name = arg.slice("--name=".length);
    else if (arg.startsWith("--transport=")) opts.transport = arg.slice("--transport=".length);
    else if (arg.startsWith("--")) {
      console.error(`unknown flag for "mcp add": ${arg}`);
      process.exit(2);
    } else positional.push(arg);
  }

  validateMcpOptions(opts, positional);
  const spec = resolveMcpSpec(positional[0], opts, mcpPresets);
  spec.args.push(...opts.passthrough);
  return { opts, spec };
}

function validateMcpOptions(opts, positional) {
  if (positional.length !== 1) {
    console.error(
      `usage: roborepo mcp add <name-or-url> [--scope=user|local|project] [--name=<name>] [--dry-run] [--only-claude|--only-codex] [--skip-claude-permission]`,
    );
    process.exit(2);
  }
  if (opts.target === "conflict") {
    console.error(`--only-claude and --only-codex are mutually exclusive`);
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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { roborepoSkillsDir, telemetryDir } from "./state-paths.mjs";
import { readEnabledPackagesRegistry } from "./rules-render.mjs";

const CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const CODEX_CONFIG = path.join(os.homedir(), ".codex", "config.toml");
const CODEX_HOOKS = path.join(os.homedir(), ".codex", "hooks.json");
const LIVE_RULE_FILES = {
  claude: path.join(os.homedir(), ".claude", "CLAUDE.md"),
  codex: path.join(os.homedir(), ".codex", "AGENTS.md"),
};

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function firstNonblankLine(relPath) {
  const content = readText(path.join(repoRoot, relPath), "");
  return content.split("\n").find((line) => line.trim()) || "";
}

function targetHarnesses(component) {
  if (component.harness === "both" || !component.harness) return ["claude", "codex"];
  return [component.harness];
}

function foldComponentState({ desired, observed, blocked = false }) {
  if (blocked) return "blocked";
  if (desired && observed) return "present";
  if (desired && !observed) return "missing";
  if (!desired && observed) return "external";
  return "absent";
}

function componentResult(component, { desired, observed, owner = "unknown", detail = null, blocked = false }) {
  return {
    type: component.type,
    id: component.id || component.name || component.preset || component.source || null,
    desired,
    observed,
    owner: observed ? owner : null,
    state: foldComponentState({ desired, observed, blocked }),
    detail,
  };
}

function probeRules(component, desired) {
  const signature = firstNonblankLine(component.source);
  const observedHarnesses = targetHarnesses(component).filter((harness) => {
    const live = readText(LIVE_RULE_FILES[harness], "");
    return !!signature && live.includes(signature);
  });
  return componentResult(component, {
    desired,
    observed: observedHarnesses.length > 0,
    owner: desired ? "roborepo" : "external",
    detail: observedHarnesses.length ? `rendered in ${observedHarnesses.join(", ")}` : "rules fragment not found in live files",
  });
}

function probeCommand(component, desired) {
  return componentResult(component, {
    desired,
    observed: desired,
    owner: desired ? "roborepo" : null,
    detail: desired ? "command is enabled through package registry" : "command is registry-gated",
  });
}

function probeHooks(component, desired, settings) {
  const fragment = readJson(path.join(repoRoot, component.source), {});
  const liveHooks = component.harness === "codex"
    ? readJson(CODEX_HOOKS, {}).hooks || readJson(CODEX_HOOKS, {})
    : settings.hooks || {};
  let expected = 0;
  let found = 0;
  for (const [event, entries] of Object.entries(fragment)) {
    const liveEntries = liveHooks[event] || [];
    for (const entry of entries) {
      const cmd = entry.hooks?.[0]?.command;
      if (!cmd) continue;
      expected += 1;
      if (liveEntries.some((live) => (live.hooks || []).some((hook) => hook.command === cmd))) {
        found += 1;
      }
    }
  }
  return componentResult(component, {
    desired,
    observed: expected > 0 && found === expected,
    owner: desired ? "roborepo" : "external",
    detail: `${found}/${expected} hook command(s) present`,
  });
}

function probePermissions(component, desired, settings) {
  const allow = settings.permissions?.allow || [];
  const missing = (component.allow || []).filter((entry) => !allow.includes(entry));
  return componentResult(component, {
    desired,
    observed: missing.length === 0,
    owner: desired ? "roborepo" : "external",
    detail: missing.length ? `${missing.length} permission(s) missing` : `${(component.allow || []).length} permission(s) present`,
  });
}

function probePlugin(component, desired, settings) {
  const observed = settings.enabledPlugins?.[component.id] === true;
  return componentResult(component, {
    desired,
    observed,
    owner: desired ? "roborepo" : "external",
    detail: observed ? "enabled in Claude settings" : "not enabled in Claude settings",
  });
}

function probeMcp(component, desired, settings) {
  const name = component.preset;
  const codexConfig = readText(CODEX_CONFIG, "");
  const observed =
    !!settings.mcpServers?.[name] ||
    codexConfig.includes(`[mcp_servers.${name}]`) ||
    codexConfig.includes(`[mcp_servers."${name}"]`);
  return componentResult(component, {
    desired,
    observed,
    owner: desired ? "roborepo" : "external",
    detail: observed ? "MCP preset found in live config" : "MCP preset not found in live config",
  });
}

function probeService(component, desired, telemetryState) {
  const observed = component.id === "telemetry" ? telemetryState?.enabled === true : false;
  return componentResult(component, {
    desired,
    observed,
    owner: observed ? "roborepo" : null,
    detail: observed ? "service state enabled" : "service state disabled or missing",
  });
}

function probeSkill(component, desired) {
  const cachePath = path.join(roborepoSkillsDir, component.id);
  const observed = fs.existsSync(cachePath);
  const managed = fs.existsSync(path.join(cachePath, ".roborepo-managed"));
  return componentResult(component, {
    desired,
    observed,
    owner: managed ? "roborepo" : observed ? "external" : null,
    detail: observed ? `cache ${managed ? "managed" : "unmanaged"}: ${cachePath}` : "skill cache missing",
  });
}

function dependencyComponents(pkg, packageStatusById) {
  return (pkg.requires || []).map((id) => {
    const dep = packageStatusById.get(id);
    const observed = dep?.desired === true;
    return {
      type: "requires",
      id,
      desired: true,
      observed,
      owner: dep ? "roborepo" : null,
      state: observed ? "present" : "missing",
      detail: dep ? `dependency status: ${dep.status}` : "dependency not found",
    };
  });
}

function packageStatus({ desired, components }) {
  if (desired) {
    return components.some((component) => component.state === "missing" || component.state === "blocked")
      ? "partial"
      : "enabled";
  }
  return components.some((component) => component.state === "external") ? "external" : "disabled";
}

export function buildPackageLiveState(packages) {
  const registry = readEnabledPackagesRegistry();
  const settings = readJson(CLAUDE_SETTINGS, {});
  const telemetryState = readJson(path.join(telemetryDir, "state.json"), null);
  const byId = new Map();
  const out = [];

  for (const pkg of packages) {
    const baseDesired = registry.packages.includes(pkg.id);
    const components = [];

    for (const component of pkg.components || []) {
      const componentDesired = baseDesired;
      if (component.type === "rules") components.push(probeRules(component, componentDesired));
      else if (component.type === "command") components.push(probeCommand(component, componentDesired));
      else if (component.type === "hooks") components.push(probeHooks(component, componentDesired, settings));
      else if (component.type === "permissions") components.push(probePermissions(component, componentDesired, settings));
      else if (component.type === "plugin") components.push(probePlugin(component, componentDesired, settings));
      else if (component.type === "mcp") components.push(probeMcp(component, componentDesired, settings));
      else if (component.type === "service") components.push(probeService(component, componentDesired, telemetryState));
      else if (component.type === "skill") components.push(probeSkill(component, componentDesired));
      else components.push(componentResult(component, { desired: componentDesired, observed: false, detail: "unknown component type", blocked: componentDesired }));
    }

    const desired = baseDesired;
    const status = packageStatus({ desired, components });
    const summary = { desired, status, components };
    byId.set(pkg.id, summary);
    out.push([pkg.id, summary]);
  }

  for (const [id, summary] of out) {
    const pkg = packages.find((entry) => entry.id === id);
    const deps = dependencyComponents(pkg, byId);
    if (deps.length === 0) continue;
    const components = [...summary.components, ...deps];
    const ownComponents = (pkg.components || []).length > 0;
    const desired = ownComponents ? summary.desired : deps.every((dep) => dep.observed);
    byId.set(id, { desired, status: packageStatus({ desired, components }), components });
  }

  return byId;
}

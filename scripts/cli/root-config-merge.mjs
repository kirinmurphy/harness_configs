import fs from "node:fs";
import path from "node:path";
import { isMainModule } from "./roots.mjs";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function uniqueByJson(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function mergeArrays(repo, local, path = []) {
  const key = path[path.length - 1];
  if (key === "allow" || key === "deny") {
    return uniqueByJson([...(repo || []), ...(local || [])]);
  }
  return uniqueByJson([...(repo || []), ...(local || [])]);
}

function mergeObjects(repo, local, path = []) {
  const out = { ...(repo || {}) };
  for (const [key, localValue] of Object.entries(local || {})) {
    const repoValue = out[key];
    if (Array.isArray(repoValue) && Array.isArray(localValue)) {
      out[key] = mergeArrays(repoValue, localValue, path.concat(key));
      continue;
    }
    if (isPlainObject(repoValue) && isPlainObject(localValue)) {
      out[key] = mergeObjects(repoValue, localValue, path.concat(key));
      continue;
    }
    if (repoValue === undefined) {
      out[key] = localValue;
      continue;
    }
    out[key] = localValue;
  }
  return out;
}

export function mergeClaudeSettings(repoText, localText) {
  let repo = {};
  let local = {};
  try { repo = JSON.parse(repoText || "{}"); } catch {}
  try { local = JSON.parse(localText || "{}"); } catch {}

  const merged = mergeObjects(repo, local);
  if (local.hooks && isPlainObject(local.hooks) && isPlainObject(repo.hooks)) {
    merged.hooks = mergeObjects(repo.hooks, local.hooks);
  }
  if (local.permissions && isPlainObject(local.permissions) && isPlainObject(repo.permissions)) {
    merged.permissions = mergeObjects(repo.permissions, local.permissions);
    for (const key of ["allow", "deny"]) {
      if (Array.isArray(repo.permissions[key]) || Array.isArray(local.permissions[key])) {
        merged.permissions[key] = uniqueByJson([...(repo.permissions[key] || []), ...(local.permissions[key] || [])]);
      }
    }
  }
  if (local.enabledPlugins && isPlainObject(local.enabledPlugins) && isPlainObject(repo.enabledPlugins)) {
    merged.enabledPlugins = mergeObjects(repo.enabledPlugins, local.enabledPlugins);
  }
  if (local.extraKnownMarketplaces && isPlainObject(local.extraKnownMarketplaces) && isPlainObject(repo.extraKnownMarketplaces)) {
    merged.extraKnownMarketplaces = mergeObjects(repo.extraKnownMarketplaces, local.extraKnownMarketplaces);
  }
  delete merged.model;

  return `${JSON.stringify(merged, null, 2)}\n`;
}

function tomlHeader(line) {
  return /^\[[^\]]+\]$/.test(line.trim()) ? line.trim() : null;
}

function tomlKey(line) {
  const match = line.match(/^\s*([A-Za-z0-9_.-]+|"[^"]+"|'[^']+')\s*=/);
  return match?.[1] ?? null;
}

function extractTomlBlocks(text) {
  const lines = String(text || "").split(/\r?\n/);
  const blocks = [];
  let current = [];
  const flush = () => {
    if (current.length) {
      blocks.push(current.join("\n").trimEnd());
    }
    current = [];
  };

  for (const line of lines) {
    if (/^\[[^\]]+\]$/.test(line)) {
      flush();
      current.push(line);
      continue;
    }
    if (current.length) {
      current.push(line);
    }
  }
  flush();
  return blocks;
}

function splitTomlSections(text) {
  const sections = [];
  let current = { header: null, lines: [] };

  for (const line of String(text || "").split(/\r?\n/)) {
    const header = tomlHeader(line);
    if (header) {
      sections.push(current);
      current = { header, lines: [line] };
      continue;
    }
    current.lines.push(line);
  }
  sections.push(current);
  return sections.map((section) => ({
    ...section,
    lines: section.lines.filter((line, index, lines) => index < lines.length - 1 || line !== ""),
  }));
}

function mergeTomlSection(repoSection, localSection) {
  if (!localSection) return repoSection.lines;

  // Track each local key's line plus the contiguous comment/blank lines that immediately preceded
  // it, so a user's hand-written comment stays attached to the key it documents when we re-emit
  // local-only keys. Trailing comments with no following key are kept as loose extras.
  const localByKey = new Map();
  const pending = [];
  const localExtras = [];
  for (const line of localSection.lines.slice(localSection.header ? 1 : 0)) {
    const key = tomlKey(line);
    if (key) {
      localByKey.set(key, { line, comments: pending.slice() });
      pending.length = 0;
    } else {
      pending.push(line);
    }
  }
  for (const line of pending) {
    if (line.trim()) localExtras.push(line);
  }

  const seen = new Set();
  const merged = [];
  for (const line of repoSection.lines) {
    const key = tomlKey(line);
    if (key && localByKey.has(key)) {
      merged.push(localByKey.get(key).line);
      seen.add(key);
    } else {
      merged.push(line);
      if (key) seen.add(key);
    }
  }

  for (const [key, entry] of localByKey) {
    if (seen.has(key)) continue;
    merged.push(...entry.comments, entry.line);
  }
  for (const line of localExtras) {
    if (!merged.includes(line)) merged.push(line);
  }
  return merged;
}

export function mergeCodexConfig(repoText, localText) {
  const repoSections = splitTomlSections(repoText);
  const localSections = splitTomlSections(localText);
  const localByHeader = new Map(localSections.map((section) => [section.header, section]));
  const emitted = new Set();
  const out = [];

  for (const repoSection of repoSections) {
    const localSection = localByHeader.get(repoSection.header);
    emitted.add(repoSection.header);
    out.push(...mergeTomlSection(repoSection, localSection), "");
  }

  for (const localSection of localSections) {
    if (emitted.has(localSection.header)) continue;
    out.push(...localSection.lines, "");
  }

  const output = out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  return `${output}\n`;
}

export function mergeRootConfig(harness, repoText, localText) {
  if (harness === "codex") return mergeCodexConfig(repoText, localText);
  if (harness === "claude") return mergeClaudeSettings(repoText, localText);
  throw new Error(`unsupported harness: ${harness}`);
}

// Final content transform applied at write time, after merge. Lives here (not
// root-config-writes.mjs) alongside mergeClaudeSettings/mergeCodexConfig, and imports nothing
// beyond node builtins, so both root-config-writes.mjs and the Claude provider adapter
// (scripts/harnesses/claude/index.mjs) can depend on it without a cycle through paths.mjs's
// harness registry import.
export function normalizeRootConfigContent(harness, content) {
  if (harness !== "claude") return content;
  try {
    const settings = JSON.parse(content || "{}");
    delete settings.model;
    return `${JSON.stringify(settings, null, 2)}\n`;
  } catch {
    return content;
  }
}

// This block runs only as a standalone subprocess (scripts/install/install-lib.sh's
// export_user_config shells out to it as `node root-config-merge.mjs <harness> ...`) — never as an
// import, so it can safely load the provider registry here without the cycle every other export in
// this file avoids (registry.mjs's provider adapters import mergeClaudeSettings/mergeCodexConfig
// from this same file). Dispatches through the harness's own rootConfig.merge adapter instead of
// mergeRootConfig's hardcoded claude/codex branches, so any registered provider (Gemini included)
// works here with no further changes. Wrapped in an async IIFE (not a bare top-level await) since
// Node's top-level-await support inside a conditional block left an unsettled-promise warning and
// a hung process in practice.
if (isMainModule(import.meta.url)) {
  const [harness, repoPath, localPath, outPath] = process.argv.slice(2);
  if (!harness || !repoPath || !localPath || !outPath) {
    console.error("usage: root-config-merge.mjs <harness> <repoPath> <localPath> <outPath>");
    process.exit(2);
  }

  (async () => {
    const { getHarnessProvider } = await import("../harnesses/registry.mjs");
    const repoText = fs.existsSync(repoPath) ? fs.readFileSync(repoPath, "utf8") : "";
    const localText = fs.existsSync(localPath) ? fs.readFileSync(localPath, "utf8") : "";
    const merged = getHarnessProvider(harness).adapters.rootConfig.merge(repoText, localText);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, merged);
  })();
}

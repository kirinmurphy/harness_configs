import fs from "node:fs";
import path from "node:path";

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

function mergeClaudeSettings(repoText, localText) {
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

  const localByKey = new Map();
  const localExtras = [];
  for (const line of localSection.lines.slice(localSection.header ? 1 : 0)) {
    const key = tomlKey(line);
    if (key) localByKey.set(key, line);
    else if (line.trim()) localExtras.push(line);
  }

  const seen = new Set();
  const merged = [];
  for (const line of repoSection.lines) {
    const key = tomlKey(line);
    if (key && localByKey.has(key)) {
      merged.push(localByKey.get(key));
      seen.add(key);
    } else {
      merged.push(line);
      if (key) seen.add(key);
    }
  }

  for (const [key, line] of localByKey) {
    if (!seen.has(key)) merged.push(line);
  }
  if (localExtras.length) merged.push(...localExtras);
  return merged;
}

function mergeCodexConfig(repoText, localText) {
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

const [harness, repoPath, localPath, outPath] = process.argv.slice(2);
if (!harness || !repoPath || !localPath || !outPath) {
  console.error("usage: root-config-merge.mjs claude|codex <repoPath> <localPath> <outPath>");
  process.exit(2);
}

const repoText = fs.existsSync(repoPath) ? fs.readFileSync(repoPath, "utf8") : "";
const localText = fs.existsSync(localPath) ? fs.readFileSync(localPath, "utf8") : "";
const merged = harness === "codex"
  ? mergeCodexConfig(repoText, localText)
  : mergeClaudeSettings(repoText, localText);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, merged);

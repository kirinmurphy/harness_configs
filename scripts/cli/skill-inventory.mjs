import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot, sharedSkillsDir } from "./paths.mjs";
import { roborepoSkillsDir } from "./state-paths.mjs";
import { listSourceSkills } from "./skill-lib.mjs";

const HARNESSES = [
  { id: "claude", dir: path.join(os.homedir(), ".claude", "skills") },
  { id: "codex", dir: path.join(os.homedir(), ".codex", "skills") },
];

function exists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function statInfo(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    return {
      exists: true,
      isDirectory: stat.isDirectory(),
      isSymlink: stat.isSymbolicLink(),
      realpath: fs.realpathSync(filePath),
      linkTarget: stat.isSymbolicLink() ? fs.readlinkSync(filePath) : null,
    };
  } catch {
    return { exists: false, isDirectory: false, isSymlink: false, realpath: null, linkTarget: null };
  }
}

function readText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function parseSkillFrontmatter(content) {
  const normalized = String(content ?? "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) return {};
  const meta = {};
  const lines = match[1].split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const keyValue = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(lines[i]);
    if (!keyValue) continue;
    const [, key, rawValue = ""] = keyValue;
    if (rawValue === ">" || rawValue === "|") {
      const block = [];
      while (i + 1 < lines.length && /^(?:\s{2,}|\t)/.test(lines[i + 1])) {
        i += 1;
        block.push(lines[i].replace(/^(?:\s{2}|\t)/, ""));
      }
      meta[key] = block.join(rawValue === ">" ? " " : "\n").trim();
      continue;
    }
    meta[key] = rawValue.replace(/^["']|["']$/g, "").trim();
  }
  return meta;
}

function listContextFiles(skillDir) {
  const files = [];
  collectContextFiles(skillDir, "", files);
  return files.sort();
}

function collectContextFiles(baseDir, relDir, files) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(baseDir, relDir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "SKILL.md" || entry.name === ".roborepo-managed" || entry.name === ".DS_Store") continue;
    const rel = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      collectContextFiles(baseDir, rel, files);
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
}

function nativeMetadata(skillDir) {
  const files = [
    "agents/openai.yaml",
    "agents/openai.yml",
    "agents/claude.yaml",
    "agents/claude.yml",
    "plugin.json",
    ".codex-plugin/plugin.json",
    "skill.json",
  ];
  return files
    .filter((file) => exists(path.join(skillDir, file)))
    .map((file) => ({ file, path: path.join(skillDir, file) }));
}

function classifyPath(skillPath, cachePath) {
  const info = statInfo(skillPath);
  if (!info.exists) return { ...info, state: "absent", ownership: "absent", managed: false };

  const cacheInfo = statInfo(cachePath);
  const managedMarker = exists(path.join(info.realpath || skillPath, ".roborepo-managed"));
  const pointsAtCache = Boolean(cacheInfo.exists && info.realpath && cacheInfo.realpath && info.realpath === cacheInfo.realpath);
  const managed = pointsAtCache && managedMarker;
  return {
    ...info,
    state: managed ? "managed" : "unmanaged",
    ownership: managed ? "roborepo" : "native",
    managed,
    pointsAtCache,
    managedMarker,
  };
}

export function listSkillInventory() {
  const names = new Set(listSourceSkills(sharedSkillsDir));
  for (const { dir } of HARNESSES) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory() || entry.isSymbolicLink()) names.add(entry.name);
    }
  }
  return [...names].sort().map((name) => inspectSkill(name));
}

export function inspectSkill(name) {
  const sourcePath = path.join(sharedSkillsDir, name);
  const cachePath = path.join(roborepoSkillsDir, name);
  const source = statInfo(sourcePath);
  const cache = statInfo(cachePath);
  const managedSource = source.exists && exists(path.join(sourcePath, "SKILL.md"));
  const cacheManaged = cache.exists && exists(path.join(cache.realpath || cachePath, ".roborepo-managed"));
  const harnesses = {};
  const nativeCollisions = [];

  for (const harness of HARNESSES) {
    const skillPath = path.join(harness.dir, name);
    const state = classifyPath(skillPath, cachePath);
    const hasSkill = exists(path.join(state.realpath || skillPath, "SKILL.md"));
    const nativeFiles = state.exists ? nativeMetadata(state.realpath || skillPath) : [];
    harnesses[harness.id] = {
      path: skillPath,
      installed: state.exists,
      state: state.state,
      ownership: state.ownership,
      managed: state.managed,
      isSymlink: state.isSymlink,
      linkTarget: state.linkTarget,
      realpath: state.realpath,
      hasSkill,
      nativeMetadata: nativeFiles,
    };
    if (managedSource && state.exists && !state.managed) nativeCollisions.push(harness.id);
  }

  const inspectPath = managedSource
    ? sourcePath
    : HARNESSES.map((harness) => harnesses[harness.id].realpath).find(Boolean) || sourcePath;
  const skillMdPath = path.join(inspectPath, "SKILL.md");
  const skillMd = readText(skillMdPath, "");

  return {
    name,
    source: {
      path: managedSource ? sourcePath : null,
      exists: managedSource,
      ownership: managedSource ? "roborepo" : "native",
      managed: managedSource,
    },
    cache: {
      path: cachePath,
      exists: cache.exists,
      managed: cacheManaged,
      state: cache.exists ? (cacheManaged ? "managed" : "unmanaged") : "absent",
    },
    harnesses,
    managed: managedSource,
    ownership: managedSource ? "managed" : "unmanaged",
    nativeCollision: nativeCollisions.length > 0,
    nativeCollisions,
    frontmatter: parseSkillFrontmatter(skillMd),
    contextFiles: exists(inspectPath) ? listContextFiles(inspectPath) : [],
    nativeMetadata: exists(inspectPath) ? nativeMetadata(inspectPath) : [],
    inspectPath: exists(skillMdPath) ? skillMdPath : null,
  };
}

export function skillInventorySource(name) {
  const item = inspectSkill(name);
  if (!item.inspectPath) return { ok: false, error: `skill not found: ${name}`, item };
  return { ok: true, item, content: readText(item.inspectPath, "") };
}

export function formatSkillInspection(item) {
  const lines = [];
  lines.push(`skill: ${item.name}`);
  lines.push(`ownership: ${item.ownership}`);
  lines.push(`managed: ${item.managed ? "yes" : "no"}`);
  lines.push(`source: ${item.source.exists ? path.relative(repoRoot, item.source.path) : "(native only)"}`);
  lines.push(`cache: ${item.cache.state} ${item.cache.exists ? item.cache.path : "(missing)"}`);
  lines.push(`native collision: ${item.nativeCollision ? item.nativeCollisions.join(", ") : "no"}`);
  lines.push("");
  lines.push("harness install state:");
  for (const harness of HARNESSES) {
    const state = item.harnesses[harness.id];
    lines.push(`  ${harness.id}: ${state.state}`);
    lines.push(`    path: ${state.path}`);
    if (state.linkTarget) lines.push(`    link: ${state.linkTarget}`);
    if (state.realpath) lines.push(`    realpath: ${state.realpath}`);
    if (state.nativeMetadata.length) {
      lines.push(`    native metadata: ${state.nativeMetadata.map((m) => m.file).join(", ")}`);
    }
  }
  if (Object.keys(item.frontmatter).length) {
    lines.push("");
    lines.push("frontmatter:");
    for (const [key, value] of Object.entries(item.frontmatter)) {
      lines.push(`  ${key}: ${String(value).replace(/\s+/g, " ").trim()}`);
    }
  }
  if (item.contextFiles.length) {
    lines.push("");
    lines.push("context files:");
    for (const file of item.contextFiles) lines.push(`  ${file}`);
  }
  if (item.nativeMetadata.length) {
    lines.push("");
    lines.push("native-only metadata:");
    for (const meta of item.nativeMetadata) lines.push(`  ${meta.file}`);
  }
  return lines.join("\n");
}

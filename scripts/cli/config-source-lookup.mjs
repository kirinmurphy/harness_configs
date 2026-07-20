import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { renderMarkdown } from "./markdown-render.mjs";
import { loadPackageCatalog } from "./package-catalog.mjs";
import { renderSkillSourceHtml } from "./config-source-render.mjs";

export function packageSkillIds() {
  return new Set(
    loadPackageCatalog()
      .flatMap((pkg) => (pkg.resources || []).filter((resource) => resource.type === "skill").map((resource) => resource.id)),
  );
}

export function packageSlashCommands() {
  const commands = [];
  for (const pkg of loadPackageCatalog()) {
    for (const resource of pkg.resources || []) {
      if (resource.type === "skill") {
        for (const entrypoint of resource.entrypoints || []) {
          if (entrypoint.type === "slash-command") commands.push({ name: entrypoint.name, skill: resource.id, packageId: pkg.id });
        }
      } else if (resource.type === "slash-command") {
        commands.push({ name: resource.name, source: path.join(pkg.sourceRoot, resource.source), packageId: pkg.id });
      }
    }
  }
  return commands;
}

export function readExternalSourceFile(abs, title, pathText, language = "json") {
  try {
    const content = fs.readFileSync(abs, "utf8");
    return {
      ok: true,
      title,
      path: pathText,
      content,
      html: renderMarkdown(`\`\`\`${language}\n${content.trimEnd()}\n\`\`\``),
    };
  } catch {
    return { ok: false, error: `not found: ${pathText}` };
  }
}

export function readSourceFile(abs, title) {
  // Defense in depth: the resolved path must stay inside the repo even though it's catalog-derived.
  const resolved = path.resolve(abs);
  if (resolved !== repoRoot && !resolved.startsWith(repoRoot + path.sep)) {
    return { ok: false, error: "path escapes repo" };
  }
  try {
    const content = fs.readFileSync(resolved, "utf8");
    return { ok: true, title, path: path.relative(repoRoot, resolved), content, html: renderMarkdown(content) };
  } catch {
    return { ok: false, error: `not found: ${path.relative(repoRoot, resolved)}` };
  }
}

export function readSkillSource(abs, title, inventory = null) {
  const resolved = path.resolve(abs);
  const source = (resolved === repoRoot || resolved.startsWith(repoRoot + path.sep))
    ? readSourceFile(resolved, title)
    : readExternalSkillSource(resolved, title);
  if (!source.ok) return source;
  const parsed = parseSkillMarkdown(source.content);
  const skillDir = path.dirname(resolved);
  const contextFiles = listSkillContextFiles(skillDir);
  return {
    ...source,
    html: renderSkillSourceHtml({
      title,
      meta: parsed.meta,
      body: parsed.body,
      contextFiles,
      references: readSkillReferenceFiles(skillDir, contextFiles),
      inventory,
    }),
  };
}

function readSkillReferenceFiles(skillDir, contextFiles) {
  const references = [];
  for (const file of contextFiles) {
    try {
      const content = fs.readFileSync(path.join(skillDir, file), "utf8");
      references.push({ file, content });
    } catch {
      // Skip unreadable files (e.g. broken symlink) rather than failing the whole popup.
    }
  }
  return references;
}

function readExternalSkillSource(abs, title) {
  try {
    const content = fs.readFileSync(abs, "utf8");
    return { ok: true, title, path: abs, content, html: renderMarkdown(content) };
  } catch {
    return { ok: false, error: `not found: ${abs}` };
  }
}

function parseSkillMarkdown(content) {
  const normalized = String(content ?? "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!match) return { meta: {}, body: normalized };
  return {
    meta: parseSkillFrontmatter(match[1]),
    body: match[2],
  };
}

function parseSkillFrontmatter(frontmatter) {
  const lines = frontmatter.split("\n");
  const meta = {};
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

function listSkillContextFiles(skillDir) {
  const files = [];
  collectSkillContextFiles(skillDir, "", files);
  return files.slice(0, 40);
}

function collectSkillContextFiles(baseDir, relDir, files) {
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
      collectSkillContextFiles(baseDir, rel, files);
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
}

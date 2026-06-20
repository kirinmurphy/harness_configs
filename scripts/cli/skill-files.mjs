import fs from "node:fs";
import path from "node:path";

/** List real skill folder names in srcDir (folder w/ SKILL.md, not a symlink, not dotted). */
export function listSourceSkills(srcDir) {
  let entries;
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = [];
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const full = path.join(srcDir, ent.name);
    if (fs.lstatSync(full).isSymbolicLink()) continue;
    if (!ent.isDirectory()) continue;
    if (!fs.existsSync(path.join(full, "SKILL.md"))) continue;
    names.push(ent.name);
  }
  return names.sort();
}

export function resolveClientSkillDirs(repoRoot, { create = false } = {}) {
  const candidates = [
    { dir: path.join(repoRoot, ".claude", "skills") },
    { dir: path.join(repoRoot, ".codex", "skills") },
  ];
  if (!create) return candidates.filter((c) => fs.existsSync(c.dir)).map((c) => c.dir);

  const dests = candidates.map((c) => c.dir);
  for (const d of dests) fs.mkdirSync(d, { recursive: true });
  return dests;
}

export function readlinkSafe(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink() ? fs.readlinkSync(p) : null;
  } catch {
    return null;
  }
}

export function ensureSymlink(srcAbs, target, { dryRun = false, uninstall = false } = {}) {
  const current = readlinkSafe(target);

  if (uninstall) {
    if (current === srcAbs) {
      if (!dryRun) fs.unlinkSync(target);
      return "unlinked";
    }
    return "skip";
  }

  if (current === srcAbs) return "ok";
  if (fs.existsSync(target) || current !== null) return "conflict";

  if (!dryRun) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(srcAbs, target);
    } catch (err) {
      if (err?.code === "EPERM" || err?.code === "EACCES") return "denied";
      throw err;
    }
  }
  return "linked";
}

export function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}

export function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

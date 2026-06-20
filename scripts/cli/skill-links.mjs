import fs from "node:fs";
import path from "node:path";
import { ensureSymlink, listSourceSkills, readlinkSafe } from "./skill-files.mjs";

// Source skills live at <repo>/.codex/skills/<name>/ — Codex reads there directly.
// Only .claude/skills/<name> needs a symlink; creating one in .codex/skills/ would be circular.
const LOCAL_LINK_PREFIX = path.join("..", "..", ".codex", "skills");

export function linkLocalSkills(repoRoot, { dryRun = false, uninstall = false, targetRoots = null } = {}) {
  const srcDir = path.join(repoRoot, ".codex", "skills");
  const harnessRoots =
    targetRoots ?? [path.join(repoRoot, ".claude")].filter((root) => fs.existsSync(root));
  const harnessDirs = harnessRoots.map((root) => path.join(root, "skills"));
  const names = listSourceSkills(srcDir);
  const tally = {
    linked: 0,
    ok: 0,
    conflicts: 0,
    unlinked: 0,
    denied: 0,
    pruned: 0,
    skills: names.length,
    targetDirs: harnessDirs.length,
  };

  for (const name of names) {
    const relTarget = path.join(LOCAL_LINK_PREFIX, name);
    for (const hdir of harnessDirs) {
      const target = path.join(hdir, name);
      const result = ensureSymlink(relTarget, target, { dryRun, uninstall });
      tally[
        { linked: "linked", unlinked: "unlinked", conflict: "conflicts", denied: "denied" }[result] ?? "ok"
      ]++;
      if (result === "linked") console.log(`link: ${target} -> ${relTarget}`);
      else if (result === "unlinked") console.log(`unlink: ${target}`);
      else if (result === "conflict") console.warn(`conflict: ${target} exists and points elsewhere — skipped`);
      else if (result === "denied")
        console.warn(`denied: ${target} — OS refused symlink (Windows: enable Developer Mode or run elevated)`);
    }
  }

  if (!uninstall) pruneOwnedLinks(harnessDirs, names, dryRun, tally);
  return tally;
}

function pruneOwnedLinks(harnessDirs, names, dryRun, tally) {
  const live = new Set(names);
  for (const hdir of harnessDirs) {
    let entries;
    try {
      entries = fs.readdirSync(hdir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const link = path.join(hdir, ent.name);
      const tgt = readlinkSafe(link);
      if (tgt === null) continue;
      if (path.dirname(tgt) !== LOCAL_LINK_PREFIX) continue;
      if (live.has(ent.name)) continue;
      if (!dryRun) fs.unlinkSync(link);
      console.log(`prune: ${link} (source gone)`);
      tally.pruned++;
    }
  }
}

import fs from "node:fs";
import path from "node:path";
import { harnessHome } from "./paths.mjs";
import { roborepoSkillsDir } from "./state-paths.mjs";

// An orphan is a symlink in a harness skill dir whose target no longer exists — almost always a
// skill that was removed from the repo while its per-harness pointer stayed behind.
//
// These are invisible to the other skill checks by construction. doctor's drift sweep globs
// "<skills>"/*/ , which only matches directories that resolve, and a dangling link never does;
// check_managed_skill iterates the skills roborepo expects rather than what is on disk, so an
// entry roborepo has forgotten is never enumerated. The harness itself sees a directory name it
// cannot read: no SKILL.md, so no description and no way to decide whether to load it.
//
// Only links pointing into the roborepo cache are considered. A dangling symlink to somewhere else
// is the user's own, and removing it is not this command's business.
export function findOrphanSkillLinks() {
  const orphans = [];
  for (const [harness, home] of Object.entries(harnessHome)) {
    const skillsDir = path.join(home, "skills");
    let names;
    try {
      names = fs.readdirSync(skillsDir).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const linkPath = path.join(skillsDir, name);
      let target;
      try {
        if (!fs.lstatSync(linkPath).isSymbolicLink()) continue;
        target = fs.readlinkSync(linkPath);
      } catch {
        continue;
      }
      // Resolves fine — not an orphan.
      if (fs.existsSync(linkPath)) continue;
      const resolved = path.resolve(path.dirname(linkPath), target);
      if (!resolved.startsWith(roborepoSkillsDir)) continue;
      orphans.push({ harness, name, linkPath, target: resolved });
    }
  }
  return orphans;
}

export function skillPruneOrphans(args = []) {
  const apply = args.includes("--apply");
  const orphans = findOrphanSkillLinks();

  if (!orphans.length) {
    console.log("ok: no orphaned skill links found");
    return 0;
  }

  for (const orphan of orphans) {
    console.log(`orphan: ${orphan.linkPath} -> ${orphan.target} (target gone)`);
  }

  if (!apply) {
    console.log("");
    console.log(`${orphans.length} orphaned skill link(s) found. Run: roborepo skill prune-orphans --apply`);
    return 0;
  }

  let removed = 0;
  for (const orphan of orphans) {
    try {
      fs.unlinkSync(orphan.linkPath);
      console.log(`removed: ${orphan.linkPath}`);
      removed += 1;
    } catch (error) {
      console.error(`fail: ${orphan.linkPath} — ${error.message}`);
    }
  }
  console.log("");
  console.log(`removed ${removed} orphaned skill link(s)`);
  return removed === orphans.length ? 0 : 1;
}

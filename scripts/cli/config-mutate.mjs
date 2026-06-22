import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { enablePackage, disablePackage, findPackage } from "./packages.mjs";
import { ensureSymlink, listSourceSkills, readlinkSafe } from "./skill-files.mjs";

// Shared mutation core for the interactive config controls (terminal `onboard` + web POST endpoints).
// Every function here is harness-agnostic and returns a plain { ok, message } result instead of
// calling process.exit, so the HTTP server can surface failures without dying. The terminal path
// reuses the same primitives and prints the message.

const SHARED_SKILLS_DIR = path.join(repoRoot, "globals", "agents", "skills");
// Both harnesses, matching link_global_skills in install-lib.sh. Only roots that exist are touched.
const HARNESS_SKILL_DIRS = [
  path.join(os.homedir(), ".claude", "skills"),
  path.join(os.homedir(), ".codex", "skills"),
];

// --------------------------------------------------------------------------- packages

export function mutatePackage(id, enabled, { dryRun = false } = {}) {
  if (!findPackage(id)) return { ok: false, message: `unknown package: ${id}` };
  try {
    const flags = dryRun ? ["--dry-run"] : [];
    if (enabled) enablePackage([id, ...flags]);
    else disablePackage([id, ...flags]);
    return { ok: true, message: `${enabled ? "enabled" : "disabled"}: ${id}` };
  } catch (err) {
    return { ok: false, message: String(err?.message || err) };
  }
}

// --------------------------------------------------------------------------- skills

// Node port of link_global_skills/link_skill_item (install-lib.sh): per-skill absolute-path symlink
// into every existing harness skills dir. Install validates the skill exists in shared source; native
// collisions (a real dir with the same name) are skipped, matching the bash behavior.
export function setSkillInstalled(id, enabled, { dryRun = false } = {}) {
  const known = listSourceSkills(SHARED_SKILLS_DIR);
  if (!known.includes(id)) return { ok: false, message: `unknown skill: ${id}` };

  const srcAbs = path.join(SHARED_SKILLS_DIR, id);
  const touched = [];
  for (const dir of HARNESS_SKILL_DIRS) {
    if (!fs.existsSync(path.dirname(dir))) continue; // harness not installed (no ~/.claude or ~/.codex)
    const target = path.join(dir, id);

    if (enabled) {
      const result = ensureSymlink(srcAbs, target, { dryRun });
      if (result === "conflict") {
        // A real (native-installed) skill dir of the same name. Leave it; surface as a skip.
        touched.push(`skip (native skill): ${target}`);
      } else if (result === "denied") {
        return { ok: false, message: `denied: ${target} — OS refused symlink` };
      } else if (result === "linked") {
        touched.push(`link: ${target}`);
      }
    } else {
      // Remove only our own managed symlink; never delete a real dir or a foreign link.
      if (readlinkSafe(target) === srcAbs) {
        if (!dryRun) fs.unlinkSync(target);
        touched.push(`unlink: ${target}`);
      }
    }
  }

  for (const line of touched) console.log(line);
  return { ok: true, message: `${enabled ? "installed" : "removed"} skill: ${id}` };
}

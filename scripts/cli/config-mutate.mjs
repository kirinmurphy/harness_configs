import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { enablePackage, disablePackage, findPackage } from "./packages.mjs";
import { ensureSymlink, listSourceSkills, readlinkSafe } from "./skill-files.mjs";
import { loadPermissionManifest, renderProfileTo } from "./permissions-render.mjs";
import { activeProfilePath } from "./state-paths.mjs";

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

export async function mutatePackage(id, enabled, { dryRun = false } = {}) {
  if (!findPackage(id)) return { ok: false, message: `unknown package: ${id}` };
  try {
    const flags = dryRun ? ["--dry-run"] : [];
    if (enabled) await enablePackage([id, ...flags]);
    else await disablePackage([id, ...flags]);
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

// --------------------------------------------------------------------------- permissions

// Looser profiles drop guardrails: workspace stops prompting before blocked actions, networked
// grants the sandbox internet access. The dashboard requires an explicit confirm before these.
export const LOOSER_PROFILES = new Set(["workspace", "networked"]);

export function listPermissionProfiles() {
  const manifest = loadPermissionManifest();
  return Object.keys(manifest.profiles ?? {});
}

export const PERMISSION_SCOPES = new Set(["global", "project"]);

// Switch a permission profile by rendering it into native harness config.
//   scope "global"  → ~/.claude/settings.json + ~/.codex/config.toml (machine-wide default).
//   scope "project" → <cwd>/.claude/settings.json + <cwd>/.codex/config.toml, which the harness
//                     reads as a per-project OVERRIDE of the global config (last-wins, not merged).
// The repo-source template (globals/) is never touched — this is an active runtime choice.
export function setPermissionProfile(profileName, { confirmedLooser = false, scope = "global", cwd = process.cwd() } = {}) {
  let manifest;
  try {
    manifest = loadPermissionManifest();
  } catch (err) {
    return { ok: false, message: `cannot read permission manifest: ${String(err?.message || err)}` };
  }
  if (!Object.keys(manifest.profiles ?? {}).includes(profileName)) {
    return { ok: false, message: `unknown profile: ${profileName}` };
  }
  if (!PERMISSION_SCOPES.has(scope)) {
    return { ok: false, message: `unknown scope: ${scope} (expected global | project)` };
  }
  if (LOOSER_PROFILES.has(profileName) && !confirmedLooser) {
    return { ok: false, needsConfirm: true, message: `'${profileName}' loosens safety — confirm to apply` };
  }
  try {
    // Project scope creates .claude on demand so a fresh repo can be given a profile; global scope
    // only writes harness homes that already exist.
    const baseDir = scope === "project" ? cwd : os.homedir();
    const { touched } = renderProfileTo(profileName, { baseDir, manifest, createClaude: scope === "project" });
    if (touched.length === 0) {
      return { ok: false, message: `no harness config found to write (${scope})` };
    }
    for (const t of touched) console.log(`profile ${profileName} (${scope}): ${t}`);
    if (scope === "global") {
      fs.mkdirSync(path.dirname(activeProfilePath), { recursive: true });
      fs.writeFileSync(activeProfilePath, JSON.stringify({ profile: profileName, updatedAt: new Date().toISOString() }, null, 2) + "\n");
    }
    return { ok: true, message: `permission profile set (${scope}): ${profileName}` };
  } catch (err) {
    return { ok: false, message: String(err?.message || err) };
  }
}

export function readActiveProfile() {
  try {
    return JSON.parse(fs.readFileSync(activeProfilePath, "utf8")).profile || null;
  } catch {
    return null;
  }
}

// The project-scope active profile is read from the `roborepoProfile` stamp that setPermissionProfile
// writes into <cwd>/.claude/settings.json. Returns null when there's no project override (the repo
// uses the global default). The stamp is authoritative because some profiles share a Claude
// allow-list, so the permissions alone can't identify the profile.
export function readProjectProfile(cwd = process.cwd()) {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(cwd, ".claude", "settings.json"), "utf8"));
    return settings?.roborepoProfile || null;
  } catch {
    return null;
  }
}

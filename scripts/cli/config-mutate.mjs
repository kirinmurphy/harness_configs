import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { enablePackage, disablePackage, findPackage } from "./packages.mjs";
import { listSourceSkills } from "./skill-files.mjs";
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
// Ownership marker written inside each roborepo-managed skill copy. Copies (not symlinks) carry no
// intrinsic "this is ours" signal, so the marker is how prune / native-skill detection tell a
// roborepo copy apart from a user's native skill of the same name.
const MANAGED_MARKER = ".roborepo-managed";

// A target is a roborepo-managed skill if it carries our marker (a copy) or is a legacy symlink
// into the shared source (a pre-copy install we should migrate or remove).
function isManagedSkill(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return fs.readlinkSync(target).startsWith(SHARED_SKILLS_DIR);
    return fs.existsSync(path.join(target, MANAGED_MARKER));
  } catch {
    return false;
  }
}

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

// Node port of link_global_skills/link_skill_item (install-lib.sh): materialize a shared skill as a
// roborepo-managed COPY into every existing harness skills dir, stamped with MANAGED_MARKER. Install
// validates the skill exists in shared source; a real dir without our marker is a native skill and is
// left untouched, matching the bash behavior. Copy (not symlink) keeps the machine state
// self-contained so it survives the source (repo/package) going away.
export function setSkillInstalled(id, enabled, { dryRun = false } = {}) {
  const known = listSourceSkills(SHARED_SKILLS_DIR);
  if (!known.includes(id)) return { ok: false, message: `unknown skill: ${id}` };

  const srcAbs = path.join(SHARED_SKILLS_DIR, id);
  const touched = [];
  for (const dir of HARNESS_SKILL_DIRS) {
    if (!fs.existsSync(path.dirname(dir))) continue; // harness not installed (no ~/.claude or ~/.codex)
    const target = path.join(dir, id);
    const exists = fs.existsSync(target) || isManagedSkill(target);

    if (enabled) {
      // A real dir without our marker is a native-installed skill. Leave it; surface as a skip.
      if (exists && !isManagedSkill(target)) {
        touched.push(`skip (native skill): ${target}`);
        continue;
      }
      if (!dryRun) {
        fs.rmSync(target, { recursive: true, force: true }); // clear a stale copy / legacy symlink
        fs.mkdirSync(dir, { recursive: true });
        fs.cpSync(srcAbs, target, { recursive: true });
        fs.writeFileSync(path.join(target, MANAGED_MARKER), "");
      }
      touched.push(`copy: ${target}`);
    } else {
      // Remove only our managed copy (or legacy managed symlink); never delete a native skill.
      if (isManagedSkill(target)) {
        if (!dryRun) fs.rmSync(target, { recursive: true, force: true });
        touched.push(`remove: ${target}`);
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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { enablePackage, disablePackage, findPackage } from "./packages.mjs";
import { loadPackageCatalog, unavailablePackageMessage } from "./package-catalog.mjs";
import { listSourceSkills } from "./skill-files.mjs";
import { loadPermissionManifest, renderPermissionsTo, resolveBehaviors, resolveArbitraryCommands } from "./permissions-render.mjs";
import { commandOverridesPath, roborepoSkillsDir } from "./state-paths.mjs";

// Shared mutation core for the interactive config controls (terminal `onboard` + web POST endpoints).
// Every function here is harness-agnostic and returns a plain { ok, message } result instead of
// calling process.exit, so the HTTP server can surface failures without dying. The terminal path
// reuses the same primitives and prints the message.

const SHARED_SKILLS_DIR = path.join(repoRoot, "globals", "system", "skills");
// Machine-local skill cache. Harness skill dirs point at these copies; the cache is the thing that
// survives across harness presence/absence and gives us one shared install source per machine.
const ROBOREPO_SKILLS_DIR = roborepoSkillsDir;
// Both harnesses, matching link_global_skills in install-lib.sh. Only roots that exist are touched.
const HARNESS_SKILL_DIRS = [
  path.join(os.homedir(), ".claude", "skills"),
  path.join(os.homedir(), ".codex", "skills"),
];
// Ownership marker written inside each roborepo-managed skill copy. Copies (not symlinks) carry no
// intrinsic "this is ours" signal, so the marker is how prune / native-skill detection tell a
// roborepo copy apart from a user's native skill of the same name.
const MANAGED_MARKER = ".roborepo-managed";

// A target is a roborepo-managed skill if it carries our marker inside the machine-local cache or
// is a legacy symlink into the shared source (a pre-cache install we should migrate or remove).
function isManagedSkill(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(target);
      return linkTarget.startsWith(ROBOREPO_SKILLS_DIR) || linkTarget.startsWith(SHARED_SKILLS_DIR);
    }
    return fs.existsSync(path.join(target, MANAGED_MARKER));
  } catch {
    return false;
  }
}

function skillCachePath(id) {
  return path.join(ROBOREPO_SKILLS_DIR, id);
}

function dirMatches(src, dest) {
  let srcEntries;
  let destEntries;
  try {
    srcEntries = fs.readdirSync(src, { withFileTypes: true });
    destEntries = fs.readdirSync(dest, { withFileTypes: true });
  } catch {
    return false;
  }
  const srcNames = srcEntries.map((ent) => ent.name).filter((name) => name !== MANAGED_MARKER).sort();
  const destNames = destEntries.map((ent) => ent.name).filter((name) => name !== MANAGED_MARKER).sort();
  if (srcNames.length !== destNames.length) return false;
  for (let i = 0; i < srcNames.length; i += 1) {
    if (srcNames[i] !== destNames[i]) return false;
  }
  for (const name of srcNames) {
    const srcPath = path.join(src, name);
    const destPath = path.join(dest, name);
    let srcStat;
    let destStat;
    try {
      srcStat = fs.lstatSync(srcPath);
      destStat = fs.lstatSync(destPath);
    } catch {
      return false;
    }
    if (srcStat.isDirectory() && destStat.isDirectory()) {
      if (!dirMatches(srcPath, destPath)) return false;
      continue;
    }
    if (srcStat.isSymbolicLink() || destStat.isSymbolicLink()) return false;
    if (srcStat.isFile() && destStat.isFile()) {
      if (!fs.readFileSync(srcPath).equals(fs.readFileSync(destPath))) return false;
      continue;
    }
    return false;
  }
  return true;
}

function ensureSkillCache(id, { dryRun = false } = {}) {
  const srcAbs = packageSkillSource(id) || path.join(SHARED_SKILLS_DIR, id);
  const cacheAbs = skillCachePath(id);
  const marker = path.join(cacheAbs, MANAGED_MARKER);
  if (!fs.existsSync(srcAbs)) return { ok: false, message: `unknown skill: ${id}` };

  if (fs.existsSync(cacheAbs) && !fs.lstatSync(cacheAbs).isDirectory()) {
    if (!dryRun) fs.rmSync(cacheAbs, { recursive: true, force: true });
  }
  if (fs.existsSync(cacheAbs) && fs.existsSync(marker) && dirMatches(srcAbs, cacheAbs)) {
    return { ok: true, message: `ok: ${cacheAbs}` };
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(cacheAbs), { recursive: true });
    fs.rmSync(cacheAbs, { recursive: true, force: true });
    fs.cpSync(srcAbs, cacheAbs, { recursive: true });
    fs.writeFileSync(marker, "");
  }
  return { ok: true, message: `copy: ${cacheAbs} <- ${srcAbs}` };
}

function linkSkillView(cacheAbs, target, { dryRun = false } = {}) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      const current = fs.readlinkSync(target);
      if (current === cacheAbs) return { state: "ok" };
      if (current.startsWith(ROBOREPO_SKILLS_DIR) || current.startsWith(SHARED_SKILLS_DIR)) {
        if (!dryRun) {
          fs.unlinkSync(target);
          fs.symlinkSync(cacheAbs, target);
        }
        return { state: "linked" };
      }
      return { state: "conflict" };
    }
    if (stat.isDirectory() && fs.existsSync(path.join(target, MANAGED_MARKER))) {
      if (!dryRun) {
        fs.rmSync(target, { recursive: true, force: true });
        fs.symlinkSync(cacheAbs, target);
      }
      return { state: "linked" };
    }
    return { state: "conflict" };
  } catch {
    if (!dryRun) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(cacheAbs, target);
    }
    return { state: "linked" };
  }
}

function pruneSkillViews(dir, allowedNames = [], dryRun = false) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const live = new Set(allowedNames);
  for (const ent of entries) {
    const link = path.join(dir, ent.name);
    let target = null;
    try {
      const stat = fs.lstatSync(link);
      if (!stat.isSymbolicLink()) continue;
      target = fs.readlinkSync(link);
    } catch {
      continue;
    }
    if (!target.startsWith(ROBOREPO_SKILLS_DIR) && !target.startsWith(SHARED_SKILLS_DIR)) continue;
    if (live.size > 0 && !live.has(ent.name)) {
      if (!dryRun) fs.unlinkSync(link);
      console.log(`prune: ${link} (not in base skill set)`);
      continue;
    }
    const cacheName = path.basename(target);
    if (!live.has(cacheName)) {
      if (!dryRun) fs.unlinkSync(link);
      console.log(`prune: ${link} (source removed)`);
    }
  }
}

// --------------------------------------------------------------------------- packages

export async function mutatePackage(id, enabled, { dryRun = false } = {}) {
  if (!findPackage(id)) {
    return { ok: false, message: unavailablePackageMessage(id) };
  }
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

// Node port of link_global_skills/link_skill_item (install-lib.sh): materialize a shared skill into
// the machine-local cache, then symlink each installed harness view to that cache entry. Install
// validates the skill exists in shared source; a real dir without our marker is a native skill and
// is left untouched, matching the bash behavior. The cache keeps the machine state self-contained
// so it survives the source (repo/package) going away.
export function setSkillInstalled(id, enabled, { dryRun = false } = {}) {
  const known = new Set([...packageSkillSources().keys(), ...listSourceSkills(SHARED_SKILLS_DIR)]);
  if (!known.has(id)) return { ok: false, message: `unknown skill: ${id}` };

  const cacheAbs = skillCachePath(id);
  const touched = [];
  if (enabled) {
    const cacheResult = ensureSkillCache(id, { dryRun });
    touched.push(cacheResult.message);
    for (const dir of HARNESS_SKILL_DIRS) {
      if (!fs.existsSync(path.dirname(dir))) continue;
      const target = path.join(dir, id);
      const view = linkSkillView(cacheAbs, target, { dryRun });
      if (view.state === "conflict") {
        touched.push(`skip (native skill): ${target}`);
        continue;
      }
      touched.push(view.state === "linked" ? `link: ${target} -> ${cacheAbs}` : `ok: ${target}`);
    }
  } else {
    if (!dryRun) fs.rmSync(cacheAbs, { recursive: true, force: true });
    touched.push(`remove: ${cacheAbs}`);
    for (const dir of HARNESS_SKILL_DIRS) {
      if (!fs.existsSync(path.dirname(dir))) continue;
      const target = path.join(dir, id);
      if (!isManagedSkill(target)) continue;
      if (!dryRun) fs.rmSync(target, { recursive: true, force: true });
      touched.push(`remove: ${target}`);
    }
  }

  for (const line of touched) console.log(line);
  return { ok: true, message: `${enabled ? "installed" : "removed"} skill: ${id}` };
}

function packageSkillSource(id) {
  return packageSkillSources().get(id) || null;
}

function packageSkillSources() {
  const sources = new Map();
  for (const pkg of loadPackageCatalog({ includeUnavailable: true })) {
    for (const resource of pkg.resources || []) {
      if (resource.type === "skill") sources.set(resource.id, path.join(pkg.sourceRoot, resource.source));
    }
  }
  return sources;
}

// --------------------------------------------------------------------------- permissions
//
// Flat model: every behavior (named — write-files, delete-files, go-online, commit-code,
// push-pull-prs — or arbitrary, user-added) is independently deny/ask/allow. Personal choices
// live in commandOverridesPath (state-paths.mjs), layered on top of the repo-tracked manifest's
// defaults at render time, so `roborepo update` re-rendering the manifest never wipes them.
// Global scope only — no per-project override (a detached web server has no reliable "current
// project" the way a terminal's cwd does).

// Deny/ask/allow are the only valid buckets a behavior/command can be set to. No "looser" concept
// remains — each behavior is independently reversible with the same three states, so there is no
// single "this drops all guardrails" action left to gate behind a confirm.
export const PERMISSION_BUCKETS = new Set(["deny", "ask", "allow"]);

// Arbitrary (non-named) commands are keyed by their joined tokens, e.g. ["docker", "run"] ->
// "docker run" — stable, human-readable, and matches how commandToClaude/renderCodexRule already
// join patterns for display.
function overrideKeyForCommand(tokens) {
  return tokens.map(String).join(" ");
}

export function readCommandOverrides() {
  try {
    const raw = JSON.parse(fs.readFileSync(commandOverridesPath, "utf8"));
    return {
      behaviors: raw.behaviors && typeof raw.behaviors === "object" ? raw.behaviors : {},
      commands: raw.commands && typeof raw.commands === "object" ? raw.commands : {},
    };
  } catch {
    return { behaviors: {}, commands: {} };
  }
}

function writeCommandOverrides(overrides) {
  fs.mkdirSync(path.dirname(commandOverridesPath), { recursive: true });
  fs.writeFileSync(commandOverridesPath, JSON.stringify(overrides, null, 2) + "\n");
}

// Set a NAMED behavior (by manifest id, e.g. "delete-files") to a bucket, or "default" to remove
// the override and revert to the manifest's own default for that behavior. Re-renders live global
// config immediately.
export function setBehaviorBucket(behaviorId, bucket) {
  if (bucket !== "default" && !PERMISSION_BUCKETS.has(bucket)) {
    return { ok: false, message: `unknown bucket: ${bucket} (expected deny | ask | allow | default)` };
  }
  let manifest;
  try {
    manifest = loadPermissionManifest();
  } catch (err) {
    return { ok: false, message: `cannot read permission manifest: ${String(err?.message || err)}` };
  }
  const known = (manifest.behaviors ?? []).some((b) => b.id === behaviorId);
  if (!known) return { ok: false, message: `unknown behavior: ${behaviorId}` };

  const overrides = readCommandOverrides();
  if (bucket === "default") delete overrides.behaviors[behaviorId];
  else overrides.behaviors[behaviorId] = bucket;
  return applyOverrides(manifest, overrides);
}

// Set an ARBITRARY command (not one of the named behaviors) to a bucket. `tokens` is the command
// split into argv-style parts, e.g. ["docker", "run"]. "default"/omitting removes it from the
// override file entirely (stops treating it as a tracked command).
export function setCommandBucket(tokens, bucket) {
  if (!Array.isArray(tokens) || tokens.length === 0 || !tokens.every((t) => typeof t === "string" && t)) {
    return { ok: false, message: "expected a non-empty array of command tokens" };
  }
  if (bucket !== "default" && !PERMISSION_BUCKETS.has(bucket)) {
    return { ok: false, message: `unknown bucket: ${bucket} (expected deny | ask | allow | default)` };
  }
  let manifest;
  try {
    manifest = loadPermissionManifest();
  } catch (err) {
    return { ok: false, message: `cannot read permission manifest: ${String(err?.message || err)}` };
  }
  const key = overrideKeyForCommand(tokens);
  const overrides = readCommandOverrides();
  if (bucket === "default") delete overrides.commands[key];
  else overrides.commands[key] = { tokens, bucket };
  return applyOverrides(manifest, overrides);
}

function applyOverrides(manifest, overrides) {
  try {
    writeCommandOverrides(overrides);
    const home = os.homedir();
    const { touched } = renderPermissionsTo(home, { manifest, overrides });
    if (touched.length === 0) {
      return { ok: false, message: "no harness config found to write" };
    }
    for (const t of touched) console.log(`permissions: ${t}`);
    return { ok: true, message: "permissions updated" };
  } catch (err) {
    return { ok: false, message: String(err?.message || err) };
  }
}

// Effective behaviors (manifest defaults + personal overrides layered on top) plus the arbitrary
// commands (manifest.commands.allow defaults + personal additions/bucket changes), each carrying
// override status for display. This is the single source both config.mjs's buildBehaviorView
// (portal + onboard + `config status`) and any future consumer should read from — it's the merge
// point, not the manifest alone.
export function effectivePermissions() {
  const manifest = loadPermissionManifest();
  const overrides = readCommandOverrides();
  const behaviors = resolveBehaviors(manifest, overrides.behaviors).map((b) => ({
    ...b,
    overridden: overrides.behaviors[b.id] != null,
    defaultBucket: manifest.behaviors.find((mb) => mb.id === b.id)?.bucket,
  }));
  const defaultAllowKeys = new Set((manifest.commands?.allow ?? []).map(overrideKeyForCommand));
  const arbitrary = resolveArbitraryCommands(manifest, overrides.commands).map((c) => {
    const key = overrideKeyForCommand(c.tokens);
    return {
      id: key,
      label: key,
      kind: "commands",
      commands: [c.tokens],
      bucket: c.bucket,
      overridden: overrides.commands[key] != null,
      defaultBucket: defaultAllowKeys.has(key) ? "allow" : null,
      arbitrary: true,
    };
  });
  return { behaviors, arbitrary };
}

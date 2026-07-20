import fs from "node:fs";
import path from "node:path";
import { codexHooksPath, harnessHome } from "./paths.mjs";
import { writeRootConfig } from "./root-config-writes.mjs";

// Cross-harness hook merge/unmerge. Both Claude (~/.claude/settings.json, hooks nested under a
// `hooks` key alongside permissions/etc.) and Codex (~/.codex/hooks.json, a dedicated file whose
// whole content is `{ hooks: {...} }`) use the same per-event entry shape:
//   { event: [ { matcher, hooks: [ { type: "command", command } ] } ] }
// Identity is the literal `command` string (matches the pre-existing Claude-only mergeHooks in
// packages.mjs) — no package-ID tag is stored on the entry itself. This keeps the merge/unmerge
// logic byte-for-byte compatible with hooks installed before this module existed.

// A plain object (not null, not an array) — some fixtures/older files use `[]` as an "empty hooks"
// sentinel, which must not be treated as a map: string-keyed writes onto an array silently vanish
// from JSON.stringify (arrays only serialize numeric indices).
function isHooksMap(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readHooksMap(harness, filePath) {
  if (harness === "codex") {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return isHooksMap(parsed.hooks) ? parsed.hooks : {};
    } catch {
      return {};
    }
  }
  try {
    const settings = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return isHooksMap(settings.hooks) ? settings.hooks : {};
  } catch {
    return {};
  }
}

function writeHooksMap(harness, filePath, hooksMap) {
  if (harness === "codex") {
    let parsed = {};
    try { parsed = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch {}
    parsed.hooks = hooksMap;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
    return;
  }
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch {}
  settings.hooks = hooksMap;
  writeRootConfig("claude", filePath, `${JSON.stringify(settings, null, 2)}\n`);
}

// Live hook file path for a harness: Claude's is the active root config (settings.json also holds
// permissions etc.); Codex's is the dedicated hooks.json, never config.toml.
export function hookFilePath(harness, { claudeSettingsPath } = {}) {
  if (harness === "codex") return codexHooksPath;
  return claudeSettingsPath;
}

export function mergeHooksInto(harness, filePath, hooksFragment, { dryRun = false } = {}) {
  if (dryRun) {
    console.log(`  [dry-run] merge hooks (${harness}) → ${filePath}`);
    return;
  }
  const hooks = readHooksMap(harness, filePath);
  let added = 0;
  for (const [event, entries] of Object.entries(hooksFragment)) {
    const existing = hooks[event] || [];
    // Prepend (not append): a package's own hooks may need to run before pre-existing entries for
    // the same event/matcher (e.g. a deny-decision hook must execute before an allow-decision one —
    // Claude's hook model treats the first decisive result as final). Preserve the fragment's own
    // internal entry order by prepending in reverse.
    for (const entry of [...entries].reverse()) {
      const cmd = entry.hooks?.[0]?.command;
      const alreadyPresent = cmd && existing.some((e) => (e.hooks || []).some((h) => h.command === cmd));
      if (!alreadyPresent) { existing.unshift(entry); added++; }
    }
    hooks[event] = existing;
  }
  if (added > 0) {
    writeHooksMap(harness, filePath, hooks);
    console.log(`wired: ${added} hook entries (${harness}) → ${filePath}`);
  } else {
    console.log(`ok: hooks already present (${harness}) → ${filePath}`);
  }
}

// True when writing into destDir would resolve (via a symlink at destDir itself, or any ancestor)
// back into the repo tree — e.g. a legacy dir-level `~/.claude/hooks -> <repo>/globals/claude/hooks`
// symlink. fs.copyFileSync/rmSync follow symlinks silently, so without this guard a package
// script install/remove would corrupt tracked repo source through the live symlink instead of
// writing to the machine's real live directory. Shared with slash-commands.mjs's live command
// install/removal, which writes into the same class of live harness directory (~/.claude/commands).
export function resolvesIntoRepo(destDir, repoRoot) {
  let real;
  try { real = fs.realpathSync(destDir); } catch { return false; } // doesn't exist yet: safe to create
  const resolvedRepoRoot = fs.realpathSync(repoRoot);
  return real === resolvedRepoRoot || real.startsWith(`${resolvedRepoRoot}${path.sep}`);
}

// Some hook fragments reference a command that runs a script this repo owns (e.g.
// "$HOME/.claude/hooks/block-source-exploration.mjs"). Merging the JSON fragment only wires the
// string reference — the script file itself must be copied into the harness's hooks dir
// separately, since (unlike the system hooks/ directory) package-owned hook scripts are not part of
// any unconditional manifest copy.
export function installHookScripts(harness, scriptRepoRelPaths, repoRoot, { dryRun = false } = {}) {
  const destDir = path.join(harnessHome[harness], "hooks");
  if (!dryRun && resolvesIntoRepo(destDir, repoRoot)) {
    console.error(`  refusing to install hook scripts: ${destDir} resolves into the repo tree (stale legacy symlink?)`);
    return;
  }
  for (const relPath of scriptRepoRelPaths) {
    const src = path.join(repoRoot, relPath);
    const dest = path.join(destDir, path.basename(relPath));
    if (dryRun) {
      console.log(`  [dry-run] install hook script ${relPath} → ${dest}`);
      continue;
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`copied: ${dest} ← ${relPath}`);
  }
}

export function removeHookScripts(harness, scriptRepoRelPaths, repoRoot, { dryRun = false } = {}) {
  const destDir = path.join(harnessHome[harness], "hooks");
  if (!dryRun && resolvesIntoRepo(destDir, repoRoot)) {
    console.error(`  refusing to remove hook scripts: ${destDir} resolves into the repo tree (stale legacy symlink?)`);
    return;
  }
  for (const relPath of scriptRepoRelPaths) {
    const dest = path.join(destDir, path.basename(relPath));
    if (dryRun) {
      console.log(`  [dry-run] remove hook script ${dest}`);
      continue;
    }
    if (fs.existsSync(dest)) {
      fs.rmSync(dest);
      console.log(`removed: ${dest}`);
    }
  }
}

export function unmergeHooksFrom(harness, filePath, hooksFragment, { dryRun = false } = {}) {
  if (dryRun) {
    console.log(`  [dry-run] remove hooks (${harness}) ← ${filePath}`);
    return;
  }
  const hooks = readHooksMap(harness, filePath);
  let removed = 0;
  for (const [event, entries] of Object.entries(hooksFragment)) {
    const cmds = new Set(entries.map((e) => e.hooks?.[0]?.command).filter(Boolean));
    const existing = hooks[event] || [];
    const next = existing.filter((e) => {
      const cmd = e.hooks?.[0]?.command;
      if (cmd && cmds.has(cmd)) { removed++; return false; }
      return true;
    });
    if (next.length) hooks[event] = next;
    else delete hooks[event];
  }
  if (removed > 0) {
    writeHooksMap(harness, filePath, hooks);
    console.log(`removed: ${removed} hook entries (${harness}) ← ${filePath}`);
  } else {
    console.log(`ok: hooks already absent (${harness}) ← ${filePath}`);
  }
}

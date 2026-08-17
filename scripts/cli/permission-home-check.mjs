#!/usr/bin/env node
// Verifies that path-scoped permission rules in the LIVE harness configs name this machine's home.
//
// WHY THIS EXISTS: the tracked generated/<provider>/ artifact renders with a fixed placeholder home
// (scripts/build/render-agent-permissions.mjs) so a fake-HOME test run cannot rewrite it. That same
// artifact is rootConfigBaseline (scripts/cli/paths.mjs) — install and apply merge it into the
// user's real home, and Claude's merge UNIONS permission arrays (scripts/cli/root-config-merge.mjs).
// A placeholder home therefore survives into every real machine as a rule pointing at a directory
// that does not exist, and because the merge is additive no later render can remove it.
//
// The manifest ships home-relative scope paths ("~/projects/**") and only the RENDER makes them
// absolute, so any absolute home prefix in a live file that is not this machine's home is drift.
// Reported per rule so the output names the exact lines to remove.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listHarnessProviders } from "../harnesses/registry.mjs";

const home = os.homedir();

// Only meaningful against a REAL user home. Test harnesses and package smokes point $HOME at a
// scratch dir, where every rendered rule necessarily names some other home — reporting that would
// be noise about the fixture, not drift on a user's machine. os.homedir() reads $HOME on POSIX, so
// a fake home is detected by it not looking like a user home directory at all.
function isRealUserHome(dir) {
  return /^\/(Users|home)\/[^/]+$/.test(dir) || dir === "/root";
}

if (!isRealUserHome(home)) process.exit(0);

// Claude path-scoped rules render as `Tool(//absolute/glob)` — the leading `//` is Claude's
// absolute-path marker, not part of the path. Only rules naming a POSIX-style home directory can be
// wrong in the way this check is looking for; scratch scopes (/tmp, /private/var/...) are
// machine-independent by design and are correctly identical everywhere.
const SCOPED_RULE = /^(\w+)\(\/\/(.+)\)$/;

function homePrefixOf(absPath) {
  // "/Users/you/projects/**" -> "/Users/you"; "Users/you/projects/**" -> "/Users/you".
  // Home dirs are two segments on macOS (/Users/<name>) and Linux (/home/<name>).
  const normalized = absPath.startsWith("/") ? absPath : `/${absPath}`;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const root = `/${parts[0]}`;
  if (root !== "/Users" && root !== "/home") return null;
  return `/${parts[0]}/${parts[1]}`;
}

function claudeRuleDrift(file) {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return []; // Unreadable or non-JSON: not this check's business to report.
  }
  const drift = [];
  for (const bucket of ["allow", "deny", "ask"]) {
    for (const rule of settings.permissions?.[bucket] ?? []) {
      if (typeof rule !== "string") continue;
      const match = SCOPED_RULE.exec(rule);
      if (!match) continue;
      const prefix = homePrefixOf(match[2]);
      if (prefix && prefix !== home) drift.push({ bucket, rule, prefix });
    }
  }
  return drift;
}

let failed = false;

for (const provider of listHarnessProviders()) {
  if (!provider.manifest.capabilities?.includes("permissions")) continue;
  // Only providers whose permissions live in a JSON root config express scope as parseable path
  // rules. Codex encodes scope as a sandbox mode and Gemini as tool-name policy — neither embeds an
  // absolute home path, so neither can drift in this way.
  if (provider.manifest.extensions?.roborepo?.rootConfigFormat !== "json") continue;
  const rootRel = provider.manifest.paths?.rootConfig?.path?.replace(/^~\//, "");
  if (!rootRel) continue;
  const file = path.join(home, rootRel);
  if (!fs.existsSync(file)) continue;

  for (const { bucket, rule, prefix } of claudeRuleDrift(file)) {
    console.error(`fail: ${file} permissions.${bucket} rule "${rule}" names ${prefix}, not this machine's home (${home})`);
    failed = true;
  }
}

if (failed) {
  console.error("");
  console.error("These rules match a directory that does not exist on this machine. They come from a");
  console.error("generated/ baseline rendered with a placeholder home; the root-config merge is additive,");
  console.error("so re-rendering will not remove them. Delete the stale rules from the live file.");
  process.exit(1);
}

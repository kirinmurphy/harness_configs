import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { hashDirectory } from "./hash-directory.mjs";

// Shared "--dry-run mutates nothing" check.
//
// Every command that accepts --dry-run makes the same promise, and until now each test asserted it
// by hand for the one or two paths that test happened to care about. That catches a leak only when
// somebody thinks to look: `workspace-resources.mjs --dry-run` created the whole workspace scaffold
// (applyWorkspaceAssets threads dryRun into its apply calls, but the validateWorkspace() it calls
// first runs initializeWorkspace() with no dryRun at all) and no test noticed, because no test
// happened to snapshot the workspace root around that particular command.
//
// This snapshots every root a command could plausibly touch, runs it, and re-snapshots. A tree that
// does not exist before and does not exist after is unchanged; a tree that appears is a mutation,
// which is the specific shape the workspace-scaffold leak takes.
//
// hashDirectory covers content, mode, and symlink targets, so this also catches a dry run that
// rewrites a file to identical bytes with different permissions, or retargets a symlink.

// A path's identity: its hash, or a sentinel when it is absent. Absent-vs-present is itself the
// signal for scaffold leaks, so "missing" has to be a comparable value rather than a skip.
//
// Handles files as well as directories. Several watched roots are single files (shell profiles,
// ~/.gitignore_global), and hashDirectory throws ENOTDIR on those — which the catch below would
// have turned into a constant "<unreadable>" on both sides of the comparison, silently making every
// profile change invisible. A watcher that cannot see the file it is watching is worse than no
// watcher, because it reports success.
function snapshot(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return `symlink:${fs.readlinkSync(target)}`;
    if (stat.isFile()) {
      return `file:${stat.mode}:${crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex")}`;
    }
    return hashDirectory(target);
  } catch (err) {
    if (err.code === "ENOENT") return "<absent>";
    // Anything else is reported rather than silently treated as absent: a permissions failure must
    // not look like a passing dry run.
    return `<unreadable: ${err.code || err.message}>`;
  }
}

/**
 * Runs a command and asserts it changed nothing under any of `roots`.
 *
 * @param {object} options
 * @param {string} options.label            Human-readable command name for assertion messages.
 * @param {string[]} options.argv           [binary, ...args] to spawn.
 * @param {string} options.cwd
 * @param {NodeJS.ProcessEnv} options.env
 * @param {string[]} options.roots          Directories that must be byte-identical afterward.
 * @param {number} [options.expectStatus=0] Expected exit code.
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
export function assertDryRunClean({ label, argv, cwd, env, roots, expectStatus = 0 }) {
  assert.ok(Array.isArray(roots) && roots.length > 0, `${label}: roots must be a non-empty array`);

  const before = new Map(roots.map((root) => [root, snapshot(root)]));
  const [binary, ...args] = argv;
  const result = spawnSync(binary, args, { cwd, env, encoding: "utf8" });

  assert.equal(
    result.status,
    expectStatus,
    `${label}: expected exit ${expectStatus}, got ${result.status}\n${result.stdout}${result.stderr}`,
  );

  const changed = [];
  for (const root of roots) {
    const after = snapshot(root);
    if (after !== before.get(root)) {
      changed.push(`  ${root}\n    before: ${before.get(root)}\n    after:  ${after}`);
    }
  }

  assert.equal(
    changed.length,
    0,
    `${label}: --dry-run mutated state that must be left untouched:\n${changed.join("\n")}\n`
      + `${result.stdout}${result.stderr}`,
  );

  return result;
}

/**
 * The roots a roborepo dry run must never touch, for a sandboxed HOME.
 * Kept here so a new command's dry-run test cannot forget one — adding a root protects every
 * caller at once, which is the whole point of centralizing this.
 *
 * Derived from what the installer and uninstaller actually write (grep `${HOME}/` across
 * scripts/install/), not from what seems likely. The shell profiles and backup roots matter as much
 * as the harness dirs: the two removal defects found during this phase's hardening were a dangling
 * `source` line left in a profile and backup handling, neither of which lives under a harness home.
 * A watcher that skipped them would have been blind to exactly the class of bug that motivated it.
 */
export function roborepoDryRunRoots({ home, stateRoot, workspaceRoot }) {
  return [
    path.join(home, ".claude"),
    path.join(home, ".codex"),
    path.join(home, ".gemini"),
    path.join(home, ".agents"),
    path.join(home, ".local", "bin"),
    stateRoot ?? path.join(home, ".roborepo"),
    workspaceRoot ?? path.join(home, ".roborepo", "workspace"),
    path.join(home, ".roborepo-backups"),
    // Individual files, not directories. snapshot() hashes a file the same way, so a dry run that
    // appends a PATH export or a `source` line to a profile is caught as a content change.
    path.join(home, ".zshrc"),
    path.join(home, ".bashrc"),
    path.join(home, ".bash_profile"),
    path.join(home, ".profile"),
    path.join(home, ".gitignore_global"),
  ];
}

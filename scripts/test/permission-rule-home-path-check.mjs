#!/usr/bin/env node
// No ALLOW permission rule may be anchored to a contributor's home directory.
//
// Permission rules are generated from manifests/inventory/agent-permissions.json and committed.
// A scope path anchored to a personal directory layout (`~/projects/**`) must never land in the
// checked-in artifact as one contributor's absolute home. That is machine-specific state in a
// shared file: it is wrong for every other contributor, and it leaks a username.
//
// WHERE a write is allowed inside the current checkout is decided at tool-call time by the
// `repo-write-boundary` behavior, not by a path glob, so no personal directory needs to appear in
// an allow rule at all. The allow scopes carry only the scratch directories that are correct
// regardless of which repository is in use.
//
// DENY rules are allowed to use Claude's `~/...` anchor. `read-secrets` denies `~/.ssh/**`,
// `~/.aws/**` and friends — home-relative by nature, correct on every machine, and a security floor
// rather than one person's directory layout. The `~` there is the point, not a leak: it resolves
// per machine at harness runtime. The failure this guards against is a personal path silently
// GRANTING access, which a deny cannot do.
//
// Test fixtures elsewhere legitimately contain absolute home paths (a Docker label, a Codex
// trust-level entry); those are not permission rules and are not what this guards.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

// A home directory anchored under a real username. Excludes `<...>`: docs quote the bad shape with
// an anonymized placeholder (`//Users/<user>/projects/**`) to explain what was removed and why. A
// placeholder names no real person, so matching it would flag the documentation as the problem.
const HOME_PATH = /(?:^|\/)(?:Users|home)\/(?!<)[^/"<>)]+\//;
const HOME_TILDE = /^~\//;

const offenders = [];

// --- The generated Claude artifact: parsed, so `allow` is checked as a bucket, not as text. ---
const settingsPath = path.join(repoRoot, "generated", "claude", "settings.json");
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
for (const rule of settings.permissions?.allow ?? []) {
  if (HOME_PATH.test(rule)) offenders.push(`generated/claude/settings.json: allow ${rule}`);
}

// --- The manifest source: only behaviors whose bucket is allow. ---
const manifestRel = path.join("manifests", "inventory", "agent-permissions.json");
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, manifestRel), "utf8"));
for (const b of manifest.behaviors ?? []) {
  if (b.bucket !== "allow") continue;
  for (const p of b.paths ?? []) {
    if (HOME_TILDE.test(p) || HOME_PATH.test(p)) offenders.push(`${manifestRel}: ${b.id} allows ${p}`);
  }
}

assert.deepEqual(
  offenders,
  [],
  `allow rules must not be anchored to a home directory:\n${offenders.join("\n")}`,
);

// The guard only means something if it still sees the shape it is looking for, and only stays
// usable if it ignores the deny rules and placeholders that are supposed to be there.
assert.ok(HOME_PATH.test("Read(//Users/someone/projects/**)"), "must match an expanded macOS home");
assert.ok(HOME_PATH.test("Write(//home/someone/projects/**)"), "must match an expanded Linux home");
assert.ok(HOME_TILDE.test("~/projects/**"), "must match an un-expanded manifest home path");
assert.ok(!HOME_PATH.test("Read(//Users/<user>/projects/**)"), "must ignore anonymized placeholders");
assert.ok(!HOME_TILDE.test("/tmp/**"), "must ignore scratch scope paths");

// The deny bucket is exempt by construction: prove the secrets denylist is present, home-relative,
// and not tied to the machine that rendered the generated artifact.
const denies = settings.permissions?.deny ?? [];
assert.ok(
  denies.includes("Read(~/.ssh/**)"),
  "read-secrets must still deny ~/.ssh with Claude's home-relative anchor",
);
assert.ok(
  denies.every((r) => !HOME_PATH.test(r)),
  "generated deny rules must not contain a contributor's expanded home directory",
);

console.log(`permission-rule-home-path ok (${denies.length} deny rules exempt by design)`);

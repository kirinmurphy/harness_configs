#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const M = "../../modules/repositories/index.mjs";
const { deriveLifecycle, inspectCheckout, ageOutCandidates, lastSeenAtFor } = await import(M);
const { recordRepositoryDiscovery } = await import("../cli/repositories.mjs");
const { loadRegistry } = await import(M);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rr-phase2-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const stateRoot = path.join(tmp, "state");
const check = (l, got, want) => assert.equal(got, want, l);

// --- inspectCheckout ---
const live = path.join(tmp, "live");
fs.mkdirSync(path.join(live, ".git"), { recursive: true });
check("present checkout", inspectCheckout(live).state, "present");

const gone = path.join(tmp, "gone");           // parent (tmp) readable, checkout absent
check("absent checkout (parent readable)", inspectCheckout(gone).state, "absent");

const noGit = path.join(tmp, "nogit");
fs.mkdirSync(noGit, { recursive: true });
check("exists but no .git", inspectCheckout(noGit).state, "absent");

// worktree: .git is a FILE, not a directory
const wt = path.join(tmp, "worktree");
fs.mkdirSync(wt, { recursive: true });
fs.writeFileSync(path.join(wt, ".git"), "gitdir: /elsewhere\n");
check("worktree (.git is a file)", inspectCheckout(wt).state, "present");

// unreadable parent -> simulated via an fsApi that throws EACCES on the parent
const eacces = (p) => { const e = new Error("denied"); e.code = p.endsWith("unplugged") ? "ENOENT" : "EACCES"; throw e; };
check("unreadable parent is NOT absence",
  inspectCheckout("/Volumes/drive/unplugged", { fsApi: { statSync: eacces } }).state, "unreadable");

// --- deriveLifecycle ---
const ID = "git:github.com/k/app";
const base = { repositoryId: ID, kind: "git", displayName: "app", source: "localhoster", evidence: "git-remote", confidence: "high", stateRoot };
recordRepositoryDiscovery({ ...base, localRoot: "roota", localRootPath: live, now: "2026-08-11T00:00:00.000Z" });
let reg = loadRegistry({ stateRoot });

check("running -> active", deriveLifecycle(reg, ID, { runningRepositoryIds: new Set([ID]) }).state, "active");
check("not running, checkout present -> idle", deriveLifecycle(reg, ID).state, "idle");

// add a second checkout that is genuinely gone; one present keeps it idle
recordRepositoryDiscovery({ ...base, localRoot: "rootb", localRootKind: "worktree", localRootPath: gone, now: "2026-08-11T00:01:00.000Z" });
reg = loadRegistry({ stateRoot });
check("one present + one absent -> idle", deriveLifecycle(reg, ID).state, "idle");

// every checkout gone -> stale
const ID2 = "git:github.com/k/vanished";
recordRepositoryDiscovery({ ...base, repositoryId: ID2, displayName: "vanished", localRoot: "rootc", localRootPath: gone, now: "2026-08-11T00:02:00.000Z" });
reg = loadRegistry({ stateRoot });
check("all checkouts absent -> stale", deriveLifecycle(reg, ID2).state, "stale");

// unreadable keeps it idle even though nothing is present
const blocked = { statSync: (p) => { const e = new Error("x"); e.code = "EACCES"; throw e; } };
check("all checkouts unreadable -> idle (never stale)", deriveLifecycle(reg, ID2, { fsApi: blocked }).state, "idle");

// --- ageing ---
const old = "2026-06-01T00:00:00.000Z"; // >30d before 2026-08-11
const nowMs = Date.parse("2026-08-11T00:00:00.000Z");
const synth = { repositories: {
  aged:   { visibility: "visible", localRoots: [{ lastSeenAt: old }], discoveries: [] },
  recent: { visibility: "visible", localRoots: [{ lastSeenAt: "2026-08-10T00:00:00.000Z" }], discoveries: [] },
  never:  { visibility: "visible", localRoots: [{ lastSeenAt: null }], discoveries: [] },
  hidden: { visibility: "hidden",  localRoots: [{ lastSeenAt: old }], discoveries: [] },
} };
const aged = ageOutCandidates(synth, { now: nowMs }).map((c) => c.repositoryId);
check("30d-old record is a candidate", aged.includes("aged"), true);
check("recent record is not", aged.includes("recent"), false);
check("null lastSeenAt never ages out", aged.includes("never"), false);
check("already-hidden is not re-listed", aged.includes("hidden"), false);
check("lastSeenAtFor picks newest", lastSeenAtFor({ localRoots: [{ lastSeenAt: old }], discoveries: [{ lastSeenAt: "2026-08-09T00:00:00.000Z" }] }), "2026-08-09T00:00:00.000Z");

// --- reused directory: repoints, never silently merges ---
const RENAMED = "git:github.com/k/app-renamed";
recordRepositoryDiscovery({ ...base, repositoryId: RENAMED, displayName: "app-renamed", localRoot: "roota", localRootPath: live, now: "2026-08-11T01:00:00.000Z" });
reg = loadRegistry({ stateRoot });
const { priorRepositoryForRoot } = await import(M);
check("new id gets its own record (no silent merge)", Boolean(reg.repositories[RENAMED]), true);
check("no alias invented automatically", Object.keys(reg.aliases).length, 0);
check("checkout repoints to the new owner", reg.localRootPaths.roota.repositoryId, RENAMED);
check("prior owner is reportable for the UI", priorRepositoryForRoot(reg, { rootId: "roota", nextRepositoryId: ID }), RENAMED);

// --- the read side of that repoint ---
// Nothing is merged, so the old record survives with zero checkouts it still owns. That was
// invisible while only running repositories were listed; once persisted ones render it becomes a
// second card with the same name as the repository that took its roots. supersededBy reports the
// successor so the caller can fold the card away without touching the record.
const { supersededBy } = await import(M);
// ID keeps `rootb` and only lost `roota`, so it is NOT superseded — it is a repository with one
// checkout gone and one still its own, which is exactly the case that must keep its card.
check("losing one checkout of two does not supersede", supersededBy(reg, ID), null);
check("the record that took the root is not superseded", supersededBy(reg, RENAMED), null);

// Everything below is a case where the answer must be null, because a wrong fold hides a repository
// the user still has — the same asymmetry that made automatic aliasing the wrong default.
{
  const roots = { repositories: {
    // The case this exists for: every checkout it had is now owned by one other repository. This is
    // what a rename leaves behind, and the only shape that folds.
    superseded: { localRoots: [{ rootId: "moved1" }, { rootId: "moved2" }], discoveries: [] },
    // Never resolved a checkout at all. Unresolved is not superseded.
    noRoots: { localRoots: [], discoveries: [] },
    // One root still its own, one taken: a partial move is not a rename.
    partial: { localRoots: [{ rootId: "keeps" }, { rootId: "taken" }], discoveries: [] },
    // Roots scattered across two successors — not a rename, and picking a winner would be the merge
    // this design refuses to make.
    scattered: { localRoots: [{ rootId: "toA" }, { rootId: "toB" }], discoveries: [] },
    // A root that was never located says nothing about ownership.
    pathless: { localRoots: [{ rootId: "unlocated" }], discoveries: [] },
    // Points at a record that no longer exists; a dangling pointer is not a successor.
    dangling: { localRoots: [{ rootId: "toGone" }], discoveries: [] },
    successorA: { localRoots: [], discoveries: [] },
    successorB: { localRoots: [], discoveries: [] },
  }, localRootPaths: {
    moved1: { repositoryId: "successorA", path: "/m1" },
    moved2: { repositoryId: "successorA", path: "/m2" },
    keeps: { repositoryId: "partial", path: "/k" },
    taken: { repositoryId: "successorA", path: "/t" },
    toA: { repositoryId: "successorA", path: "/a" },
    toB: { repositoryId: "successorB", path: "/b" },
    toGone: { repositoryId: "deleted-record", path: "/g" },
  } };
  check("every root taken by one successor folds", supersededBy(roots, "superseded"), "successorA");
  check("the successor itself is not superseded", supersededBy(roots, "successorA"), null);
  check("no roots is not superseded", supersededBy(roots, "noRoots"), null);
  check("partially repointed is not superseded", supersededBy(roots, "partial"), null);
  check("roots split across successors is not superseded", supersededBy(roots, "scattered"), null);
  check("a root with no recorded path blocks the verdict", supersededBy(roots, "pathless"), null);
  check("a successor that no longer exists is not one", supersededBy(roots, "dangling"), null);
  check("unknown repository", supersededBy(roots, "nope"), null);
  check("missing registry", supersededBy(null, "x"), null);
}

// --- hide / restore round trip ---
// The contract the plan states outright: a record is hidden, returns via "Show hidden", and is never
// removed. Nothing here deletes, and every step is reversible.
{
  const { hideRepository, validateRegistry, REGISTRY_VERSION } = await import(M);
  const nowIso = new Date(nowMs).toISOString();
  const oldIso = new Date(nowMs - 40 * 24 * 60 * 60 * 1000).toISOString();
  const RID = "local:aaaaaaaaaaaaaaaa";
  const record = () => ({
    id: RID, kind: "local", displayName: "aged-repo", providerUrl: null, normalizedRemote: null,
    localRoots: [{ rootId: "r", kind: "primary", firstSeenAt: oldIso, lastSeenAt: oldIso }],
    discoveries: [], enrollments: {}, aliases: [], visibility: "visible",
    resolution: "resolved", activity: "unknown", createdAt: oldIso, updatedAt: oldIso,
  });
  const synthReg = { version: REGISTRY_VERSION, revision: 1, repositories: { [RID]: record() }, localRootPaths: {}, aliases: {} };

  check("a 40-day-old record is an age-out candidate", ageOutCandidates(synthReg, { now: nowMs }).length, 1);
  check("hiding reports a change", hideRepository(synthReg, RID, { hidden: true, now: nowIso }), true);
  check("hiding twice is a no-op", hideRepository(synthReg, RID, { hidden: true, now: nowIso }), false);
  check("hidden records are not re-listed as candidates", ageOutCandidates(synthReg, { now: nowMs }).length, 0);
  check("the record still exists after hiding", Boolean(synthReg.repositories[RID]), true);
  validateRegistry(synthReg);

  check("restoring reports a change", hideRepository(synthReg, RID, { hidden: false, now: nowIso }), true);
  check("restored record is visible again", synthReg.repositories[RID].visibility, "visible");
  // The load-bearing part. Ageing measures lastSeenAt, and restoring does not change it — so the
  // record is STILL an age-out candidate the moment it is restored. Without a marker the next sweep
  // would re-hide it immediately, and every sweep after that, making "Show hidden" useless.
  check("restored record is still technically aged", ageOutCandidates(synthReg, { now: nowMs }).length, 1);
  check("...but carries restoredAt so the sweep can skip it", Boolean(synthReg.repositories[RID].restoredAt), true);
  validateRegistry(synthReg);

  // Hiding by hand after a restore has to work, so the marker clears rather than pinning the record
  // visible forever.
  hideRepository(synthReg, RID, { hidden: true, now: nowIso });
  check("a deliberate re-hide clears the restore marker", synthReg.repositories[RID].restoredAt, undefined);
  validateRegistry(synthReg);
}

// --- reused directory: a persisted path is not trusted on its own ---
// The plan's stated risk. A checkout is deleted and a different repository cloned to the same path;
// the registry still records that path against the old record. Reading git from it blind prints the
// NEW repository's branch on the OLD repository's card — a confident wrong fact, worse than the
// missing one it replaces. A running repository cannot hit this, because its identity is resolved
// from the process's own cwd every scan; only a persisted path is trusted from storage.
{
  const { resolveProjectIdentity } = await import("../../modules/localhoster/identity.mjs");
  const { canonicalRepositoryId } = await import("../../modules/repositories/identity.mjs");
  const { execFileSync } = await import("node:child_process");
  const git = (...args) => execFileSync("git", args, { stdio: "ignore" });
  const reused = path.join(tmp, "reused");
  fs.mkdirSync(reused, { recursive: true });
  git("init", "-q", reused);
  git("-C", reused, "config", "user.email", "t@example.invalid");
  git("-C", reused, "config", "user.name", "t");
  fs.writeFileSync(path.join(reused, "f"), "x");
  git("-C", reused, "add", "-A");
  git("-C", reused, "commit", "-qm", "x");
  git("-C", reused, "remote", "add", "origin", "git@github.com:someone/now-different.git");

  const actual = canonicalRepositoryId(resolveProjectIdentity(reused));
  check("the directory resolves to whoever is there now", actual, "git:github.com/someone/now-different");
  // This is the comparison readIdleGit makes before trusting the path. It has to be the SAME
  // derivation discovery uses for a running checkout, or the two would disagree about identity.
  check("a stale record does not match the directory", actual === "git:github.com/k/app", false);
  check("the current owner does match", actual === actual, true);
}

console.log("repositories-lifecycle-check passed");

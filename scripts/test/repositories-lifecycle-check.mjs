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

console.log("repositories-lifecycle-check passed");

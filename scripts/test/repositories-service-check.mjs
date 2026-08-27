#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordRepositoryDiscovery, enrollRepositoryInPlans } from "../cli/repositories.mjs";
import { loadRegistry, registryPathFor, localRootPath, checkoutRootsFor, repositoryDetailPayload } from "../../modules/repositories/index.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-repo-service-"));
const stateRoot = path.join(tempRoot, "state");

try {
  // ---- Discovery recording is idempotent and does not enable enrollment ----
  const id = "git:github.com/kirinmurphy/roborepo";
  recordRepositoryDiscovery({ repositoryId: id, kind: "git", displayName: "roborepo", source: "localhoster", evidence: "git-remote", confidence: "high", localRoot: "rootaaaa1111", stateRoot });
  let reg = loadRegistry({ stateRoot });
  assert.ok(reg.repositories[id], "repository registered");
  assert.equal(reg.repositories[id].enrollments.plans, undefined, "discovery does not enroll Plans");
  assert.equal(reg.repositories[id].providerUrl, "https://github.com/kirinmurphy/roborepo");
  assert.equal(reg.repositories[id].localRoots.length, 1);
  const revAfterFirst = reg.revision;

  // Re-recording the same discovery within debounce is a no-op (no revision bump).
  recordRepositoryDiscovery({ repositoryId: id, kind: "git", displayName: "roborepo", source: "localhoster", evidence: "git-remote", confidence: "high", localRoot: "rootaaaa1111", stateRoot });
  reg = loadRegistry({ stateRoot });
  assert.equal(reg.revision, revAfterFirst, "idempotent re-discovery does not write");

  // ---- Multiple ports/clones/worktrees associate to one canonical repo ----
  // A second clone (distinct rootId) and a worktree (distinct rootId) of the same remote.
  recordRepositoryDiscovery({ repositoryId: id, kind: "git", displayName: "roborepo", source: "localhoster", evidence: "git-remote", confidence: "high", localRoot: "rootbbbb2222", stateRoot });
  recordRepositoryDiscovery({ repositoryId: id, kind: "git", displayName: "roborepo", source: "localhoster", evidence: "worktree-commondir", confidence: "high", localRoot: "rootcccc3333", localRootKind: "worktree", stateRoot });
  reg = loadRegistry({ stateRoot });
  assert.equal(Object.keys(reg.repositories).length, 1, "all roots collapse to one canonical repository");
  assert.equal(reg.repositories[id].localRoots.length, 3, "each distinct root retained");
  assert.equal(reg.repositories[id].localRoots.filter((r) => r.kind === "worktree").length, 1);

  // ---- Plans enrollment: not covered -> adds the EXACT repo root as narrow default ----
  const repoRoot = path.join(tempRoot, "clones", "roborepo");
  fs.mkdirSync(repoRoot, { recursive: true });
  let planSettings = { discoveryRoots: [], ignoredDirectories: [] };
  const updateCalls = [];
  let refreshed = 0;
  const hooks = {
    readSettings: () => ({ ...planSettings }),
    updatePlanSettings: ({ discoveryRoots }) => { updateCalls.push(discoveryRoots); planSettings = { ...planSettings, discoveryRoots }; },
    refreshPlans: () => { refreshed += 1; },
  };
  const res = enrollRepositoryInPlans({ repositoryId: id, repoRoot, stateRoot, ...hooks });
  assert.equal(res.covered, false);
  assert.equal(res.sourceAdded, path.resolve(repoRoot), "adds the exact repo root, never a parent");
  assert.deepEqual(updateCalls[updateCalls.length - 1], [path.resolve(repoRoot)]);
  assert.equal(refreshed, 1);
  reg = loadRegistry({ stateRoot });
  assert.equal(reg.repositories[id].enrollments.plans.enabled, true, "enrollment recorded only after Plans write+refresh succeeded");

  // ---- Plans enrollment: already covered -> reuses source, adds no duplicate ----
  const covered = enrollRepositoryInPlans({ repositoryId: id, repoRoot, stateRoot,
    readSettings: () => ({ discoveryRoots: [path.resolve(repoRoot)], ignoredDirectories: [] }),
    updatePlanSettings: () => { throw new Error("must not add a source when already covered"); },
    refreshPlans: () => {},
  });
  assert.equal(covered.covered, true);
  assert.equal(covered.coveringSource, path.resolve(repoRoot));
  assert.equal(covered.sourceAdded, null);

  // ---- Enrollment failure leaves the repository unmonitored ----
  const id2 = "local:1111222233334444";
  recordRepositoryDiscovery({ repositoryId: id2, kind: "local", displayName: "solo", source: "localhoster", evidence: "cwd-in-git-root", confidence: "medium", stateRoot });
  assert.throws(() => enrollRepositoryInPlans({ repositoryId: id2, repoRoot: path.join(tempRoot, "solo"), stateRoot,
    readSettings: () => ({ discoveryRoots: [], ignoredDirectories: [] }),
    updatePlanSettings: () => { throw new Error("disk full"); },
    refreshPlans: () => {},
  }), /disk full/);
  reg = loadRegistry({ stateRoot });
  assert.equal(reg.repositories[id2].enrollments.plans, undefined, "failed enrollment does not mark monitoring enabled");

  // ---- Unknown repository rejected ----
  assert.throws(() => enrollRepositoryInPlans({ repositoryId: "git:github.com/x/y", repoRoot, stateRoot,
    readSettings: () => ({ discoveryRoots: [] }), updatePlanSettings: () => {}, refreshPlans: () => {},
  }), /unknown repository/);

  // ---- Private rootId -> path index (pljvmyh §2, delivered by h4tqm2wz) ----
  const pathId = "git:github.com/kirinmurphy/pathed";
  const mainPath = path.join(tempRoot, "checkouts", "pathed");
  const treePath = path.join(tempRoot, "worktrees", "pathed-feature");
  const recordPathed = (over = {}) => recordRepositoryDiscovery({
    repositoryId: pathId, kind: "git", displayName: "pathed", source: "localhoster",
    evidence: "git-remote", confidence: "high", stateRoot, ...over,
  });

  recordPathed({ localRoot: "rootdddd4444", localRootPath: mainPath, now: "2026-08-11T00:00:00.000Z" });
  reg = loadRegistry({ stateRoot });
  assert.equal(localRootPath(reg, "rootdddd4444"), mainPath, "discovery records where the checkout lives");
  const revAfterPath = reg.revision;

  // The steady-state poll runs every ~10s. Re-recording an unchanged root must not write, or the
  // poll would churn the revision that mutation conflict-detection depends on.
  recordPathed({ localRoot: "rootdddd4444", localRootPath: mainPath, now: "2026-08-11T00:00:10.000Z" });
  assert.equal(loadRegistry({ stateRoot }).revision, revAfterPath, "steady-state poll performs no write");

  // A second checkout is additive; both are knowable when nothing is running.
  recordPathed({ localRoot: "rooteeee5555", localRootKind: "worktree", localRootPath: treePath, now: "2026-08-11T00:00:20.000Z" });
  reg = loadRegistry({ stateRoot });
  assert.deepEqual(
    checkoutRootsFor(reg, pathId).map((r) => r.path).sort(),
    [mainPath, treePath].sort(),
    "every checkout of the repository is recorded",
  );

  // A moved checkout overwrites its mapping — a rootId resolves to at most one current path.
  recordPathed({ localRoot: "rooteeee5555", localRootKind: "worktree", localRootPath: `${treePath}-renamed`, now: "2026-08-11T00:01:00.000Z" });
  assert.equal(localRootPath(loadRegistry({ stateRoot }), "rooteeee5555"), `${treePath}-renamed`, "moved checkout repoints");

  // A directory that was one repository and became another (this exists in the live registry).
  // The new owner takes the mapping and the old repository stops claiming that root.
  const reuseId = "git:github.com/kirinmurphy/reused";
  recordRepositoryDiscovery({ repositoryId: reuseId, kind: "git", displayName: "reused", source: "localhoster",
    evidence: "git-remote", confidence: "high", localRoot: "rootdddd4444", localRootPath: mainPath, stateRoot, now: "2026-08-11T00:02:00.000Z" });
  reg = loadRegistry({ stateRoot });
  assert.equal(reg.localRootPaths.rootdddd4444.repositoryId, reuseId, "reused directory repoints to its new repository");
  assert.ok(!checkoutRootsFor(reg, pathId).some((r) => r.rootId === "rootdddd4444"), "prior owner no longer claims the root");

  // A process stopping never deletes anything: nothing was re-recorded above for the worktree, and
  // it is still there.
  assert.equal(checkoutRootsFor(reg, pathId).length, 1, "records survive their processes stopping");

  // Paths are server-side only.
  assert.ok(!JSON.stringify(repositoryDetailPayload(reg.repositories[pathId])).includes(tempRoot), "no absolute path in the browser payload");

  assert.ok(fs.existsSync(registryPathFor(stateRoot)));
  console.log("repositories-service-check passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

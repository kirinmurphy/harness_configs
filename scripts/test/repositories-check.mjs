#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeGitRemote,
  resolveProjectIdentity,
  canonicalRepositoryId,
  localRepositoryId,
  rootId,
  resolveGitDir,
  defaultRegistry,
  validateRegistry,
  loadRegistry,
  writeRegistry,
  updateRegistry,
  registryPathFor,
  upsertRepository,
  recordDiscovery,
  registerLocalRoot,
  setEnrollment,
  hideRepository,
  setAlias,
  resolveRegistryAlias,
  associateResolved,
  associateLegacyHashes,
  plansSourceCoverage,
  planPlansEnrollment,
  importLocalhosterAliases,
  canonicalizeLocalhosterIdentity,
  repositoryScopedFinding,
  globalFinding,
  isRepositoryScoped,
  providerUrlForRepositoryId,
} from "../../modules/repositories/index.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-repositories-"));

function mkRepo(name, remote) {
  const repo = path.join(tempRoot, name);
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  if (remote) fs.writeFileSync(path.join(repo, ".git", "config"), `[remote "origin"]\n  url = ${remote}\n`);
  return fs.realpathSync(repo);
}

try {
  // ---- Normalization equivalence: SSH and HTTPS forms correlate ----
  const ssh = normalizeGitRemote("git@github.com:kirinmurphy/roborepo.git");
  const https = normalizeGitRemote("https://token@github.com/kirinmurphy/roborepo.git?x=1#f");
  assert.equal(ssh, "git:github.com/kirinmurphy/roborepo");
  assert.equal(ssh, https, "SSH and HTTPS remotes must normalize identically");
  assert.equal(normalizeGitRemote("ssh://git@github.com:22/kirinmurphy/roborepo.git"), "git:github.com/kirinmurphy/roborepo");
  assert.equal(normalizeGitRemote("git@github.com:KirinMurphy/Visa_Planner.git"), "git:github.com/KirinMurphy/Visa_Planner", "owner/repo casing preserved");
  assert.equal(normalizeGitRemote("../../../etc/passwd"), null, "traversal rejected");
  assert.equal(normalizeGitRemote(""), null);
  assert.equal(normalizeGitRemote(null), null);

  // ---- canonicalRepositoryId across tiers ----
  const gitRepo = mkRepo("gitrepo", "git@github.com:kirinmurphy/roborepo.git");
  const gitId = resolveProjectIdentity(gitRepo, "node");
  assert.equal(gitId.identityKind, "git");
  assert.equal(canonicalRepositoryId(gitId), "git:github.com/kirinmurphy/roborepo");

  const noRemote = mkRepo("noremote", null);
  const pathId = resolveProjectIdentity(noRemote, "node");
  assert.equal(pathId.identityKind, "path");
  assert.match(canonicalRepositoryId(pathId), /^local:[a-f0-9]{16}$/, "no-remote repo gets opaque local id");
  assert.ok(!canonicalRepositoryId(pathId).includes(noRemote), "local id must not leak the path");
  assert.equal(canonicalRepositoryId(pathId), localRepositoryId(noRemote), "local id derives from realpath");

  const processOnly = resolveProjectIdentity(path.join(tempRoot, "no-git-here"), "node");
  assert.equal(processOnly.identityKind, "process");
  assert.equal(canonicalRepositoryId(processOnly), null, "process-only is not a repository");

  // ---- Worktree resolution: linked worktree -> same canonical repo, distinct rootId ----
  // Simulate a real linked worktree: primary repo's git dir holds the config; the worktree gitdir
  // has a commondir pointer back to it.
  const primary = mkRepo("wt-primary", "git@github.com:kirinmurphy/shared.git");
  const commonGitDir = path.join(primary, ".git");
  const wtGitDir = path.join(commonGitDir, "worktrees", "feature");
  fs.mkdirSync(wtGitDir, { recursive: true });
  fs.writeFileSync(path.join(wtGitDir, "commondir"), "../..\n");
  const worktree = path.join(tempRoot, "wt-feature");
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, ".git"), `gitdir: ${wtGitDir}\n`);

  const primaryId = resolveProjectIdentity(primary, "node");
  const wtId = resolveProjectIdentity(worktree, "node");
  assert.equal(wtId.identity, primaryId.identity, "worktree resolves to primary's canonical git id");
  assert.equal(canonicalRepositoryId(wtId), canonicalRepositoryId(primaryId));
  assert.notEqual(rootId(wtId.projectRoot), rootId(primaryId.projectRoot), "worktree keeps a distinct rootId");

  const resolvedDir = resolveGitDir(worktree);
  assert.equal(resolvedDir.isWorktree, true);
  assert.equal(fs.realpathSync(resolvedDir.commonDir), fs.realpathSync(commonGitDir));

  // ---- Multiple clones of one remote: distinct roots, same canonical repo ----
  const cloneA = mkRepo("cloneA", "git@github.com:kirinmurphy/dup.git");
  const cloneB = mkRepo("cloneB", "https://github.com/kirinmurphy/dup.git");
  assert.equal(resolveProjectIdentity(cloneA, "node").identity, resolveProjectIdentity(cloneB, "node").identity);
  assert.notEqual(rootId(cloneA), rootId(cloneB));

  // ---- Registry: default + strict validation ----
  const reg = defaultRegistry();
  validateRegistry(reg);
  assert.throws(() => validateRegistry({ ...reg, bogus: 1 }), /unknown registry field/);
  assert.throws(() => validateRegistry({ ...reg, version: 99 }), /unsupported repository registry version/);

  // ---- Registry mutators are idempotent ----
  const now = "2026-07-24T00:00:00.000Z";
  const later = "2026-07-24T02:00:00.000Z";
  upsertRepository(reg, { id: "git:github.com/kirinmurphy/roborepo", kind: "git", displayName: "roborepo", providerUrl: "https://github.com/kirinmurphy/roborepo", now });
  upsertRepository(reg, { id: "git:github.com/kirinmurphy/roborepo", kind: "git", displayName: "roborepo", now: later });
  assert.equal(Object.keys(reg.repositories).length, 1, "upsert is idempotent");

  assert.equal(recordDiscovery(reg, "git:github.com/kirinmurphy/roborepo", { source: "localhoster", evidence: "git-remote", confidence: "high", now }), true);
  assert.equal(recordDiscovery(reg, "git:github.com/kirinmurphy/roborepo", { source: "localhoster", evidence: "git-remote", confidence: "high", now }), false, "same-source rediscovery within debounce is a no-op");
  recordDiscovery(reg, "git:github.com/kirinmurphy/roborepo", { source: "plans", evidence: "configured-scan-root", confidence: "high", now });
  assert.equal(reg.repositories["git:github.com/kirinmurphy/roborepo"].discoveries.length, 2, "distinct sources both recorded");

  assert.equal(registerLocalRoot(reg, "git:github.com/kirinmurphy/roborepo", { rootId: "aaaa1111", now }), true);
  assert.equal(registerLocalRoot(reg, "git:github.com/kirinmurphy/roborepo", { rootId: "aaaa1111", now }), false, "same root within debounce is a no-op");
  registerLocalRoot(reg, "git:github.com/kirinmurphy/roborepo", { rootId: "bbbb2222", kind: "worktree", now });
  const roots = reg.repositories["git:github.com/kirinmurphy/roborepo"].localRoots;
  assert.equal(roots.length, 2);
  assert.equal(roots[0].kind, "primary", "first root promotes to primary");
  assert.equal(roots[1].kind, "worktree");

  assert.equal(setEnrollment(reg, "git:github.com/kirinmurphy/roborepo", "plans", { enabled: true, sourceId: "src1", now }), true);
  assert.equal(setEnrollment(reg, "git:github.com/kirinmurphy/roborepo", "plans", { enabled: true, sourceId: "src1", now }), false, "unchanged enrollment is a no-op");
  assert.equal(hideRepository(reg, "git:github.com/kirinmurphy/roborepo", { hidden: true, now }), true);
  assert.equal(reg.repositories["git:github.com/kirinmurphy/roborepo"].visibility, "hidden");

  validateRegistry(reg);

  // ---- Aliases: confirm, transitive resolution, cycle rejection ----
  setAlias(reg, "path:/tmp/robo", "git:github.com/kirinmurphy/roborepo", { now });
  assert.equal(resolveRegistryAlias(reg, "path:/tmp/robo"), "git:github.com/kirinmurphy/roborepo");
  // transitive
  upsertRepository(reg, { id: "local:deadbeefdeadbeef", kind: "local", displayName: "legacy", now });
  setAlias(reg, "local:deadbeefdeadbeef", "git:github.com/kirinmurphy/roborepo", { now });
  setAlias(reg, "path:/tmp/old", "local:deadbeefdeadbeef", { now });
  assert.equal(resolveRegistryAlias(reg, "path:/tmp/old"), "git:github.com/kirinmurphy/roborepo", "transitive alias resolves to terminal");
  // cycle rejection: a canonical id already aliases -> roborepo; aliasing roborepo back to it cycles.
  assert.throws(() => setAlias(reg, "git:github.com/kirinmurphy/roborepo", "local:deadbeefdeadbeef", { now }), /cycle/);

  // ---- Persistence: atomic write, load round-trip, migration/backup, corruption ----
  const stateRoot = path.join(tempRoot, "state");
  writeRegistry({ stateRoot, registry: reg });
  const loaded = loadRegistry({ stateRoot });
  assert.equal(loaded.revision, reg.revision);
  assert.equal(Object.keys(loaded.repositories).length, Object.keys(reg.repositories).length);

  // ENOENT -> default
  const emptyState = path.join(tempRoot, "empty-state");
  assert.deepEqual(loadRegistry({ stateRoot: emptyState }), defaultRegistry());

  // Corruption -> throws clearly
  const badState = path.join(tempRoot, "bad-state");
  fs.mkdirSync(path.join(badState, "repositories"), { recursive: true });
  fs.writeFileSync(registryPathFor(badState), "{ not json");
  assert.throws(() => loadRegistry({ stateRoot: badState }), /malformed JSON/);

  // Unknown future version -> backup written, still throws (no v2 migration exists yet)
  const futureState = path.join(tempRoot, "future-state");
  fs.mkdirSync(path.join(futureState, "repositories"), { recursive: true });
  fs.writeFileSync(registryPathFor(futureState), JSON.stringify({ version: 2, revision: 1, repositories: {}, aliases: {} }));
  assert.throws(() => loadRegistry({ stateRoot: futureState }), /unsupported repository registry version/);

  // Optimistic concurrency
  updateRegistry({ stateRoot, expectedRevision: reg.revision, mutate: (r) => { upsertRepository(r, { id: "local:1111111111111111", kind: "local", displayName: "x" }); } });
  assert.throws(() => updateRegistry({ stateRoot, expectedRevision: 1, mutate: () => {} }), /REVISION_CONFLICT|revision conflict/);
  // no-op mutation skips write (revision unchanged)
  const before = loadRegistry({ stateRoot }).revision;
  updateRegistry({ stateRoot, mutate: () => false });
  assert.equal(loadRegistry({ stateRoot }).revision, before, "returning false skips the write");

  // ---- Associations: evidence/confidence + never auto-merge on name/prompt ----
  const gitAssoc = associateResolved(withRepo(gitId), { registry: reg });
  assert.equal(gitAssoc.repositoryId, "git:github.com/kirinmurphy/roborepo");
  assert.equal(gitAssoc.autoAssociate, true);
  assert.equal(gitAssoc.evidence, "git-remote");

  const procAssoc = associateResolved(withRepo(processOnly), { registry: reg });
  assert.equal(procAssoc.repositoryId, null);
  assert.equal(procAssoc.autoAssociate, false);

  // user alias wins and is high-confidence
  const aliasReg = defaultRegistry();
  upsertRepository(aliasReg, { id: "git:github.com/kirinmurphy/roborepo", kind: "git", displayName: "roborepo" });
  setAlias(aliasReg, pathId.identity, "git:github.com/kirinmurphy/roborepo");
  const aliasAssoc = associateResolved(withRepo(pathId), { registry: aliasReg });
  assert.equal(aliasAssoc.repositoryId, "git:github.com/kirinmurphy/roborepo");
  assert.equal(aliasAssoc.evidence, "user-alias");
  assert.equal(aliasAssoc.confidence, "high");

  // ---- Legacy hash association ----
  const hashIndex = {
    byNormalizedRemoteHash: new Map([["rem123", "git:github.com/kirinmurphy/roborepo"]]),
    byRootHash: new Map([["root456", "local:deadbeefdeadbeef"]]),
  };
  assert.equal(associateLegacyHashes({ normalizedRemoteHash: "rem123", hashIndex }).provenance, "legacy-remote-hash");
  assert.equal(associateLegacyHashes({ rootHash: "root456", hashIndex }).provenance, "legacy-root-hash");
  assert.equal(associateLegacyHashes({ normalizedRemoteHash: "nope", rootHash: "nope", hashIndex }).provenance, "unresolved");

  // ---- Plans source coverage / enrollment planning ----
  const parent = path.join(tempRoot, "projects");
  const child = path.join(parent, "app");
  fs.mkdirSync(child, { recursive: true });
  assert.equal(plansSourceCoverage(child, [parent]), path.resolve(parent), "descendant is covered by parent source");
  assert.equal(plansSourceCoverage(child, [path.join(tempRoot, "elsewhere")]), null);
  assert.equal(plansSourceCoverage(parent, [parent]), path.resolve(parent), "exact match is covered");

  const enrollCovered = planPlansEnrollment(child, [parent]);
  assert.equal(enrollCovered.covered, true);
  const enrollUncovered = planPlansEnrollment(child, []);
  assert.equal(enrollUncovered.covered, false);
  assert.equal(enrollUncovered.suggestedSource, path.resolve(child), "narrow default is the exact repo root, never a parent");

  // ---- Localhoster alias import: idempotent, canonical mapping, skips non-repo targets ----
  assert.equal(canonicalizeLocalhosterIdentity("git:github.com/kirinmurphy/roborepo").id, "git:github.com/kirinmurphy/roborepo");
  assert.equal(canonicalizeLocalhosterIdentity("path:/tmp/robo").kind, "local");
  assert.ok(!canonicalizeLocalhosterIdentity("path:/tmp/robo").id.includes("/tmp"), "path import must not leak path");
  assert.equal(canonicalizeLocalhosterIdentity("process:/tmp:node"), null);
  assert.equal(canonicalizeLocalhosterIdentity("roborepo:portal"), null);

  const migReg = defaultRegistry();
  const lhSettings = {
    aliases: {
      "path:/tmp/robo": "git:github.com/kirinmurphy/roborepo",
      "process:/x:node": "process:/y:node", // not a canonical target -> skipped
    },
  };
  const first = importLocalhosterAliases(migReg, lhSettings);
  assert.equal(first.changed, true);
  assert.equal(first.imported.length, 1);
  assert.equal(first.skipped.length, 1);
  assert.equal(resolveRegistryAlias(migReg, "path:/tmp/robo"), "git:github.com/kirinmurphy/roborepo");
  assert.ok(migReg.repositories["git:github.com/kirinmurphy/roborepo"], "alias target repository created");
  const second = importLocalhosterAliases(migReg, lhSettings);
  assert.equal(second.changed, false, "re-import is idempotent");
  validateRegistry(migReg);

  // ---- Provider URL builder: recognized hosts only, never for local ids ----
  assert.equal(providerUrlForRepositoryId("git:github.com/kirinmurphy/roborepo"), "https://github.com/kirinmurphy/roborepo");
  assert.equal(providerUrlForRepositoryId("git:gitlab.com/g/p"), "https://gitlab.com/g/p");
  assert.equal(providerUrlForRepositoryId("git:git.example.com/g/p"), null, "unknown host gets no url");
  assert.equal(providerUrlForRepositoryId("local:deadbeefdeadbeef"), null);

  // ---- Findings contract: repo-scoped vs global; never force association ----
  const scoped = repositoryScopedFinding({ code: "X" }, { repositoryId: "git:github.com/kirinmurphy/roborepo", rootId: "aaaa1111" });
  assert.equal(scoped.scope, "repository");
  assert.equal(scoped.repositoryId, "git:github.com/kirinmurphy/roborepo");
  assert.equal(scoped.rootId, "aaaa1111");
  assert.equal(isRepositoryScoped(scoped), true);
  const glob = globalFinding({ code: "Y" });
  assert.equal(glob.scope, "global");
  assert.equal(glob.repositoryId, undefined, "global finding never carries a repositoryId");
  assert.equal(isRepositoryScoped(glob), false);
  assert.throws(() => repositoryScopedFinding({}, { repositoryId: "path:/x" }), /invalid repository id/);

  console.log("repositories-check passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

// Test helper: mimic what localhoster discovery does — attach repository fields to a resolved
// identity — so association sees the same shape production does.
function withRepo(identity) {
  return { ...identity, repositoryId: canonicalRepositoryId(identity), rootId: identity.projectRoot ? rootId(identity.projectRoot) : null };
}

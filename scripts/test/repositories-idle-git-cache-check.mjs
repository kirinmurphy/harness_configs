#!/usr/bin/env node
// The cross-poll git cache for idle repositories. Everything here exists to hold one line: a cached
// reading is only reused while the checkout's git directory is byte-for-byte as stale as it was.
import assert from "node:assert/strict";
import { createIdleGitCache } from "../../modules/repositories/idle-git-cache.mjs";

// Fake stat surface, so the whole suite runs without touching a real repository.
function fakeFs(mtimes) {
  return {
    statSync(filePath) {
      if (!(filePath in mtimes)) {
        const err = new Error(`ENOENT: ${filePath}`);
        err.code = "ENOENT";
        throw err;
      }
      return { mtimeMs: mtimes[filePath] };
    },
  };
}

const GIT_DIR = "/repo/.git";
const baseline = () => ({
  "/repo/.git": 100,
  "/repo/.git/HEAD": 200,
  "/repo/.git/index": 300,
  "/repo/.git/packed-refs": 400,
});

// The point of the cache: an idle repository costs one git read, not one per poll. Without this a
// dozen idle repositories cost a dozen subprocesses every ~10s, forever, for data that changes only
// when the user commits.
{
  const mtimes = baseline();
  const cache = createIdleGitCache({ fsApi: fakeFs(mtimes) });
  let reads = 0;
  const read = async () => { reads += 1; return { branch: "main" }; };
  for (let i = 0; i < 5; i += 1) await cache.get("/repo", GIT_DIR, read);
  assert.equal(reads, 1);
}

// And the reason scan-cache.mjs refuses to do this at all: a cache that cannot notice a change would
// pin the first reading a long-lived portal ever took and report it forever. Each of these files is
// rewritten by a different ordinary operation, so each must independently invalidate.
for (const target of ["/repo/.git", "/repo/.git/HEAD", "/repo/.git/index", "/repo/.git/packed-refs"]) {
  const mtimes = baseline();
  const cache = createIdleGitCache({ fsApi: fakeFs(mtimes) });
  let reads = 0;
  const read = async () => { reads += 1; return { branch: "main" }; };
  await cache.get("/repo", GIT_DIR, read);
  mtimes[target] += 1;
  await cache.get("/repo", GIT_DIR, read);
  assert.equal(reads, 2, `${target} must invalidate the entry`);
  // ...and the fresh reading is then itself cached, rather than re-reading every poll after a change.
  await cache.get("/repo", GIT_DIR, read);
  assert.equal(reads, 2, `${target} must re-cache after invalidating`);
}

// A file appearing where there was none is a change too — a fresh clone has no packed-refs until its
// first fetch, and treating "absent" as equal to "present" would miss it.
{
  const mtimes = baseline();
  delete mtimes["/repo/.git/packed-refs"];
  const cache = createIdleGitCache({ fsApi: fakeFs(mtimes) });
  let reads = 0;
  const read = async () => { reads += 1; return { branch: "main" }; };
  await cache.get("/repo", GIT_DIR, read);
  mtimes["/repo/.git/packed-refs"] = 500;
  await cache.get("/repo", GIT_DIR, read);
  assert.equal(reads, 2);
}

// An unreadable git directory is never cached. A checkout on an unplugged drive must not answer from
// a reading taken while it was still mounted — the same refusal to treat "cannot look" as evidence
// that deriveLifecycle makes.
{
  const cache = createIdleGitCache({ fsApi: fakeFs({}) });
  let reads = 0;
  const read = async () => { reads += 1; return null; };
  await cache.get("/repo", GIT_DIR, read);
  await cache.get("/repo", GIT_DIR, read);
  assert.equal(reads, 2);
  assert.equal(cache.size, 0);
}

// A checkout that goes unreadable drops whatever was cached for it, rather than serving the old
// reading until something else evicts it.
{
  const mtimes = baseline();
  const fsApi = fakeFs(mtimes);
  const cache = createIdleGitCache({ fsApi });
  await cache.get("/repo", GIT_DIR, async () => ({ branch: "main" }));
  assert.equal(cache.size, 1);
  for (const key of Object.keys(mtimes)) delete mtimes[key];
  await cache.get("/repo", GIT_DIR, async () => null);
  assert.equal(cache.size, 0);
}

// Entries are per checkout, so two worktrees of one repository do not share a reading.
{
  const mtimes = { ...baseline(), "/other/.git": 10, "/other/.git/HEAD": 20, "/other/.git/index": 30, "/other/.git/packed-refs": 40 };
  const cache = createIdleGitCache({ fsApi: fakeFs(mtimes) });
  const first = await cache.get("/repo", GIT_DIR, async () => ({ branch: "main" }));
  const second = await cache.get("/other", "/other/.git", async () => ({ branch: "feature" }));
  assert.equal(first.branch, "main");
  assert.equal(second.branch, "feature");
  assert.equal(cache.size, 2);
}

// retain() bounds the cache to checkouts still in play, so a long session does not accumulate
// entries for repositories that have since been removed.
{
  const mtimes = { ...baseline(), "/other/.git": 10, "/other/.git/HEAD": 20, "/other/.git/index": 30, "/other/.git/packed-refs": 40 };
  const cache = createIdleGitCache({ fsApi: fakeFs(mtimes) });
  await cache.get("/repo", GIT_DIR, async () => ({ branch: "main" }));
  await cache.get("/other", "/other/.git", async () => ({ branch: "feature" }));
  cache.retain(["/repo"]);
  assert.equal(cache.size, 1);
  let reads = 0;
  await cache.get("/repo", GIT_DIR, async () => { reads += 1; return { branch: "main" }; });
  assert.equal(reads, 0, "the retained entry is still a hit");
  cache.retain([]);
  assert.equal(cache.size, 0);
}

// A missing root path is passed straight through rather than keyed on undefined.
{
  const cache = createIdleGitCache({ fsApi: fakeFs(baseline()) });
  let reads = 0;
  const read = async () => { reads += 1; return null; };
  await cache.get(null, GIT_DIR, read);
  await cache.get("", GIT_DIR, read);
  assert.equal(reads, 2);
  assert.equal(cache.size, 0);
}

console.log("ok: repositories idle git cache");

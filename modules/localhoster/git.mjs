// Git context for a discovered app's repository root: branch, commit, dirty state, ahead/behind.
//
// Two collection strategies, deliberately split:
//   fs reads     branch, detached HEAD, commit sha, upstream name — cheap, always available, and
//                correct even when the `git` binary is missing entirely.
//   subprocess   dirty, ahead/behind — see modules/repositories/git-exec.mjs for why these cannot
//                be read correctly from the filesystem.
//
// Every field is nullable and `dirty`/`ahead`/`behind` are null (never false/0) when the subprocess
// could not answer. Correct-or-absent: a card that shows nothing is honest, a card that shows
// "clean" for a repo we failed to inspect is a lie the user would act on.
//
// Refs are read from existing local state only. Nothing here contacts a remote — ahead/behind is
// measured against the remote-tracking ref as it was at the user's last fetch, which is exactly the
// "how far ahead am I" question a dashboard should answer without mutating anything.

import fs from "node:fs";
import path from "node:path";
import { realpathOf, resolveGitDir } from "../repositories/identity.mjs";
import { defaultRunGit, GIT_TIMEOUT_MS } from "../repositories/git-exec.mjs";
import {
  parseAheadBehind,
  parseHeadRef,
  parsePackedRefs,
  parseUpstreamFromConfig,
  shortSha,
} from "./git-refs.mjs";

export async function collectGitContext(projectRoot, options = {}) {
  if (!projectRoot) return null;
  const { scanCache = null } = options;
  if (!scanCache) return readGitContext(projectRoot, options);
  // Key on the realpath so a symlinked and unsymlinked path share one entry, matching the discipline
  // localRepositoryIdForRoot enforces for ids.
  const key = realpathOf(projectRoot, options.fsApi || fs);
  return scanCache.get(key, () => readGitContext(projectRoot, options));
}

// Collect once per unique repository root across a set of instances, then hand back a lookup keyed
// by the ORIGINAL projectRoot string so callers can attach results without re-realpathing. N apps in
// one repository cost one collection.
export async function collectGitForRoots(items, options = {}) {
  const { collectGit = collectGitContext } = options;
  const byRoot = new Map();
  const roots = new Set();
  for (const item of items) {
    const root = item?.identity?.projectRoot;
    if (root) roots.add(root);
  }
  await Promise.all(
    Array.from(roots, async (root) => {
      byRoot.set(root, await collectGit(root, options));
    }),
  );
  return byRoot;
}

async function readGitContext(projectRoot, options) {
  const { fsApi = fs, pathApi = path, runGit = defaultRunGit, timeoutMs = GIT_TIMEOUT_MS } = options;

  const resolved = resolveGitDir(projectRoot, { fsApi, pathApi });
  if (!resolved) return unavailable("not-a-git-root");

  const head = parseHeadRef(readText(fsApi, pathApi.join(resolved.gitDir, "HEAD")));
  if (!head) return unavailable("unreadable-head");

  const sha = head.detached
    ? head.head
    : resolveRefSha(head.ref, resolved, { fsApi, pathApi });
  const upstream = head.branch
    ? parseUpstreamFromConfig(readText(fsApi, pathApi.join(resolved.commonDir, "config")), head.branch)
    : null;

  // Both subprocess calls are independent, so pay for one round of latency rather than two.
  const [dirty, aheadBehind] = await Promise.all([
    readDirty(projectRoot, runGit, timeoutMs),
    upstream ? readAheadBehind(projectRoot, upstream, runGit, timeoutMs) : Promise.resolve(null),
  ]);

  return {
    branch: head.branch,
    detached: head.detached,
    head: sha,
    shortHead: shortSha(sha),
    dirty,
    ahead: aheadBehind?.ahead ?? null,
    behind: aheadBehind?.behind ?? null,
    upstream,
    isWorktree: resolved.isWorktree,
    provider: { ok: true, reason: null },
  };
}

// A branch ref lives either as a loose file under refs/ or packed into packed-refs. A linked
// worktree keeps its own HEAD and refs in gitDir but shares packed-refs with the primary repository
// via commonDir, so both locations are checked.
function resolveRefSha(ref, resolved, { fsApi, pathApi }) {
  if (!ref) return null;
  for (const dir of uniqueDirs(resolved)) {
    const loose = readText(fsApi, pathApi.join(dir, ref));
    if (loose && /^[0-9a-f]{40}$/i.test(loose.trim())) return loose.trim().toLowerCase();
  }
  for (const dir of uniqueDirs(resolved)) {
    const packed = readText(fsApi, pathApi.join(dir, "packed-refs"));
    if (!packed) continue;
    const sha = parsePackedRefs(packed).get(ref);
    if (sha) return sha;
  }
  return null;
}

function uniqueDirs({ gitDir, commonDir }) {
  return gitDir === commonDir ? [gitDir] : [gitDir, commonDir];
}

// `--porcelain=v1 -z` gives a stable, machine-readable listing; we only need whether it is empty.
// The file list itself is deliberately discarded — the snapshot is served over HTTP and there is no
// reason to put a user's in-progress filenames on the wire.
async function readDirty(cwd, runGit, timeoutMs) {
  const result = await runGit(cwd, ["status", "--porcelain=v1", "--untracked-files=normal", "-z"], {
    timeoutMs,
  });
  if (!result?.ok) return null;
  return result.stdout.trim().length > 0;
}

async function readAheadBehind(cwd, upstream, runGit, timeoutMs) {
  const result = await runGit(cwd, ["rev-list", "--left-right", "--count", `${upstream}...HEAD`], {
    timeoutMs,
  });
  if (!result?.ok) return null;
  return parseAheadBehind(result.stdout);
}

function readText(fsApi, filePath) {
  try {
    return fsApi.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function unavailable(reason) {
  return {
    branch: null,
    detached: false,
    head: null,
    shortHead: null,
    dirty: null,
    ahead: null,
    behind: null,
    upstream: null,
    isWorktree: false,
    provider: { ok: false, reason },
  };
}

import fs from "node:fs";
import path from "node:path";
import { defaultRunGit, GIT_TIMEOUT_MS } from "./git-exec.mjs";
import { resolveGitDir } from "./identity.mjs";

const FIELD = "%00";
const RECORD = "%0a";
const BRANCH_SYNC_FORMAT = [
  "%(refname:short)",
  "%(upstream:short)",
  "%(upstream:remotename)",
  "%(upstream:remoteref)",
  "%(upstream:track)",
].join(FIELD) + RECORD;

export async function collectBranchSyncFacts(projectRoot, options = {}) {
  const { fsApi = fs, pathApi = path, runGit = defaultRunGit, timeoutMs = GIT_TIMEOUT_MS } = options;
  const resolved = resolveGitDir(projectRoot, { fsApi, pathApi });
  if (!resolved) {
    return { fetchedAt: null, branches: [], provider: { ok: false, reason: "not-a-git-root" } };
  }

  const result = await runGit(projectRoot, [
    "for-each-ref",
    `--format=${BRANCH_SYNC_FORMAT}`,
    "refs/heads",
  ], { timeoutMs });

  if (!result?.ok) {
    return {
      fetchedAt: readFetchTime(fsApi, pathApi, resolved),
      branches: [],
      provider: { ok: false, reason: result?.error || "branch-sync-failed" },
    };
  }

  return {
    fetchedAt: readFetchTime(fsApi, pathApi, resolved),
    branches: parseBranchSyncOutput(result.stdout),
    provider: { ok: true, reason: null },
  };
}

export function parseBranchSyncOutput(stdout) {
  return String(stdout || "")
    .split("\n")
    .filter(Boolean)
    .map(parseBranchSyncLine)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseBranchSyncLine(line) {
  const [name, upstream, upstreamRemote, upstreamRemoteRef, track] = line.split("\0");
  if (!name) return null;
  const counts = parseTrackingCounts(track, Boolean(upstream));
  const trackingState = trackingStateFor({ upstream, upstreamRemote, upstreamRemoteRef, track, counts });
  return {
    name,
    upstream: upstream || null,
    upstreamRemote: upstreamRemote || null,
    upstreamRemoteRef: upstreamRemoteRef || null,
    ahead: counts?.ahead ?? null,
    behind: counts?.behind ?? null,
    trackingState,
  };
}

function parseTrackingCounts(track, hasUpstream) {
  if (!track) return hasUpstream ? { ahead: 0, behind: 0 } : null;
  if (track === "[gone]") return null;
  const ahead = /\bahead (\d+)/.exec(track);
  const behind = /\bbehind (\d+)/.exec(track);
  return {
    ahead: ahead ? Number.parseInt(ahead[1], 10) : 0,
    behind: behind ? Number.parseInt(behind[1], 10) : 0,
  };
}

function trackingStateFor({ upstream, upstreamRemote, upstreamRemoteRef, track, counts }) {
  if (!upstream) return "no_upstream";
  if (upstreamRemote === ".") return "local_upstream";
  if (!upstreamRemote || !upstreamRemoteRef) return "gone";
  if (track === "[gone]") return "gone";
  if (!counts) return "unknown";
  return "ok";
}

function readFetchTime(fsApi, pathApi, { gitDir, commonDir }) {
  for (const dir of gitDir === commonDir ? [gitDir] : [gitDir, commonDir]) {
    try {
      return Math.floor(fsApi.statSync(pathApi.join(dir, "FETCH_HEAD")).mtimeMs / 1000);
    } catch {
      // Try common dir before giving up.
    }
  }
  return null;
}

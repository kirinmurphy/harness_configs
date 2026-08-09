import { runGitProcess } from "./git-exec.mjs";

export const GIT_NETWORK_TIMEOUT_MS = 20_000;

export async function refreshRemote(projectRoot, remote, options = {}) {
  const { runGit = runGitProcess, timeoutMs = GIT_NETWORK_TIMEOUT_MS } = options;
  const result = await runGit(projectRoot, [
    "-c",
    "gc.auto=0",
    "-c",
    "maintenance.auto=false",
    "fetch",
    "--prune",
    "--no-recurse-submodules",
    remote,
  ], { timeoutMs });
  return shapeRemoteResult(result, remote);
}

export async function pushBranchToUpstream(projectRoot, branch, upstream, options = {}) {
  const { runGit = runGitProcess, timeoutMs = GIT_NETWORK_TIMEOUT_MS } = options;
  if (!branch || !upstream?.upstreamRemote || !upstream?.upstreamRemoteRef) {
    return { ok: false, remote: upstream?.upstreamRemote || null, error: "missing upstream target" };
  }
  const result = await runGit(projectRoot, [
    "push",
    upstream.upstreamRemote,
    `refs/heads/${branch}:${upstream.upstreamRemoteRef}`,
  ], { timeoutMs });
  return shapeRemoteResult(result, upstream.upstreamRemote);
}

function shapeRemoteResult(result, remote) {
  if (result?.ok) return { ok: true, remote, error: null };
  const message = [result?.stderr, result?.stdout, result?.error].filter(Boolean).join("\n").trim();
  return {
    ok: false,
    remote,
    error: conciseGitError(message),
  };
}

function conciseGitError(message) {
  const first = String(message || "git operation failed")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return first || "git operation failed";
}

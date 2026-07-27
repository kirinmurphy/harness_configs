// Pure parsers for the Git plumbing files Localhoster reads directly. No filesystem access and no
// subprocesses — every function here is string in, value out, so they are testable without a fixture
// repository at all. The fs orchestration lives in git.mjs.

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

// `.git/HEAD` is either a symbolic ref (`ref: refs/heads/main`) or, when detached, a raw commit sha.
// Returns { branch, ref, detached, head } where head is only populated in the detached case — an
// attached HEAD still needs its ref resolved to a sha by resolveRefSha.
export function parseHeadRef(content) {
  const trimmed = String(content ?? "").trim();
  if (!trimmed) return null;

  const symbolic = trimmed.match(/^ref:\s*(.+)$/);
  if (symbolic) {
    const ref = symbolic[1].trim();
    return {
      branch: ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null,
      ref,
      detached: false,
      head: null,
    };
  }

  if (SHA_PATTERN.test(trimmed)) {
    return { branch: null, ref: null, detached: true, head: trimmed.toLowerCase() };
  }
  return null;
}

// `.git/packed-refs` holds refs that have been packed away, so a branch may have no loose
// `.git/refs/heads/<name>` file. Lines are `<sha> <refname>`; `#` comments and `^<sha>` peeled-tag
// lines are skipped. Returns a Map of refname -> sha.
export function parsePackedRefs(content) {
  const refs = new Map();
  for (const raw of String(content ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("^")) continue;
    const match = line.match(/^([0-9a-f]{40})\s+(.+)$/i);
    if (match) refs.set(match[2].trim(), match[1].toLowerCase());
  }
  return refs;
}

// Extract a branch's configured upstream from a Git config file. A `[branch "main"]` section carries
// `remote = origin` and `merge = refs/heads/main`; together those name the remote-tracking ref
// `origin/main` that ahead/behind is measured against. Returns null when the branch has no upstream
// (a purely local branch, or a repository with no remote at all).
export function parseUpstreamFromConfig(content, branch) {
  if (!branch) return null;
  const target = `[branch "${branch}"]`;
  let inSection = false;
  let remote = null;
  let merge = null;

  for (const raw of String(content ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      // A new section ends the one we care about; stop once we have finished reading it.
      if (inSection) break;
      inSection = line === target;
      continue;
    }
    if (!inSection) continue;
    const remoteMatch = line.match(/^remote\s*=\s*(.+)$/);
    if (remoteMatch) remote = remoteMatch[1].trim();
    const mergeMatch = line.match(/^merge\s*=\s*(.+)$/);
    if (mergeMatch) merge = mergeMatch[1].trim();
  }

  if (!remote || !merge) return null;
  // `.` is Git's notation for "this repository" (a branch tracking another local branch). There is
  // no remote-tracking ref in that case, so report the merge target as-is.
  const shortMerge = merge.startsWith("refs/heads/") ? merge.slice("refs/heads/".length) : merge;
  return remote === "." ? shortMerge : `${remote}/${shortMerge}`;
}

// Git reports ahead/behind as a tab-separated pair from `rev-list --left-right --count A...B`, where
// the left count is commits reachable from A (upstream) only and the right from B (HEAD) only.
export function parseAheadBehind(stdout) {
  const match = String(stdout ?? "").trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) return null;
  return { behind: Number(match[1]), ahead: Number(match[2]) };
}

export function shortSha(sha) {
  return typeof sha === "string" && SHA_PATTERN.test(sha) ? sha.slice(0, 7) : null;
}

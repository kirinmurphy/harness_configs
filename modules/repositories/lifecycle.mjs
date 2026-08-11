// Repository lifecycle: what state a persisted repository is in right now.
//
// Derived on every scan rather than stored. Two of the three states depend on whether a directory
// is readable *at this moment* — an unplugged drive changes the answer without the record changing
// at all — so persisting them would let the registry assert something that was true when it was
// written and false when it is read. The registry keeps the durable facts (firstSeenAt/lastSeenAt,
// which roots exist); this derives the observation.
//
// The distinction the whole module turns on is between LOOKING AND FINDING NOTHING and NOT BEING
// ABLE TO LOOK. Only the first is evidence a checkout is gone. Treating an unreadable parent as
// absence would mark every repository on an unmounted share as `stale` the moment it is unplugged.

import fs from "node:fs";
import path from "node:path";
import { checkoutRootsFor } from "./registry.mjs";

export const LIFECYCLE_STATES = ["active", "idle", "stale"];

// 30 days. Measured from lastSeenAt — see ageOutCandidates below for why not from staleness.
export const AGE_OUT_MS = 30 * 24 * 60 * 60 * 1000;

// A single checkout's readability, as three outcomes rather than a boolean, because "I could not
// look" must never collapse into "it is not there".
//   present     - the directory and its .git both resolve
//   absent      - the parent is readable and the checkout genuinely is not in it
//   unreadable  - the parent could not be read at all (unmounted share, unplugged drive, EACCES)
export function inspectCheckout(rootPath, { fsApi = fs } = {}) {
  try {
    fsApi.statSync(rootPath);
  } catch (err) {
    if (err?.code === "ENOENT") {
      // The checkout is not here. Whether that is evidence depends entirely on whether we could
      // read the directory that would contain it.
      const parent = path.dirname(rootPath);
      try {
        fsApi.statSync(parent);
        return { state: "absent", reason: "checkout directory no longer exists" };
      } catch {
        return { state: "unreadable", reason: "parent directory is not readable" };
      }
    }
    // EACCES/EPERM/EIO and friends: we were blocked, not answered.
    return { state: "unreadable", reason: `checkout is not readable (${err?.code || "unknown"})` };
  }
  // The directory exists. A checkout without a .git entry is no longer a repository — that IS a
  // finding, not a failure to look. .git is a directory in a clone and a file in a worktree, so its
  // presence is what matters, not its type.
  try {
    fsApi.statSync(path.join(rootPath, ".git"));
  } catch (err) {
    if (err?.code === "ENOENT") return { state: "absent", reason: "no longer a git checkout" };
    return { state: "unreadable", reason: `.git is not readable (${err?.code || "unknown"})` };
  }
  return { state: "present", reason: null };
}

// The lifecycle state of one repository.
//
// `runningRepositoryIds` is the set resolved by the current scan — a repository with a live
// listener is `active` and nothing on disk needs consulting, which also keeps the common case free
// of filesystem calls.
//
// A repository is `stale` only when EVERY checkout was looked at and none survived. One readable
// checkout keeps it `idle`, and — critically — one *unreadable* checkout also keeps it `idle`,
// because an unreadable checkout is not evidence of anything.
export function deriveLifecycle(registry, repositoryId, { runningRepositoryIds = new Set(), fsApi = fs } = {}) {
  if (runningRepositoryIds.has(repositoryId)) {
    return { state: "active", reason: null, checkouts: [] };
  }
  const roots = checkoutRootsFor(registry, repositoryId);
  if (!roots.length) {
    // Known repository, no path ever recorded (registered by a source that never resolved a root).
    // Nothing was looked at, so this cannot be stale.
    return { state: "idle", reason: "no checkout path on record", checkouts: [] };
  }
  const checkouts = roots.map((root) => ({ ...root, ...inspectCheckout(root.path, { fsApi }) }));
  if (checkouts.some((c) => c.state === "present")) {
    return { state: "idle", reason: null, checkouts };
  }
  if (checkouts.some((c) => c.state === "unreadable")) {
    // Could not look. Never treat as absence, however many other checkouts are confirmed gone.
    const blocked = checkouts.find((c) => c.state === "unreadable");
    return { state: "idle", reason: blocked.reason, checkouts };
  }
  return { state: "stale", reason: checkouts[0].reason, checkouts };
}

// The most recent moment anything about this repository was observed. Roots and discoveries both
// carry lastSeenAt; the newest of them is the repository's.
export function lastSeenAtFor(record) {
  const stamps = [
    ...(record?.localRoots || []).map((r) => r.lastSeenAt),
    ...(record?.discoveries || []).map((d) => d.lastSeenAt),
  ].filter(Boolean);
  if (!stamps.length) return null;
  return stamps.reduce((newest, s) => (Date.parse(s) > Date.parse(newest) ? s : newest));
}

// Repositories that should drop out of the normal list because they have not been seen in 30 days.
//
// Two rules that look like edge cases but are the point:
//
// 1. Ageing measures lastSeenAt, NOT time spent stale. A repository on an unplugged drive becomes
//    stale immediately, but it is still one you use; ageing on staleness would hide it within days
//    of unplugging. Ageing on last-seen hides it only if you genuinely stop using it.
//
// 2. A record with no lastSeenAt at all NEVER ages out. "Never seen" is not "seen long ago" — such
//    records exist (registered by a source that never resolved a root), and treating a missing
//    timestamp as infinitely old would hide them all on the first sweep.
//
// This returns candidates rather than hiding them, so the caller owns the write and a repository
// the user explicitly un-hid is not re-hidden behind their back.
export function ageOutCandidates(registry, { now = Date.now(), ageOutMs = AGE_OUT_MS } = {}) {
  const out = [];
  for (const [id, record] of Object.entries(registry.repositories || {})) {
    if (record.visibility === "hidden") continue;
    const lastSeen = lastSeenAtFor(record);
    if (!lastSeen) continue; // Never seen is not seen long ago.
    if (now - Date.parse(lastSeen) > ageOutMs) out.push({ repositoryId: id, lastSeenAt: lastSeen });
  }
  return out;
}

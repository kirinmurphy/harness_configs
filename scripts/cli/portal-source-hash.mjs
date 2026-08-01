import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { repoRoot } from "./paths.mjs";

// Content hash of the portal's served/serving source (portal/ + scripts/cli/, the same tree
// portal-server.mjs reads from and is itself part of; plus modules/, which portal routes like
// portal-routes-localhoster.mjs import transitively). A running `roborepo web`/`localhoster`
// server is detached on purpose so it outlives the CLI invocation that spawned it — but a Node
// process never re-reads .mjs files after a later git pull/merge changes them on disk, so it can
// keep serving stale portal code indefinitely with no visible sign anything is wrong. The server
// computes this once at startup and reports it via /api/portal/status; a new `serve`/`web`
// invocation recomputes it fresh from the current checkout and compares (see resolvePortalPort in
// telemetry.mjs) to detect "a portal is already running here, but its code is now stale."
export function computePortalSourceHash() {
  const hash = crypto.createHash("sha256");
  const roots = [
    path.join(repoRoot, "portal"),
    path.join(repoRoot, "scripts", "cli"),
    path.join(repoRoot, "modules"),
  ];
  for (const root of roots) {
    for (const rel of walkFiles(root)) {
      hash.update(rel);
      hash.update("\0");
      try {
        hash.update(fs.readFileSync(path.join(root, rel)));
      } catch {
        // File vanished between listing and read (rare race) — skip rather than fail.
      }
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

function walkFiles(dir, base = dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(abs, base, out);
    else if (entry.isFile()) out.push(path.relative(base, abs));
  }
  return out;
}

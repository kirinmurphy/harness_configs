// Host bind-mount sources per container, used to recover a Compose project's repository when the
// project carries no `com.docker.compose.project.working_dir` label.
//
// Containers started by a tool other than `docker compose up` — Supabase CLI is the case that
// motivated this — get `com.docker.compose.project` but no working_dir, so discovery.mjs's
// auto-derivation has nothing to resolve from. Their bind mounts still point into the project
// directory, which is enough to find the repo (see resolveRepoPathFromMounts in discovery.mjs).
//
// Deliberately a separate call from docker.mjs's `docker ps`: mounts are not in `docker ps` output
// at any --format, so this needs `docker inspect`. One batched call for every container id that
// needs inspecting, not one per container, matching the same "N things, one call" discipline as the
// rest of this module. Callers only inspect containers whose project failed working_dir resolution,
// so the common case makes no call at all.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Crosses the same Docker Desktop VM-proxy boundary as `docker ps`/`docker stats` (see docker.mjs
// for why that needs more headroom than lsof/ps), and inspects several containers per call.
export const DOCKER_MOUNTS_TIMEOUT_MS = 6000;

const execFileAsync = promisify(execFile);

export async function collectDockerMounts(containerIds, {
  platform = process.platform,
  runCommand = defaultRunCommand,
  timeoutMs = DOCKER_MOUNTS_TIMEOUT_MS,
} = {}) {
  const ids = [...new Set(containerIds)].filter((id) => typeof id === "string" && id);
  if (platform !== "darwin" || ids.length === 0) return new Map();

  let result;
  try {
    result = await runCommand("docker", ["inspect", "--format", "{{json .}}", ...ids], { timeoutMs });
  } catch {
    // A container that exited between `docker ps` and here makes `docker inspect` exit non-zero.
    // Missing mount data costs a repo association, never the scan — absence, not an error.
    return new Map();
  }
  return parseDockerInspectOutput(result.stdout ?? result);
}

// One independently-parseable JSON object per line, same shape as `docker ps --format '{{json .}}'`,
// so a single malformed line is skipped rather than invalidating the batch.
//
// Keyed by the SHORT id: `docker inspect` reports the full 64-char `Id` while `docker ps` (and
// therefore every container record in this module) carries the 12-char form. Truncating here is
// what lets callers join on the id they already hold.
export function parseDockerInspectOutput(output) {
  const byContainerId = new Map();
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let raw;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!raw || typeof raw !== "object" || typeof raw.Id !== "string" || !raw.Id) continue;
    byContainerId.set(raw.Id.slice(0, 12), bindSources(raw.Mounts));
  }
  return byContainerId;
}

// Only `bind` mounts carry a host path worth resolving. Named volumes (`volume`) live inside
// Docker's own storage and say nothing about where the project lives on disk.
function bindSources(mounts) {
  if (!Array.isArray(mounts)) return [];
  const sources = [];
  for (const mount of mounts) {
    if (!mount || mount.Type !== "bind") continue;
    if (typeof mount.Source !== "string" || !mount.Source.startsWith("/")) continue;
    if (!sources.includes(mount.Source)) sources.push(mount.Source);
  }
  return sources;
}

export async function defaultRunCommand(command, args, { timeoutMs } = {}) {
  return execFileAsync(command, args, { timeout: timeoutMs, encoding: "utf8", maxBuffer: 1024 * 1024 });
}

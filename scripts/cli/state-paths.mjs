import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stateRoot } from "./paths.mjs";

export const roborepoStateDir = stateRoot;

// Shared JSON state read/write, since roborepo has several small state files (install state,
// presets state, enabled packages, root-config state) that all need the same
// try/catch-with-fallback read and mkdir+write shape.
export function readJsonState(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJsonState(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}
export const installStatePath = path.join(roborepoStateDir, "install-state.json");
export const presetsStatePath = path.join(roborepoStateDir, "presets", "state.json");
export const roborepoSkillsDir = path.join(roborepoStateDir, "skills");
// Personal deny/ask/allow overrides layered on top of manifests/inventory/agent-permissions.json's
// default buckets. Keyed by behavior id (named behaviors) or a joined-token key (arbitrary
// commands) — see config-mutate.mjs overrideKeyForCommand. Lives outside the repo-tracked
// manifest so `roborepo update` (which re-renders the manifest's own defaults) never wipes a
// personal choice; the portal/onboard read paths merge this on top before displaying anything.
export const commandOverridesPath = path.join(roborepoStateDir, "command-overrides.json");
export const experimentalStatePath = path.join(roborepoStateDir, "experimental.json");
// Canonical repository registry — machine-local, versioned. modules/repositories owns the atomic
// read/write; this is just the resolved path (respects ROBOREPO_STATE_DIR).
export const repositoriesRegistryPath = path.join(roborepoStateDir, "repositories", "registry.json");
// Latest normalized usage snapshots, one file per harness (usage/latest/<harness>.json). Written
// best-effort by the status-line command (Claude) / app-server collector (Codex); read by the
// /api/usage portal route. See globals/packages/usage-statusline/scripts/usage-snapshot-store.mjs,
// which resolves this same path independently because it also runs as a copied runtime asset.
export const usageDir = path.join(roborepoStateDir, "usage");
export const usageLatestDir = path.join(usageDir, "latest");
export const telemetryDir = path.join(roborepoStateDir, "telemetry");
export const telemetryDbPath = path.join(telemetryDir, "telemetry.sqlite");
export const telemetrySpoolDir = path.join(telemetryDir, "spool");
export const telemetryCollectorDir = path.join(telemetryDir, "collector");
export const telemetryEventsDir = path.join(telemetryDir, "events");
export const telemetryMarkersPath = path.join(telemetryEventsDir, "markers.jsonl");
export const telemetrySnapshotsDir = path.join(telemetryDir, "snapshots");
export const telemetryExperimentsDir = path.join(telemetryDir, "experiments");
// Backups live OUTSIDE telemetryDir so `purge --all` (which removes telemetryDir) can't delete the
// snapshot it just took.
export const telemetryBackupDir = path.join(roborepoStateDir, "telemetry-backups");
// PID file for the detached portal server. The legacy env/path stay readable so older installs can
// be stopped and cleaned up after the server rename.
export const legacyTelemetryPidPath = process.env.ROBOREPO_TELEMETRY_PID_PATH
  || path.join(os.homedir(), ".local", "state", "roborepo", "telemetry-server.pid");
// Keyed by port, not a single fixed path: the portal server is inherently per-repo (it serves
// whatever repoRoot the invoking `roborepo web` resolves to), so two different checkouts/
// worktrees running on two different ports are legitimately two independent servers, not one
// "the" portal. A single shared PID file meant the most-recently-started instance's
// killExistingServer() would SIGTERM whichever OTHER repo's server happened to be recorded there,
// even though it wasn't actually occupying the port being started on. ROBOREPO_PORTAL_PID_PATH
// (set by test-telemetry-pid.sh to sandbox a temp dir) is an explicit override and wins outright,
// regardless of port — a caller setting it has already opted out of the per-port default scheme.
export function portalPidPathForPort(port) {
  if (process.env.ROBOREPO_PORTAL_PID_PATH) return process.env.ROBOREPO_PORTAL_PID_PATH;
  if (process.env.ROBOREPO_TELEMETRY_PID_PATH) return process.env.ROBOREPO_TELEMETRY_PID_PATH;
  // Routes through roborepoStateDir (respects ROBOREPO_STATE_DIR), unlike the legacy fixed path
  // above, so tests can sandbox per-port PID files the same way they already sandbox every other
  // piece of roborepo state.
  return path.join(roborepoStateDir, "portal", `server-${port}.pid`);
}
// Registry of enabled packages — source of truth for rules rendering (Phase 3+).
export const enabledPackagesPath = path.join(roborepoStateDir, "enabled-packages.json");
// Content hash of root config (settings.json / config.toml) as of roborepo's last write, keyed by
// harness. Lets update/repair tell "unchanged since we last wrote it" apart from "something else
// touched this file" without attempting to merge. See docs/plans/completed/root-config-layered-inheritance.md.
export const rootConfigStatePath = path.join(roborepoStateDir, "config-state", "root-config.json");
// Provenance for individual owned scalars a package sets inside a harness config (e.g. Codex's
// tui.status_line_use_colors). Content-hash drift (rootConfigStatePath) tracks whole-file writes; a
// scalar needs its own record of "did this key exist before roborepo set it, and if so, what was
// its value" so disable can restore an unmanaged prior value or remove a key roborepo introduced.
// Keyed by "<harness>.<table>.<key>". Lives in roborepo state, not a package-side backup file.
export const ownedScalarsStatePath = path.join(roborepoStateDir, "config-state", "owned-scalars.json");

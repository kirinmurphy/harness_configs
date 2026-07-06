import os from "node:os";
import path from "node:path";

export const roborepoStateDir = process.env.ROBOREPO_STATE_DIR || path.join(os.homedir(), ".roborepo");
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
export const telemetryDir = path.join(roborepoStateDir, "telemetry");
export const telemetryDbPath = path.join(telemetryDir, "telemetry.sqlite");
export const telemetrySpoolDir = path.join(telemetryDir, "spool");
export const telemetryCollectorDir = path.join(telemetryDir, "collector");
// Backups live OUTSIDE telemetryDir so `purge --all` (which removes telemetryDir) can't delete the
// snapshot it just took.
export const telemetryBackupDir = path.join(roborepoStateDir, "telemetry-backups");
// PID file for the detached portal server. The legacy env/path stay readable so older installs can
// be stopped and cleaned up after the server rename.
export const legacyTelemetryPidPath = process.env.ROBOREPO_TELEMETRY_PID_PATH
  || path.join(os.homedir(), ".local", "state", "roborepo", "telemetry-server.pid");
export const portalPidPath = process.env.ROBOREPO_PORTAL_PID_PATH
  || process.env.ROBOREPO_TELEMETRY_PID_PATH
  || path.join(os.homedir(), ".local", "state", "roborepo", "portal-server.pid");
// Registry of enabled packages — source of truth for rules rendering (Phase 3+).
export const enabledPackagesPath = path.join(roborepoStateDir, "enabled-packages.json");

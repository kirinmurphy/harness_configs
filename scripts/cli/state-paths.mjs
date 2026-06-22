import os from "node:os";
import path from "node:path";

export const roborepoStateDir = process.env.ROBOREPO_STATE_DIR || path.join(os.homedir(), ".roborepo");
export const installStatePath = path.join(roborepoStateDir, "install-state.json");
export const presetsStatePath = path.join(roborepoStateDir, "presets", "state.json");
// Records the permission profile last applied to the LIVE machine config by the config controls.
// Lets the dashboard show the active per-machine profile (which can differ from the repo default).
export const activeProfilePath = path.join(roborepoStateDir, "active-profile.json");
export const telemetryDir = path.join(roborepoStateDir, "telemetry");
export const telemetryDbPath = path.join(telemetryDir, "telemetry.sqlite");
export const telemetrySpoolDir = path.join(telemetryDir, "spool");
export const telemetryCollectorDir = path.join(telemetryDir, "collector");
// Backups live OUTSIDE telemetryDir so `purge --all` (which removes telemetryDir) can't delete the
// snapshot it just took.
export const telemetryBackupDir = path.join(roborepoStateDir, "telemetry-backups");
// PID file for the detached dashboard server. Env override enables sandboxed testing.
export const telemetryPidPath = process.env.ROBOREPO_TELEMETRY_PID_PATH
  || path.join(os.homedir(), ".local", "state", "roborepo", "telemetry-server.pid");

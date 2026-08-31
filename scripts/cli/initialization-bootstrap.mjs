// Shared procedural first-run bootstrap for `roborepo init` and `roborepo web`.
//
// `init` and `web` are the two public first-run entry points and they must produce the same
// machine state: workspace/state roots exist, supported harnesses were discovered and their state
// persisted, and the initialization record says `complete`. Historically only `init` ran these
// steps; `web` started the portal directly, so `npm install` → `roborepo web` reached a portal on
// a machine that had never been procedurally initialized.
//
// This module is the one implementation of that procedural bootstrap. `initCommand()` (initialize.mjs)
// and `serveCommand()` (telemetry.mjs) both call `ensureInitialized()` and decide their own
// presentation — this module never prints. That keeps the two entry points from drifting apart and
// avoids one reaching into the other (no `init`-calls-`web` or `web`-calls-`init` recursion).
//
// The operation is idempotent:
//
//   | Starting record  | Result                                   |
//   | ---------------- | ---------------------------------------- |
//   | missing          | run bootstrap, record `complete`         |
//   | in-progress      | resume bootstrap, preserve startedAt     |
//   | complete         | no mutation (unless `force`)             |
//   | newer schema     | refuse without overwriting the record    |
//
// Return values are structured (`status`, `phase`, `detected`, `steps`) so callers decide what, if
// anything, to print. `--dry-run` reports the same steps without writing state; `web` never passes
// it. `--force` (init only) re-runs the procedural bootstrap on an already-complete record.

import fs from "node:fs";
import { refreshHarnessState } from "../harnesses/refresh.mjs";
import { initializeWorkspace, stateRoot } from "./roots.mjs";
import {
  beginInitialization,
  completeInitialization,
  initializationPhase,
  readFutureInitializationState,
} from "./initialization-state.mjs";

// Presentation for a refused newer-schema record. Kept here (rather than inline in each caller) so
// `init` and `web` report the same downgrade explanation and cannot drift apart. Pure and
// side-effect free; callers choose the stream and whether to exit.
export function describeNewerSchemaRefusal(schemaVersion) {
  return [
    "This installation was initialized by a newer version of RoboRepo.",
    `  record schemaVersion: ${schemaVersion} (this build understands 1)`,
    "",
    "Upgrade RoboRepo again, or remove the initialization record to start over:",
    "  roborepo doctor        check installation health",
  ];
}

/**
 * Ensure the machine-local procedural bootstrap has run, running it if it has not.
 *
 * @param {object} [options]
 * @param {boolean} [options.force=false] Re-run the procedural bootstrap even when the record is
 *   already complete. Never discards a newer-schema record.
 * @param {boolean} [options.dryRun=false] Report the procedural steps without writing any state.
 * @returns {{
 *   status: "refused"|"noop"|"dryrun"|"bootstrapped",
 *   phase?: "missing"|"in-progress"|"complete",
 *   schemaVersion?: number,
 *   detected?: string[],
 *   steps?: string[],
 * }}
 */
export function ensureInitialized({ force = false, dryRun = false } = {}) {
  // A record written by a newer RoboRepo reads as "not initialized" (this build cannot vouch for
  // its shape), which would otherwise make us replay the whole bootstrap and overwrite it. Refuse
  // before touching anything — including under `force`, which means "re-run initialization", not
  // "discard a newer installation's state". Reported structurally so the caller can explain.
  const future = readFutureInitializationState();
  if (future) {
    return { status: "refused", schemaVersion: future.schemaVersion };
  }

  const phase = initializationPhase();

  if (phase === "complete" && !force) {
    return { status: "noop", phase };
  }

  if (dryRun) {
    return {
      status: "dryrun",
      phase,
      steps: [
        "create workspace and state directories",
        "refresh harness discovery",
        "mark initialization complete",
      ],
    };
  }

  // begin or resume. beginInitialization preserves the original startedAt across a resume so the
  // record still reports when the user first tried, not when they last retried.
  beginInitialization();
  initializeWorkspace();
  fs.mkdirSync(stateRoot, { recursive: true });
  const { detected } = refreshHarnessState();
  completeInitialization();

  return { status: "bootstrapped", phase, detected };
}

// Provenance for individual harness-config scalars a package owns (today: Codex's
// tui.status_line_use_colors). The whole-file drift tracker (root-config-state.mjs) can't answer
// "was this one key here before, and what was it" — which is exactly what a safe disable needs to
// either restore an unmanaged prior value or remove a key roborepo introduced. Records are keyed by
// "<harness>.<table>.<key>" and stored in roborepo state, not a package-side backup file.
import { ownedScalarsStatePath, readJsonState, writeJsonState } from "./state-paths.mjs";

const EMPTY_STATE = { version: 1, scalars: {} };

function scalarKey(harness, table, key) {
  return `${harness}.${table}.${key}`;
}

function readState() {
  return readJsonState(ownedScalarsStatePath, EMPTY_STATE);
}

// Record what the scalar looked like BEFORE roborepo set it. `priorValue` is undefined when the key
// was absent. Idempotent: re-enabling never overwrites the first-seen provenance, so repeated enable
// runs can't lose the user's original value.
export function recordOwnedScalar(harness, table, key, priorValue) {
  const state = readState();
  const id = scalarKey(harness, table, key);
  if (Object.hasOwn(state.scalars, id)) return;
  state.scalars[id] = { existed: priorValue !== undefined, priorValue };
  writeJsonState(ownedScalarsStatePath, state);
}

// The recorded provenance, or null if roborepo never recorded owning this scalar.
export function readOwnedScalar(harness, table, key) {
  return readState().scalars[scalarKey(harness, table, key)] || null;
}

export function clearOwnedScalar(harness, table, key) {
  const state = readState();
  const id = scalarKey(harness, table, key);
  if (!Object.hasOwn(state.scalars, id)) return;
  delete state.scalars[id];
  writeJsonState(ownedScalarsStatePath, state);
}

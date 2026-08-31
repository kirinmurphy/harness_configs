// Refresh-and-persist for machine harness discovery. The single implementation of
// "run discovery, merge into persisted harness state, write it back" shared by `roborepo harness
// refresh` (harness.mjs) and the procedural bootstrap (`roborepo init` / first-run `roborepo web`,
// initialization-bootstrap.mjs) so the two call sites cannot drift apart.
//
// Lives here rather than in state.mjs so the persisted-state module stays lean and this one job
// (discovery + merge + write) has an obvious home; lives in the harness layer rather than the CLI
// layer so command modules don't need to reach into a bootstrap module to refresh harnesses.
//
// Returns the detected provider ids alongside the new state so callers can summarize detection
// without re-deriving it — but presentation is the caller's job; this module never prints.

import { listHarnessProviders } from "./registry.mjs";
import { discoverHarnessProviders } from "./discovery.mjs";
import { readHarnessState, writeHarnessState, applyDiscoveryToState } from "./state.mjs";

export function refreshHarnessState() {
  const results = discoverHarnessProviders(listHarnessProviders());
  const next = applyDiscoveryToState(readHarnessState(), results);
  writeHarnessState(next);
  const detected = results
    .filter((entry) => entry.status === "detected")
    .map((entry) => entry.providerId);
  return { state: next, detected };
}

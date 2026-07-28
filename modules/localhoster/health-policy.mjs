// Tunables for health-state normalization. Kept apart from the classifier so the policy is one
// obvious place to look and classifyHealth stays a pure function of its inputs.
//
// These are defaults, not per-app settings. The per-app `health` block in settings-schema.mjs is a
// strict allow-list, so adding `startingGraceMs`/`failureThreshold` there later is forward
// compatible (older settings files simply lack the optional keys) and needs no SETTINGS_VERSION
// bump. Shipping the knobs before anything produces them would be config surface with no consumer.

// How long after an app is first seen a connection failure still reads as "starting" rather than a
// fault. Covers the window where a dev server has bound its port but is still compiling.
export const STARTING_GRACE_MS = 30_000;

// Consecutive failing probes required before a transition is recorded as `unhealthy`. With the 8s
// snapshot freshness window and the portal's 10s poll, a threshold of 2 means roughly 10-20s of
// sustained failure — long enough to swallow a dev-server restart, short enough to still be useful.
export const FAILURE_THRESHOLD = 2;

export const DEFAULT_HEALTH_POLICY = {
  startingGraceMs: STARTING_GRACE_MS,
  failureThreshold: FAILURE_THRESHOLD,
};

#!/usr/bin/env node
// Health-state normalization. classifyHealth is pure, so every check here is a sequence of probe
// results fed through it — no filesystem, no processes, no timers.
import assert from "node:assert/strict";
import {
  DEFAULT_HEALTH_POLICY,
  HEALTH_STATES,
  classifyHealth,
  healthIndexFromSnapshot,
} from "../../modules/localhoster/index.mjs";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const ok = { http: true, status: 200 };
const serverError = { http: true, status: 503 };
const refused = { http: false, status: null, errorCode: "ECONNREFUSED" };
const policy = { startingGraceMs: 30_000, failureThreshold: 2 };

// ---- Baseline mapping ----
assert.equal(classifyHealth({ probe: ok, now: T0 }).state, "healthy");
assert.equal(classifyHealth({ probe: null, now: T0 }).state, "unknown");
assert.equal(classifyHealth({ probe: ok, active: false, now: T0 }).state, "inactive");
assert.equal(
  classifyHealth({ probe: { http: true, status: 302 }, now: T0 }).state,
  "healthy",
  "a redirect to a login page is the common localhost case, not a fault",
);
assert.equal(
  classifyHealth({ probe: { http: true, status: null, tls: "untrusted" }, now: T0 }).state,
  "degraded",
  "reachable but with an untrusted certificate is degraded, not healthy",
);
for (const state of HEALTH_STATES) assert.equal(typeof state, "string");
console.log("ok  baseline state mapping");

// ---- An unconfigured 4xx is not evidence of a fault ----
// Plenty of listeners on a dev machine are gRPC endpoints or daemons that legitimately answer 403
// or 404 to a browser GET; calling those degraded would fill the dashboard with false alarms.
const bare404 = classifyHealth({ probe: { http: true, status: 404 }, now: T0 });
assert.equal(bare404.state, "unknown");
assert.equal(bare404.reason, "no-health-expectation");
assert.equal(bare404.consecutiveFailures, 0, "an unconfigured 4xx must not accrue failures");

// Once the user declares what healthy means, a mismatch IS meaningful.
const configured = classifyHealth({
  probe: { http: true, status: 404 },
  config: { acceptedStatuses: [200] },
  now: T0,
  policy,
});
assert.equal(configured.state, "degraded");
assert.equal(configured.reason, "status-not-accepted");
assert.equal(
  classifyHealth({ probe: { http: true, status: 204 }, config: { acceptedStatuses: [204] }, now: T0 }).state,
  "healthy",
  "acceptedStatuses admits a status the default range would reject",
);
console.log("ok  unconfigured 4xx is unknown, configured mismatch is a fault");

// ---- Failure debounce: degraded before unhealthy ----
let record = classifyHealth({ probe: serverError, now: T0, policy });
assert.equal(record.state, "degraded");
assert.equal(record.consecutiveFailures, 1, "one failure is not yet a verdict");

record = classifyHealth({ probe: serverError, previous: record, now: at(1_000), policy });
assert.equal(record.state, "unhealthy");
assert.equal(record.consecutiveFailures, 2);

record = classifyHealth({ probe: ok, previous: record, now: at(2_000), policy });
assert.equal(record.state, "healthy");
assert.equal(record.consecutiveFailures, 0, "a success resets the counter");
console.log("ok  failure debounce walks degraded -> unhealthy -> healthy");

// ---- Flap resistance: alternating results never reach unhealthy ----
let flap = null;
for (let i = 0; i < 8; i += 1) {
  flap = classifyHealth({ probe: i % 2 === 0 ? serverError : ok, previous: flap, now: at(i * 1000), policy });
  assert.notEqual(flap.state, "unhealthy", "an app alternating pass/fail must not be declared unhealthy");
}
console.log("ok  flap resistance");

// ---- Starting grace window ----
const firstSeen = classifyHealth({ probe: refused, now: T0, policy });
assert.equal(firstSeen.state, "starting");
assert.equal(firstSeen.reason, "within-grace", "a refused connection right after first sight is a boot, not a fault");

const stillStarting = classifyHealth({ probe: refused, previous: firstSeen, now: at(29_000), policy });
assert.equal(stillStarting.state, "starting");

// Past the window the same probe is a real failure, and the count accrued during the grace period
// is what pushes it straight to unhealthy.
const pastGrace = classifyHealth({ probe: refused, previous: stillStarting, now: at(31_000), policy });
assert.equal(pastGrace.state, "unhealthy");
assert.equal(pastGrace.reason, "connect-refused");
assert.equal(
  classifyHealth({ probe: { http: false, errorCode: "TIMEOUT" }, previous: stillStarting, now: at(31_000), policy }).reason,
  "connect-timeout",
  "a timeout and a refusal are distinguishable in the recorded reason",
);
console.log("ok  starting grace window");

// ---- `since` marks when the current state began ----
const a = classifyHealth({ probe: ok, now: T0 });
const b = classifyHealth({ probe: ok, previous: a, now: at(5_000) });
assert.equal(b.since, a.since, "an unchanged state keeps its original since");
const c = classifyHealth({ probe: serverError, previous: b, now: at(9_000), policy });
assert.equal(c.since, at(9_000).toISOString(), "a state change stamps since with the transition time");
assert.equal(c.firstSeenAt, a.firstSeenAt, "firstSeenAt is preserved across transitions");
console.log("ok  since tracks state changes, firstSeenAt persists");

// ---- Index built from a snapshot, keyed by the durable association key ----
const index = healthIndexFromSnapshot({
  projects: [{ instances: [{ associationKey: "a1", health: { state: "healthy" } }] }],
  unmatchedInstances: [{ associationKey: "a2", health: { state: "degraded" } }, { associationKey: "a3" }],
});
assert.equal(index.get("a1").state, "healthy");
assert.equal(index.get("a2").state, "degraded");
assert.equal(index.has("a3"), false, "an instance with no health record contributes nothing");
assert.equal(healthIndexFromSnapshot(null).size, 0);
console.log("ok  health index from snapshot");

assert.equal(DEFAULT_HEALTH_POLICY.failureThreshold, 2);
console.log("\nlocalhoster-health checks passed");

function at(offsetMs) {
  return new Date(T0.getTime() + offsetMs);
}

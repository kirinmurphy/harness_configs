// Health-state normalization: turn a raw HTTP probe result into one of six stable states.
//
// The module holds NO state. Debouncing is derived — classifyHealth takes the app's previous health
// record and returns the next one, so `previous + probe -> next` is a pure function that a test can
// walk as a sequence. The alternative (a module-level Map keyed by associationKey) would need a
// reset hook to be testable and would spuriously increment counters on the settings-rebuild path in
// scripts/cli/localhoster.mjs, which re-derives a snapshot from cached discovery without probing.
//
// The carrier for that previous record is the previous snapshot, which the CLI layer already holds
// as `lastSnapshot`. healthIndexFromSnapshot builds the lookup.

import { DEFAULT_HEALTH_POLICY } from "./health-policy.mjs";

export const HEALTH_STATES = ["healthy", "degraded", "unhealthy", "starting", "unknown", "inactive"];

export function classifyHealth({
  probe = null,
  config = null,
  previous = null,
  now = new Date(),
  policy = DEFAULT_HEALTH_POLICY,
  active = true,
} = {}) {
  const at = toIso(now);
  const firstSeenAt = previous?.firstSeenAt || at;
  const failed = active && isFailure(probe, config);
  const consecutiveFailures = failed ? (previous?.consecutiveFailures || 0) + 1 : 0;

  const { state, reason } = resolveState({
    probe,
    config,
    active,
    consecutiveFailures,
    firstSeenAt,
    now,
    policy,
  });

  return {
    state,
    reason,
    consecutiveFailures,
    // `since` marks when the CURRENT state began, so it doubles as the transition timestamp the
    // history diff records — no separate bookkeeping needed.
    since: previous && previous.state === state ? previous.since : at,
    firstSeenAt,
    lastProbeAt: probe ? at : previous?.lastProbeAt || null,
  };
}

// associationKey -> health record, for every instance in a snapshot. associationKey is the durable
// app identity (port-free and PID-free), so an app that restarts on a different port keeps its
// failure count and `since` rather than looking brand new.
export function healthIndexFromSnapshot(snapshot) {
  const index = new Map();
  if (!snapshot) return index;
  const groups = [
    ...(snapshot.projects || []).flatMap((project) => project.instances || []),
    ...(snapshot.unmatchedInstances || []),
  ];
  for (const instance of groups) {
    if (instance?.associationKey && instance.health) index.set(instance.associationKey, instance.health);
  }
  return index;
}

// First match wins. Ordering matters: the TLS check precedes the status check because a trust
// failure resolves with http:true but status:null, and an untrusted cert is "reachable but not
// right" rather than a hard fault.
function resolveState({ probe, config, active, consecutiveFailures, firstSeenAt, now, policy }) {
  if (!active) return { state: "inactive", reason: null };
  if (!probe) return { state: "unknown", reason: "not-probed" };

  if (probe.http === true && probe.tls === "untrusted") {
    return { state: "degraded", reason: "tls-untrusted" };
  }
  if (probe.http === true && statusAccepted(probe.status, config)) {
    return { state: "healthy", reason: null };
  }
  // A 4xx at the origin root with no configured expectation is not evidence of a fault: plenty of
  // listeners on a dev machine are gRPC endpoints, IPC servers, or daemons that legitimately answer
  // 403/404 to a browser GET. Calling those "degraded" would fill the dashboard with alarms about
  // software behaving correctly. Once a user sets acceptedStatuses they have told us what healthy
  // means for that app, so a mismatch there IS meaningful and falls through to the failure path.
  if (probe.http === true && isUnconfigured4xx(probe.status, config)) {
    return { state: "unknown", reason: "no-health-expectation" };
  }

  const reason = probe.http === true ? "status-not-accepted" : connectReason(probe);
  if (probe.http !== true && withinGrace(firstSeenAt, now, policy)) {
    return { state: "starting", reason: "within-grace" };
  }
  const threshold = policy?.failureThreshold ?? DEFAULT_HEALTH_POLICY.failureThreshold;
  return { state: consecutiveFailures >= threshold ? "unhealthy" : "degraded", reason };
}

// Must agree with resolveState about what counts as a fault, or the failure counter would climb
// while the reported state says otherwise.
function isFailure(probe, config) {
  if (!probe) return false;
  if (probe.http !== true) return true;
  if (probe.tls === "untrusted") return true;
  if (isUnconfigured4xx(probe.status, config)) return false;
  return !statusAccepted(probe.status, config);
}

function isUnconfigured4xx(status, config) {
  const accepted = config?.acceptedStatuses;
  if (Array.isArray(accepted) && accepted.length) return false;
  return typeof status === "number" && status >= 400 && status < 500;
}

// An explicit acceptedStatuses list wins. Otherwise 2xx and 3xx both count: a dev server redirecting
// to a login page is the common localhost case and flagging it unhealthy would be pure noise.
//
// NOTE: config.path is intentionally not consulted here. Honoring it means a second probe per app,
// which touches the origin-candidate loop in discovery.mjs — a separate concern from normalization.
// The field is stored and validated today but not yet probed; see the Localhoster reference doc.
function statusAccepted(status, config) {
  if (typeof status !== "number") return false;
  const accepted = config?.acceptedStatuses;
  if (Array.isArray(accepted) && accepted.length) return accepted.includes(status);
  return status >= 200 && status < 400;
}

function withinGrace(firstSeenAt, now, policy) {
  const grace = policy?.startingGraceMs ?? DEFAULT_HEALTH_POLICY.startingGraceMs;
  const started = Date.parse(firstSeenAt);
  if (!Number.isFinite(started)) return false;
  return toMillis(now) - started < grace;
}

function connectReason(probe) {
  return probe?.errorCode === "TIMEOUT" ? "connect-timeout" : "connect-refused";
}

function toIso(now) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

function toMillis(now) {
  return now instanceof Date ? now.getTime() : new Date(now).getTime();
}

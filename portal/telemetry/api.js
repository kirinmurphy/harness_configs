// Server-call wrappers for the Telemetry page. Pages import from here instead of building fetch
// calls inline — mirrors portal/plans/api.js and portal/config/api.js.

import { portalGetJson, portalPostJson } from "/portal/shared/api.js";

export function fetchAnalysis(qs) {
  return portalGetJson("/api/data" + qs);
}

export function fetchSession({ id, harness, finding, repo }) {
  const qs = "id=" + encodeURIComponent(id) + "&harness=" + encodeURIComponent(harness || "claude")
    + "&finding=" + encodeURIComponent(finding || "") + "&repo=" + encodeURIComponent(repo || "");
  return portalGetJson("/api/session?" + qs);
}

export function fetchInsightsLlm() {
  return portalGetJson("/api/insights-llm");
}

export function fetchTelemetryState() {
  return portalGetJson("/api/config");
}

export function enableTelemetry() {
  return portalPostJson("/api/config/packages", { id: "telemetry", enabled: true });
}

// --- Phase 6: markers/experiments/analysis ------------------------------------------------------

export function fetchMarkers() {
  return portalGetJson("/api/telemetry/markers");
}

export function createMarker(fields) {
  return portalPostJson("/api/telemetry/markers", fields);
}

export function fetchExperiments() {
  return portalGetJson("/api/telemetry/experiments");
}

export function createExperiment(fields) {
  return portalPostJson("/api/telemetry/experiments", fields);
}

export function endExperiment(experimentId) {
  return portalPostJson(`/api/telemetry/experiments/${encodeURIComponent(experimentId)}/end`, {});
}

// cohort_a/cohort_b are normalized cohort filter objects (telemetry-cohort.mjs's shape); marker_id
// selects the marker-relative comparison path. See portal-routes-telemetry.mjs's handler for the
// exact body shape this posts to POST /api/telemetry/analysis.
export function fetchTelemetryAnalysis({ metric, markerId, cohortA, cohortB }) {
  return portalPostJson("/api/telemetry/analysis", {
    metric,
    marker_id: markerId || null,
    cohort_a: cohortA || null,
    cohort_b: cohortB || null,
  });
}

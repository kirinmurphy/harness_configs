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

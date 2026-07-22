// /api/data, /api/session, /api/insights-llm route handlers — the Telemetry page's API surface.
// Returns true once it has written a response, false if the URL/method didn't match
// (portal-server.mjs's route() tries the next domain). handlers is the object startPortalServer()
// was given (loadAnalysisJson, loadSession, loadInsightsLlm come from telemetry.mjs's wiring).
import { send } from "./portal-routes-http.mjs";

export function handleTelemetryApi(req, res, urlPath, qs, handlers) {
  const { loadAnalysisJson, loadSession, loadInsightsLlm } = handlers;

  if (urlPath === "/api/insights-llm") {
    // On-demand LLM synthesis of the deterministic facts. May take seconds (shells to claude -p).
    send(res, 200, "application/json", JSON.stringify(loadInsightsLlm()));
    return true;
  }
  if (urlPath === "/api/data") {
    // The client passes ?range=<ms> to scope the WHOLE report (every panel) to a trailing time
    // window, and an optional &end=<ms epoch> when panning to a fixed window rather than "latest".
    // ?harness=claude (or codex) scopes all panels to a single harness; omit for all harnesses.
    const params = new URLSearchParams(qs);
    const rangeMs = params.has("range") ? Number(params.get("range")) : null;
    const end = params.has("end") ? Number(params.get("end")) : null;
    const harness = params.get("harness") || null;
    const window = Number.isFinite(rangeMs) && rangeMs > 0 ? { rangeMs, end: Number.isFinite(end) ? end : null } : null;
    // loadAnalysisJson returns the already-serialized report (cached alongside the object), so the
    // ~10MB default view is not re-stringified on every request — just written through.
    send(res, 200, "application/json", loadAnalysisJson(window, harness));
    return true;
  }
  if (urlPath === "/api/session") {
    // Bridge a flagged event to its chat: locate the transcript by session id and surface the
    // heaviest turns + a ready-to-paste analysis prompt. loadSession owns the file I/O (telemetry.mjs)
    // so the server stays I/O-free, mirroring loadAnalysis.
    const params = new URLSearchParams(qs);
    const id = params.get("id");
    const harness = params.get("harness") || "claude";
    const finding = params.get("finding") || "abnormal token usage";
    const repo = params.get("repo") || null;
    if (!id) {
      send(res, 400, "application/json", JSON.stringify({ error: "missing id" }));
      return true;
    }
    send(res, 200, "application/json", JSON.stringify(loadSession({ id, harness, finding, repo })));
    return true;
  }
  return false;
}

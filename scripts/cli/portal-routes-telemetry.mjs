// /api/data, /api/session, /api/insights-llm, /api/telemetry/analysis, and the marker/experiment
// endpoints — the Telemetry page's full API surface. Returns true once it has written a response,
// false if the URL/method didn't match (portal-server.mjs's route() tries the next domain).
// handlers is the object startPortalServer() was given (loadAnalysisJson, loadSession,
// loadInsightsLlm, plus the Phase 5/6 marker/experiment/analysis handlers, all from telemetry.mjs's
// wiring).
import { send, readJsonBody } from "./portal-routes-http.mjs";
import { hasHarnessProvider } from "../harnesses/registry.mjs";

export function handleTelemetryApi(req, res, urlPath, qs, handlers) {
  const {
    loadAnalysisJson, loadSession, loadInsightsLlm,
    loadMarkers, createMarkerFromRequest,
    loadExperiments, createExperimentFromRequest, endExperimentFromRequest,
    loadTelemetryAnalysis, loadTelemetryGuide,
  } = handlers;

  if (urlPath === "/api/telemetry/guide") {
    // Backs the page's "view docs" popup — server-rendered docs/guides/telemetry.md, so the popup
    // and the on-disk guide are always the same content, never a second copy to keep in sync.
    send(res, 200, "application/json", JSON.stringify(loadTelemetryGuide()));
    return true;
  }
  if (urlPath === "/api/insights-llm") {
    // On-demand LLM synthesis of the deterministic facts. May take seconds (shells to claude -p).
    send(res, 200, "application/json", JSON.stringify(loadInsightsLlm()));
    return true;
  }
  if (urlPath === "/api/data") {
    // The client passes ?range=<ms> to scope the WHOLE report (every panel) to a trailing time
    // window, and an optional &end=<ms epoch> when panning to a fixed window rather than "latest".
    // ?harness=claude (or codex) scopes all panels to a single harness; omit for all harnesses.
    // Phase 6 additions: ?model=, ?repo=, ?marker_id= (marker-relative comparison) layer on top of
    // the existing time/harness window without changing their meaning.
    const params = new URLSearchParams(qs);
    const rangeMs = params.has("range") ? Number(params.get("range")) : null;
    const end = params.has("end") ? Number(params.get("end")) : null;
    const harness = params.get("harness") || null;
    const model = params.get("model") || null;
    const repo = params.get("repo") || null;
    // Global repository scope: canonical repository id, orthogonal to the legacy ?repo= label.
    const repository = params.get("repository") || null;
    const markerId = params.get("marker_id") || null;
    const window = Number.isFinite(rangeMs) && rangeMs > 0 ? { rangeMs, end: Number.isFinite(end) ? end : null } : null;
    // loadAnalysisJson returns the already-serialized report (cached per signature+window+harness+
    // cohort — see telemetry.mjs's cachedAnalysisEntry), so the ~10MB default view is not
    // re-stringified on every request — just written through.
    send(res, 200, "application/json", loadAnalysisJson(window, harness, { model, repo, repository, markerId }));
    return true;
  }
  if (urlPath === "/api/session") {
    // Bridge a flagged event to its chat: locate the transcript by session id and surface the
    // heaviest turns + a ready-to-paste analysis prompt. loadSession owns the file I/O (telemetry.mjs)
    // so the server stays I/O-free, mirroring loadAnalysis.
    const params = new URLSearchParams(qs);
    const id = params.get("id");
    const harness = params.get("harness");
    const finding = params.get("finding") || "abnormal token usage";
    const repo = params.get("repo") || null;
    if (!id) {
      send(res, 400, "application/json", JSON.stringify({ error: "missing id" }));
      return true;
    }
    // No silent default to Claude: a session lookup with a missing or unrecognized harness id is a
    // client error, not "assume Claude" — hasHarnessProvider rejects both the same way.
    if (!harness || !hasHarnessProvider(harness)) {
      send(res, 400, "application/json", JSON.stringify({ error: `missing or unknown harness: ${harness ?? "(none)"}` }));
      return true;
    }
    send(res, 200, "application/json", JSON.stringify(loadSession({ id, harness, finding, repo })));
    return true;
  }

  // --- Phase 6: marker endpoints ---------------------------------------------------------------
  // All mutations reuse the same validation/persistence functions the CLI uses (telemetry-markers.mjs)
  // — see telemetry.mjs's serveCommand wiring for createMarkerFromRequest's implementation.
  if (urlPath === "/api/telemetry/markers" && req.method === "GET") {
    send(res, 200, "application/json", JSON.stringify({ markers: loadMarkers() }));
    return true;
  }
  if (urlPath === "/api/telemetry/markers" && req.method === "POST") {
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      const result = createMarkerFromRequest(body || {});
      send(res, result.ok ? 200 : 400, "application/json", JSON.stringify(result));
    });
    return true;
  }

  // --- Phase 6: experiment endpoints ------------------------------------------------------------
  if (urlPath === "/api/telemetry/experiments" && req.method === "GET") {
    send(res, 200, "application/json", JSON.stringify({ experiments: loadExperiments() }));
    return true;
  }
  if (urlPath === "/api/telemetry/experiments" && req.method === "POST") {
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      const result = createExperimentFromRequest(body || {});
      send(res, result.ok ? 200 : 400, "application/json", JSON.stringify(result));
    });
    return true;
  }
  const endMatch = /^\/api\/telemetry\/experiments\/([^/]+)\/end$/.exec(urlPath);
  if (endMatch && req.method === "POST") {
    const result = endExperimentFromRequest(endMatch[1]);
    send(res, result.ok ? 200 : 400, "application/json", JSON.stringify(result));
    return true;
  }

  // --- Phase 5/7: dedicated high-dimensional comparison endpoint -------------------------------
  // Kept separate from /api/data (which every panel polls every 5s) so an Analysis-explorer
  // interaction doesn't inflate the hot polling payload — plan: "Add a dedicated endpoint for
  // high-dimensional comparisons rather than inflating /api/data for every explorer interaction."
  if (urlPath === "/api/telemetry/analysis" && req.method === "POST") {
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      const result = loadTelemetryAnalysis(body || {});
      send(res, result.ok === false ? 400 : 200, "application/json", JSON.stringify(result));
    });
    return true;
  }

  return false;
}

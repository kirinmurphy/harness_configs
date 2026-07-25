// /api/plans* route handlers — the Plans page's API surface. Returns true once it has written a
// response, false if the URL/method didn't match (portal-server.mjs's route() tries the next
// domain). handlers is the object startPortalServer() was given (loadPlans, loadPlanDocument,
// buildPlansPrompt, updatePlanSettings, refreshPlans come from telemetry.mjs's wiring).
import { send, readJsonBody } from "./portal-routes-http.mjs";

// Serializes a domain error (see modules/plan-docs/index.mjs's domainError helper) into the
// structured { error: { code, message, resolution, details } } shape the client's portalPostJson
// preserves. Falls back to a plain 400 for any error that isn't domain-shaped (shouldn't happen
// once every plan-docs throw site uses domainError, but keeps the route defensive).
function sendDomainError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 400;
  const body = {
    error: {
      code: error?.code || "INVALID_CHANGE",
      message: String(error?.message || error),
      resolution: error?.resolution,
      details: error?.details,
    },
  };
  send(res, status, "application/json", JSON.stringify(body));
}

export function handlePlansApi(req, res, urlPath, qs, handlers) {
  const { loadPlans, loadPlanDocument, buildPlansPrompt, updatePlanSettings, updatePlanPriority, updatePlanLifecycle, refreshPlans } = handlers;

  if (urlPath === "/api/plans") {
    send(res, 200, "application/json", JSON.stringify(loadPlans()));
    return true;
  }
  if (urlPath === "/api/plans/document") {
    const params = new URLSearchParams(qs);
    try {
      send(res, 200, "application/json", JSON.stringify(loadPlanDocument({ key: params.get("key") })));
    } catch (err) {
      send(res, 400, "application/json", JSON.stringify({ error: String(err?.message || err) }));
    }
    return true;
  }
  if (req.method === "POST" && urlPath === "/api/plans/prompt") {
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      try {
        send(res, 200, "application/json", JSON.stringify(buildPlansPrompt(body || {})));
      } catch (error) {
        send(res, 400, "application/json", JSON.stringify({ error: String(error?.message || error) }));
      }
    });
    return true;
  }
  if (req.method === "POST" && urlPath === "/api/plans/settings") {
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      try {
        send(res, 200, "application/json", JSON.stringify(updatePlanSettings(body || {})));
      } catch (error) {
        send(res, 400, "application/json", JSON.stringify({ error: String(error?.message || error) }));
      }
    });
    return true;
  }
  if (req.method === "POST" && urlPath === "/api/plans/priority") {
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      try {
        send(res, 200, "application/json", JSON.stringify(updatePlanPriority(body || {})));
      } catch (error) {
        sendDomainError(res, error);
      }
    });
    return true;
  }
  if (req.method === "POST" && urlPath === "/api/plans/lifecycle") {
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      try {
        send(res, 200, "application/json", JSON.stringify(updatePlanLifecycle(body || {})));
      } catch (error) {
        sendDomainError(res, error);
      }
    });
    return true;
  }
  if (req.method === "POST" && urlPath === "/api/plans/refresh") {
    send(res, 200, "application/json", JSON.stringify(refreshPlans()));
    return true;
  }
  return false;
}

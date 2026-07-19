// /api/plans* route handlers — the Plans page's API surface. Returns true once it has written a
// response, false if the URL/method didn't match (portal-server.mjs's route() tries the next
// domain). handlers is the object startPortalServer() was given (loadPlans, loadPlanDocument,
// buildPlansPrompt, updatePlanSettings, refreshPlans come from telemetry.mjs's wiring).
import { send, readJsonBody } from "./portal-routes-http.mjs";

export function handlePlansApi(req, res, urlPath, qs, handlers) {
  const { loadPlans, loadPlanDocument, buildPlansPrompt, updatePlanSettings, refreshPlans } = handlers;

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
  if (req.method === "POST" && urlPath === "/api/plans/refresh") {
    send(res, 200, "application/json", JSON.stringify(refreshPlans()));
    return true;
  }
  return false;
}

// /api/usage* route handlers — the future homepage's usage data surface. Returns normalized,
// assessed values (never parsed footer text). Thin HTTP shim over portal-usage.mjs; returns true
// once a response is written, false if the URL/method didn't match (portal-server tries next).
import { send } from "./portal-routes-http.mjs";
import { buildUsageResponse } from "./portal-usage.mjs";

export function handleUsageApi(req, res, urlPath) {
  if (req.method === "GET" && urlPath === "/api/usage") {
    // Live local state: no-store (send()'s default) so the homepage never shows a cached view.
    send(res, 200, "application/json", JSON.stringify(buildUsageResponse()));
    return true;
  }
  if (req.method === "POST" && urlPath === "/api/usage/refresh") {
    // The explicit-refresh path (starts a bounded Codex app-server read) is reserved for the Codex
    // collector, which depends on the still-unlanded upstream footer work. Until then it reports an
    // honest, controlled unavailable rather than silently starting a process or faking data.
    send(
      res,
      501,
      "application/json",
      JSON.stringify({ ok: false, reason: "codex-collector-not-implemented" }),
    );
    return true;
  }
  return false;
}

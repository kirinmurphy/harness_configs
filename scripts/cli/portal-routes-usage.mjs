// /api/usage* routes — the future homepage's usage data surface. Returns normalized, assessed
// values (never parsed footer text). Thin HTTP shim over portal-usage.mjs.
import { send } from "./portal-routes-http.mjs";
import { buildUsageResponse } from "./portal-usage.mjs";
import { defineRoutes } from "./portal-router.mjs";

export const usageRoutes = defineRoutes([
  {
    method: "GET",
    path: "/api/usage",
    handler: (req, res) => {
      // Live local state: no-store (send()'s default) so the homepage never shows a cached view.
      send(res, 200, "application/json", JSON.stringify(buildUsageResponse()));
      return true;
    },
  },
  {
    method: "POST",
    path: "/api/usage/refresh",
    handler: (req, res) => {
      // The explicit-refresh path (starts a bounded Codex app-server read) is reserved for the Codex
      // collector, which depends on the still-unlanded upstream footer work. Until then it reports an
      // honest, controlled unavailable rather than silently starting a process or faking data.
      send(res, 501, "application/json", JSON.stringify({ ok: false, reason: "codex-collector-not-implemented" }));
      return true;
    },
  },
]);

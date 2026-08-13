// /api/maintenance* route handlers — app-level lifecycle actions, kept out of portal-routes-config
// so that module stays about the Config page's own read/write surface.
//
// Only managed cleanup lives here today. Two constraints shape it:
//
//  1. The portal never offers workspace deletion. The CLI's --delete-workspace is a deliberate,
//     typed opt-in; a button in a browser is the wrong affordance for irreversibly removing a
//     user's authored content, so this surface is preserve-only by construction.
//  2. Executing cleanup can stop the very process serving the response (the portal's own PID state
//     is roborepo-managed machine state). The handler therefore finishes writing its response
//     before any shutdown can run — see the deferred exit in executeUninstall below.

import { send, readJsonBody } from "./portal-routes-http.mjs";

export function handleMaintenanceApi(req, res, urlPath, qs, handlers) {
  const { uninstallPreview, uninstallExecute } = handlers;

  // Preview is a GET: it mutates nothing and is safe to re-request while the user reads it.
  if (req.method === "GET" && urlPath === "/api/maintenance/uninstall/preview") {
    Promise.resolve()
      .then(uninstallPreview)
      .then((preview) => send(res, 200, "application/json", JSON.stringify(preview)))
      .catch((err) => send(res, 500, "application/json", JSON.stringify({ error: err?.message || String(err) })));
    return true;
  }

  // Execute is POST (origin+token guarded by route() before we get here) and additionally requires
  // an explicit confirm flag in the body, so a bare POST cannot trigger removal.
  if (req.method === "POST" && urlPath === "/api/maintenance/uninstall") {
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      if (body?.confirm !== true) {
        return send(res, 400, "application/json", JSON.stringify({
          error: "expected { confirm: true } — managed cleanup requires explicit confirmation",
        }));
      }
      Promise.resolve()
        .then(uninstallExecute)
        .then((result) => send(res, result.ok ? 200 : 500, "application/json", JSON.stringify(result)))
        .catch((e) => send(res, 500, "application/json", JSON.stringify({ error: e?.message || String(e) })));
    });
    return true;
  }

  return false;
}

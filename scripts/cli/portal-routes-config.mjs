// /api/config* route handlers — the Config page's API surface. Returns true once it has written a
// response, false if the URL/method didn't match (portal-server.mjs's route() tries the next
// domain). handlers is the object startPortalServer() was given (loadConfig, loadConfigSource,
// mutatePackage, mutateSkill, mutateBehavior, mutateCommand come from telemetry.mjs's wiring).
import { send, readJsonBody } from "./portal-routes-http.mjs";

export function handleConfigApi(req, res, urlPath, qs, handlers) {
  const { loadConfig, loadConfigSource, mutatePackage, mutateSkill, mutateBehavior, mutateCommand } = handlers;

  // Mutations are POST-only, origin-checked, token-checked, and JSON-bodied (route() already ran
  // the origin+token guard). Each writes config then returns the fresh snapshot so the client
  // re-renders from one response.
  if (req.method === "POST" && (urlPath === "/api/config/packages" || urlPath === "/api/config/skills")) {
    readJsonBody(req, async (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      const { id, enabled } = body || {};
      if (typeof id !== "string" || typeof enabled !== "boolean") {
        return send(res, 400, "application/json", JSON.stringify({ error: "expected { id: string, enabled: boolean }" }));
      }
      const mutate = urlPath === "/api/config/packages" ? mutatePackage : mutateSkill;
      const result = await mutate(id, enabled); // mutatePackage is async (service components)
      const status = result.ok ? 200 : 400;
      send(res, status, "application/json", JSON.stringify({ ...result, config: loadConfig() }));
    });
    return true;
  }

  // Flat model: either a named behavior (by manifest id) or an arbitrary command (by token
  // array) moves to a bucket. "default" reverts to the manifest's own default for that item.
  // Global only — no profile, no scope; see permissions-render.mjs / config-mutate.mjs.
  if (req.method === "POST" && urlPath === "/api/config/permissions") {
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      const { behaviorId, tokens, bucket } = body || {};
      const validBucket = bucket === "default" || ["deny", "ask", "allow"].includes(bucket);
      if (!validBucket || (typeof behaviorId !== "string" && !Array.isArray(tokens))) {
        return send(res, 400, "application/json", JSON.stringify({
          error: "expected { behaviorId: string, bucket } or { tokens: string[], bucket } — bucket one of deny|ask|allow|default",
        }));
      }
      const result = typeof behaviorId === "string"
        ? mutateBehavior(behaviorId, bucket)
        : mutateCommand(tokens, bucket);
      const status = result.ok ? 200 : 400;
      send(res, status, "application/json", JSON.stringify({ ...result, config: loadConfig() }));
    });
    return true;
  }

  if (urlPath === "/api/config") {
    send(res, 200, "application/json", JSON.stringify(loadConfig()));
    return true;
  }
  if (urlPath === "/api/config/source") {
    // Read-only: returns the full source that defines a tool (skill/command/rules/hooks) for the
    // /config click-to-inspect popup. loadConfigSource whitelists kind+id against the catalog.
    const params = new URLSearchParams(qs);
    const result = loadConfigSource({
      kind: params.get("kind"),
      id: params.get("id"),
      harness: params.get("harness") || "claude",
    });
    send(res, result.ok ? 200 : 400, "application/json", JSON.stringify(result));
    return true;
  }
  return false;
}

import { send, readJsonBody } from "./portal-routes-http.mjs";
import { defineRoutes } from "./portal-router.mjs";

// Mutation type is the URL's last path segment, except compose-project — its settings.mjs
// mutation type is camelCase ("composeProject") to match the rest of the mutation type names,
// while the URL stays hyphenated to match this route table's existing kebab-free-but-lowercase
// style; segment-as-type would otherwise send the literal hyphenated string as an unknown type.
const MUTATION_TYPE_BY_PATH = { "compose-project": "composeProject" };

function mutationRoute(segment) {
  return {
    method: "POST",
    path: `/api/localhoster/${segment}`,
    handler: (req, res, { handlers }) => {
      readJsonBody(req, (body, err) => {
        if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
        const type = MUTATION_TYPE_BY_PATH[segment] || segment;
        const result = handlers.updateLocalhosterSettings({ ...(body || {}), type });
        send(res, result.status || (result.ok ? 200 : 400), "application/json", JSON.stringify(result));
      });
      return true;
    },
  };
}

function readRoute(segment, loaderKey) {
  return {
    method: "GET",
    path: `/api/localhoster/${segment}`,
    handler: (req, res, { qs, handlers }) => {
      const params = new URLSearchParams(qs);
      const loader = handlers[loaderKey];
      if (!loader) {
        send(res, 501, "application/json", JSON.stringify({ ok: false, error: "localhoster endpoint unavailable" }));
        return true;
      }
      Promise.resolve(loader(params.get("key") || ""))
        .then((result) => send(res, result.status || (result.ok ? 200 : 400), "application/json", JSON.stringify(result)))
        .catch((err) => send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(err?.message || err) })));
      return true;
    },
  };
}

export const localhosterRoutes = defineRoutes([
  {
    method: "GET",
    path: "/api/localhoster",
    handler: (req, res, { handlers }) => {
      send(res, 200, "application/json", JSON.stringify(handlers.loadLocalhoster()));
      return true;
    },
  },
  {
    method: "POST",
    path: "/api/localhoster/refresh",
    handler: (req, res, { handlers }) => {
      handlers.refreshLocalhoster()
        .then((snapshot) => send(res, 200, "application/json", JSON.stringify(snapshot)))
        .catch((err) => send(res, 500, "application/json", JSON.stringify({ error: String(err?.message || err) })));
      return true;
    },
  },
  readRoute("history", "loadLocalhosterHistory"),
  readRoute("metadata", "loadLocalhosterMetadata"),
  mutationRoute("links"),
  mutationRoute("association"),
  mutationRoute("project"),
  mutationRoute("alias"),
  mutationRoute("compose-project"),
  // Not a mutationRoute: those all funnel into updateLocalhosterSettings, and repository visibility
  // lives in the repository registry rather than in Localhoster's settings file. Same shape and same
  // response contract, different store.
  {
    method: "POST",
    path: "/api/localhoster/repository-visibility",
    handler: (req, res, { handlers }) => {
      readJsonBody(req, (body, err) => {
        if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
        const result = handlers.setLocalhosterRepositoryVisibility(body || {});
        send(res, result.status || (result.ok ? 200 : 400), "application/json", JSON.stringify(result));
      });
      return true;
    },
  },
  // Registry-backed for the same reason as repository-visibility: a pin is a property of the
  // repository and has to outlive the processes running in it.
  {
    method: "POST",
    path: "/api/localhoster/repository-pinned",
    handler: (req, res, { handlers }) => {
      readJsonBody(req, (body, err) => {
        if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
        const result = handlers.setLocalhosterRepositoryPinned(body || {});
        send(res, result.status || (result.ok ? 200 : 400), "application/json", JSON.stringify(result));
      });
      return true;
    },
  },
]);

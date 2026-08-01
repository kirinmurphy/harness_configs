import { send, readJsonBody } from "./portal-routes-http.mjs";

export function handleLocalhosterApi(req, res, urlPath, qs, handlers) {
  const {
    loadLocalhoster,
    refreshLocalhoster,
    updateLocalhosterSettings,
    loadLocalhosterHistory,
    loadLocalhosterMetadata,
  } = handlers;

  if (req.method === "GET" && urlPath === "/api/localhoster") {
    send(res, 200, "application/json", JSON.stringify(loadLocalhoster()));
    return true;
  }

  if (req.method === "POST" && urlPath === "/api/localhoster/refresh") {
    refreshLocalhoster()
      .then((snapshot) => send(res, 200, "application/json", JSON.stringify(snapshot)))
      .catch((err) => send(res, 500, "application/json", JSON.stringify({ error: String(err?.message || err) })));
    return true;
  }

  if (req.method === "GET" && ["/api/localhoster/history", "/api/localhoster/metadata"].includes(urlPath)) {
    const params = new URLSearchParams(qs);
    const loader = urlPath.endsWith("/history") ? loadLocalhosterHistory : loadLocalhosterMetadata;
    if (!loader) {
      send(res, 501, "application/json", JSON.stringify({ ok: false, error: "localhoster endpoint unavailable" }));
      return true;
    }
    const result = loader(params.get("key") || "");
    send(res, result.status || (result.ok ? 200 : 400), "application/json", JSON.stringify(result));
    return true;
  }

  // Mutation type is the URL's last path segment, except compose-project — its settings.mjs
  // mutation type is camelCase ("composeProject") to match the rest of the mutation type names,
  // while the URL stays hyphenated to match this route table's existing kebab-free-but-lowercase
  // style; segment-as-type would otherwise send the literal hyphenated string as an unknown type.
  const MUTATION_TYPE_BY_PATH = { "compose-project": "composeProject" };
  if (req.method === "POST" && [
    "/api/localhoster/links",
    "/api/localhoster/association",
    "/api/localhoster/project",
    "/api/localhoster/alias",
    "/api/localhoster/compose-project",
  ].includes(urlPath)) {
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      const segment = urlPath.split("/").at(-1);
      const type = MUTATION_TYPE_BY_PATH[segment] || segment;
      const result = updateLocalhosterSettings({ ...(body || {}), type });
      send(res, result.status || (result.ok ? 200 : 400), "application/json", JSON.stringify(result));
    });
    return true;
  }

  return false;
}

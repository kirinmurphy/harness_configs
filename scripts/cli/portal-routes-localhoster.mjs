import { send, readJsonBody } from "./portal-routes-http.mjs";

export function handleLocalhosterApi(req, res, urlPath, qs, handlers) {
  const { loadLocalhoster, refreshLocalhoster, updateLocalhosterSettings } = handlers;

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

  if (req.method === "POST" && [
    "/api/localhoster/links",
    "/api/localhoster/association",
    "/api/localhoster/project",
    "/api/localhoster/alias",
  ].includes(urlPath)) {
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      const type = urlPath.split("/").at(-1);
      const result = updateLocalhosterSettings({ ...(body || {}), type });
      send(res, result.status || (result.ok ? 200 : 400), "application/json", JSON.stringify(result));
    });
    return true;
  }

  return false;
}

// /api/repositories* route handlers — the canonical repository API surface (Phase 4). Read-only
// summaries are separated from mutations; mutations (POST/PATCH) rely on portal-server.mjs's
// existing loopback-origin + token guard exactly like the other domains. Returns true once a
// response is written, false if the URL/method did not match (route() tries the next domain).
//
// Repository ids contain ':' and '/', so in the path they are percent-encoded; the id is the single
// path segment after /api/repositories/ (decoded once). Every payload is path-free by construction
// (see modules/repositories/summary.mjs).
import { send, readJsonBody } from "./portal-routes-http.mjs";

const BASE = "/api/repositories";

export function handleRepositoriesApi(req, res, urlPath, qs, handlers) {
  const {
    loadRepositories, loadRepository, loadRepositoryAssociations,
    enrollRepositoryInPlans, patchRepository,
  } = handlers;

  if (urlPath === BASE) {
    if (req.method !== "GET") return methodNotAllowed(res);
    send(res, 200, "application/json", JSON.stringify(loadRepositories()));
    return true;
  }

  if (!urlPath.startsWith(`${BASE}/`)) return false;
  const rest = urlPath.slice(BASE.length + 1);
  // Sub-resource suffix, if any: <encodedId> or <encodedId>/associations or <encodedId>/plans-enrollment
  const slash = rest.lastIndexOf("/");
  let encodedId = rest;
  let sub = null;
  if (slash > 0) {
    const tail = rest.slice(slash + 1);
    if (tail === "associations" || tail === "plans-enrollment") {
      encodedId = rest.slice(0, slash);
      sub = tail;
    }
  }
  let repositoryId;
  try {
    repositoryId = decodeURIComponent(encodedId);
  } catch {
    send(res, 400, "application/json", JSON.stringify({ error: "invalid repository id" }));
    return true;
  }
  if (!repositoryId) return false;

  if (sub === "associations") {
    if (req.method !== "GET") return methodNotAllowed(res);
    return respond(res, () => loadRepositoryAssociations({ repositoryId }));
  }

  if (sub === "plans-enrollment") {
    if (req.method !== "POST") return methodNotAllowed(res);
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      writeResult(res, () => enrollRepositoryInPlans({ repositoryId, repoRoot: (body || {}).repoRoot }));
    });
    return true;
  }

  // Bare /api/repositories/:id
  if (req.method === "GET") return respond(res, () => loadRepository({ repositoryId }));
  if (req.method === "PATCH") {
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      writeResult(res, () => patchRepository({ repositoryId, visibility: (body || {}).visibility }));
    });
    return true;
  }
  return methodNotAllowed(res);
}

function respond(res, fn) {
  writeResult(res, fn);
  return true;
}

function writeResult(res, fn) {
  try {
    send(res, 200, "application/json", JSON.stringify(fn()));
  } catch (err) {
    const status = err?.code === "NOT_FOUND" ? 404 : 400;
    send(res, status, "application/json", JSON.stringify({ error: String(err?.message || err) }));
  }
}

function methodNotAllowed(res) {
  send(res, 405, "application/json", JSON.stringify({ error: "method not allowed" }));
  return true;
}

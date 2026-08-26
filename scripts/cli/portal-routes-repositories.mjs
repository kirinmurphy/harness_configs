// /api/repositories* routes — the canonical repository API surface (Phase 4). Read-only summaries
// are separated from mutations; mutations (POST/PATCH) rely on portal-server.mjs's existing
// loopback-origin + token guard exactly like the other domains.
//
// Repository ids contain ':' and '/', so in the path they are percent-encoded; portal-router.mjs's
// :id segment decodes them. Every payload is path-free by construction (see modules/repositories/summary.mjs).
import { send, readJsonBody } from "./portal-routes-http.mjs";
import { defineRoutes } from "./portal-router.mjs";

function writeResult(res, fn) {
  try {
    send(res, 200, "application/json", JSON.stringify(fn()));
  } catch (err) {
    const status = err?.code === "NOT_FOUND" ? 404 : 400;
    send(res, status, "application/json", JSON.stringify({ error: String(err?.message || err) }));
  }
}

export const repositoriesRoutes = defineRoutes([
  {
    method: "GET",
    path: "/api/repositories",
    handler: (req, res, { handlers }) => {
      send(res, 200, "application/json", JSON.stringify(handlers.loadRepositories()));
      return true;
    },
  },
  {
    method: "GET",
    path: "/api/repositories/:id/associations",
    handler: (req, res, { params, handlers }) => {
      writeResult(res, () => handlers.loadRepositoryAssociations({ repositoryId: params.id }));
      return true;
    },
  },
  {
    method: "POST",
    path: "/api/repositories/:id/plans-enrollment",
    handler: (req, res, { params, handlers }) => {
      readJsonBody(req, (body, err) => {
        if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
        writeResult(res, () => handlers.enrollRepositoryInPlans({ repositoryId: params.id, repoRoot: (body || {}).repoRoot }));
      });
      return true;
    },
  },
  {
    method: "GET",
    path: "/api/repositories/:id",
    handler: (req, res, { params, handlers }) => {
      writeResult(res, () => handlers.loadRepository({ repositoryId: params.id }));
      return true;
    },
  },
  {
    method: "PATCH",
    path: "/api/repositories/:id",
    handler: (req, res, { params, handlers }) => {
      readJsonBody(req, (body, err) => {
        if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
        writeResult(res, () => handlers.patchRepository({ repositoryId: params.id, visibility: (body || {}).visibility }));
      });
      return true;
    },
  },
]);

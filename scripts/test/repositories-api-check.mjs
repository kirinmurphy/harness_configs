#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repositoriesRoutes } from "../cli/portal-routes-repositories.mjs";
import { dispatchRoutes } from "../cli/portal-router.mjs";
import {
  loadRepositoriesPayload, loadRepositoryPayload, loadRepositoryAssociations, patchRepository,
} from "../cli/repositories.mjs";
import { recordRepositoryDiscovery } from "../cli/repositories.mjs";
import { repositorySummary, repositoryDetailPayload } from "../../modules/repositories/index.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-repo-api-"));
const stateRoot = path.join(tempRoot, "state");

// Minimal mock res capturing status/body.
function mockRes() {
  return { statusCode: null, body: null, headers: {},
    writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers || {}); },
    end(body) { this.body = body; } };
}
function get(urlPath, handlers) {
  const res = mockRes();
  const matched = dispatchRoutes([repositoriesRoutes], { method: "GET" }, res, urlPath, "", handlers);
  return { matched, res };
}

try {
  const id = "git:github.com/kirinmurphy/roborepo";
  recordRepositoryDiscovery({ repositoryId: id, kind: "git", displayName: "roborepo", source: "localhoster", evidence: "git-remote", confidence: "high", localRoot: "rootaaaa1111", stateRoot });
  recordRepositoryDiscovery({ repositoryId: id, kind: "git", displayName: "roborepo", source: "plans", evidence: "configured-scan-root", confidence: "high", stateRoot });

  // ---- Summary shape is browser-safe: no absolute paths, no root, no raw config ----
  const listPayload = loadRepositoriesPayload({ stateRoot });
  assert.equal(listPayload.repositories.length, 1);
  const summary = listPayload.repositories[0];
  const json = JSON.stringify(summary);
  assert.ok(!json.includes(tempRoot), "summary must not leak the temp/local path");
  assert.ok(!/\/(Users|home|tmp|var|private)\//.test(json), "summary must not contain a filesystem path");
  assert.ok(!("root" in summary) && !("localRoots" in summary), "summary carries no root field");
  assert.equal(summary.repositoryId, id);
  assert.equal(summary.providerUrl, "https://github.com/kirinmurphy/roborepo");
  assert.deepEqual([...summary.discoveredBy].sort(), ["localhoster", "plans"]);
  assert.equal(summary.capabilities.localhoster, true);
  assert.equal(summary.capabilities.plans, true);
  assert.equal(summary.capabilities.telemetry, false);
  assert.equal(summary.enrollments.plans, undefined, "capabilities != enrollments");

  // Detail exposes local-root kinds/counts but still no absolute path.
  const detail = loadRepositoryPayload({ repositoryId: id, stateRoot });
  const detailJson = JSON.stringify(detail);
  assert.ok(!detailJson.includes(tempRoot), "detail must not leak paths");
  assert.equal(detail.localRoots.length, 1);
  assert.equal(detail.localRoots[0].kind, "primary");
  assert.ok(!("rootId" in detail.localRoots[0]), "detail localRoots expose kind/timestamps, not the opaque rootId");

  // ---- Route handler dispatch ----
  const handlers = {
    loadRepositories: () => loadRepositoriesPayload({ stateRoot }),
    loadRepository: (p) => loadRepositoryPayload({ ...p, stateRoot }),
    loadRepositoryAssociations: (p) => loadRepositoryAssociations({ ...p, stateRoot }),
    patchRepository: (p) => patchRepository({ ...p, stateRoot }),
    enrollRepositoryInPlans: () => ({ covered: true }),
  };

  const list = get("/api/repositories", handlers);
  assert.equal(list.matched, true);
  assert.equal(list.res.statusCode, 200);
  assert.equal(JSON.parse(list.res.body).repositories.length, 1);

  const encoded = encodeURIComponent(id);
  const one = get(`/api/repositories/${encoded}`, handlers);
  assert.equal(one.res.statusCode, 200);
  assert.equal(JSON.parse(one.res.body).repositoryId, id);

  // ---- Hidden repos are omitted from the ordinary list, but counted ----
  patchRepository({ repositoryId: id, visibility: "hidden", stateRoot });
  const afterHide = loadRepositoriesPayload({ stateRoot });
  assert.equal(afterHide.repositories.length, 0, "hidden repo omitted from ordinary list");
  assert.equal(afterHide.hiddenCount, 1, "hidden repo still counted");
  const withHidden = loadRepositoriesPayload({ stateRoot, includeHidden: true });
  assert.equal(withHidden.repositories.length, 1, "includeHidden surfaces it");
  patchRepository({ repositoryId: id, visibility: "visible", stateRoot }); // restore for later asserts

  const assoc = get(`/api/repositories/${encoded}/associations`, handlers);
  assert.equal(assoc.res.statusCode, 200);
  assert.equal(JSON.parse(assoc.res.body).discoveries.length, 2);

  const missing = get(`/api/repositories/${encodeURIComponent("git:github.com/x/y")}`, handlers);
  assert.equal(missing.res.statusCode, 404, "unknown repository -> 404");

  // Non-repositories path is not matched (lets route() fall through).
  assert.equal(dispatchRoutes([repositoriesRoutes], { method: "GET" }, mockRes(), "/api/plans", "", handlers), false);

  // ---- PATCH visibility via handler (POST/PATCH body path) ----
  const res = mockRes();
  const req = patchReq({ visibility: "hidden" });
  dispatchRoutes([repositoriesRoutes], req, res, `/api/repositories/${encoded}`, "", handlers);
  // readJsonBody consumes the request async; flush the mock's data/end below.
  req._emit();
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).visibility, "hidden");

  console.log("repositories-api-check passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

// Mock a PATCH request whose body is delivered when _emit() is called (readJsonBody uses on(data)/on(end)).
function patchReq(bodyObj) {
  const listeners = {};
  return {
    method: "PATCH",
    headers: {},
    on(event, cb) { listeners[event] = cb; return this; },
    _emit() {
      if (listeners.data) listeners.data(Buffer.from(JSON.stringify(bodyObj)));
      if (listeners.end) listeners.end();
    },
  };
}

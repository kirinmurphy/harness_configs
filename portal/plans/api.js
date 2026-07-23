// Thin wrappers around the Plans page's own /api/plans/* endpoints. Pure request/response — no
// state, no DOM. app.js decides what to do with the results.

import { portalGetJson, portalPostJson } from "/portal/shared/api.js";

export function fetchSnapshot() {
  return portalGetJson("/api/plans");
}

export function refreshSnapshot() {
  return portalPostJson("/api/plans/refresh", {});
}

export function saveDiscoveryRoots(discoveryRoots) {
  return portalPostJson("/api/plans/settings", { discoveryRoots });
}

export function updatePlanPriority(key, priority, mtimeMs) {
  return portalPostJson("/api/plans/priority", { key, priority, mtimeMs });
}

export function fetchPlanDocument(key) {
  return portalGetJson(`/api/plans/document?key=${encodeURIComponent(key)}`);
}

export function generatePrompt(action, keys, mode = "repository-aware") {
  return portalPostJson("/api/plans/prompt", { action, keys, mode }).then(
    (result) => result.prompt,
  );
}

export function enablePlanDocsPackage() {
  return portalPostJson("/api/config/packages", {
    id: "plan-docs",
    enabled: true,
  });
}

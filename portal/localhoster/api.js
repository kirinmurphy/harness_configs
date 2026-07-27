import { portalGetJson, portalPostJson } from "/portal/shared/api.js";

export function fetchLocalhoster() {
  return portalGetJson("/api/localhoster");
}

export function refreshLocalhoster() {
  return portalPostJson("/api/localhoster/refresh", {});
}

// The opaque key is snapshot-scoped: it embeds the origin, so it changes when an app's port changes
// and the server 404s a stale one. Callers should treat a 404 as "reload the snapshot", not an error.
export function fetchHistory(key) {
  return portalGetJson(`/api/localhoster/history?key=${encodeURIComponent(key)}`);
}

export function updateLinks(payload) {
  return portalPostJson("/api/localhoster/links", payload);
}

export function updateAssociation(payload) {
  return portalPostJson("/api/localhoster/association", payload);
}

export function updateProject(payload) {
  return portalPostJson("/api/localhoster/project", payload);
}

export function updateAlias(payload) {
  return portalPostJson("/api/localhoster/alias", payload);
}

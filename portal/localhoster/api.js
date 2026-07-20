import { portalGetJson, portalPostJson } from "/portal/shared/api.js";

export function fetchLocalhoster() {
  return portalGetJson("/api/localhoster");
}

export function refreshLocalhoster() {
  return portalPostJson("/api/localhoster/refresh", {});
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

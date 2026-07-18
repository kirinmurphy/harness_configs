// Thin wrappers around the Config page's own /api/config/* endpoints. Pure request/response — no
// state, no DOM. app.js decides what to do with the results.

import { portalGetJson, portalPostJson } from "/portal/shared/api.js";
import { TOGGLE_ENDPOINT } from "./state.js";

export function fetchConfig() {
  return portalGetJson("/api/config");
}

export function fetchSource({ kind, id, harness }) {
  const qs = new URLSearchParams({ kind, id });
  if (harness) qs.set("harness", harness);
  return portalGetJson("/api/config/source?" + qs.toString());
}

export function toggleItem(kind, id, enabled) {
  return portalPostJson(TOGGLE_ENDPOINT[kind], { id, enabled });
}

export function applyPermission(payload) {
  return portalPostJson("/api/config/permissions", payload);
}

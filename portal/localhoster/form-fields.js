// Field-level read/write for the dialog forms. This module knows element ids and value coercion
// and nothing else — no snapshot shape, no fetch, no rendering. Its whole job is to be the one
// place that maps a form control to a plain value, so app.js can talk in objects instead of
// repeating getElementById at every call site.

import { csvList, parseCsvList } from "./state.js";

function field(id) {
  return document.getElementById(id);
}

export function readValue(id) {
  return field(id).value;
}

export function setValue(id, value) {
  field(id).value = value ?? "";
}

export function readChecked(id) {
  return field(id).checked === true;
}

export function setChecked(id, value) {
  field(id).checked = value === true;
}

export function setText(id, text) {
  field(id).textContent = text ?? "";
}

export function setCsv(id, list) {
  setValue(id, csvList(list));
}

// A blank path or an empty status list is omitted rather than sent as "" / [] — the settings writer
// treats an absent key as "no override" and an explicit empty value as a deliberate one.
export function readHealth() {
  const path = readValue("app-health-path").trim();
  const acceptedStatuses = parseCsvList(readValue("app-health-statuses")).map(Number);
  return {
    ...(path ? { path } : {}),
    ...(acceptedStatuses.length ? { acceptedStatuses } : {}),
  };
}

export function readMatch() {
  return {
    process: parseCsvList(readValue("app-match-process")),
    title: parseCsvList(readValue("app-match-title")),
    path: parseCsvList(readValue("app-match-path")),
  };
}

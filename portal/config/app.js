// --------------------------------------------------------------------------- behavior view
//
// The user-facing section model is computed ONCE, server-side, in buildBehaviorView() (config.mjs)
// and shipped in the snapshot as snap.behaviorView. The client renders it directly — there is no
// client-side reimplementation to drift from the server. Items carry web fields (toggle, inspect,
// urls, badges) and terminal fields (hint); each renderer reads what it needs.
//
// Wiring only: DOM refs, event listeners, and orchestration between api.js (server calls),
// state.js (constants/pure lookups), and templates.js (markup). No markup construction should
// live in this file — add a template in templates.js instead.

import { portalSetUpdatedAt, portalHideLoading } from "/portal/shared/api.js";
import * as api from "./api.js";
import * as tmpl from "./templates.js";
import { createConfigModal } from "./panels.js";
import { snapshotChanged, inspectChipSpecs } from "./state.js";

const modal = createConfigModal();

function openSourceModal(inspect, itemCost = null) {
  const rules = lastSnapshot?.globals?.rules || {};
  const chips = inspectChipSpecs(inspect, itemCost, lastSnapshot);
  return modal.openSource(inspect, { rules, onDefaultClick: modal.openSnapshot, chips });
}

// POST a bucket change for either a named behavior (behaviorId) or an arbitrary command
// (tokens), re-rendering from the returned snapshot on success. Shared by behaviorRow and the
// arbitrary-command list so both paths hit the exact same endpoint contract.
async function applyBucket(payload, errSlot) {
  errSlot.textContent = "";
  try {
    const data = await api.applyPermission(payload);
    if (data.config) applySnapshot(data.config);
    return true;
  } catch (e) {
    errSlot.textContent = e.message;
    return false;
  }
}

async function handleToggle(item, enabled) {
  const data = await api.toggleItem(item.toggle, item.id, enabled);
  if (data.config) applySnapshot(data.config); // re-render from the authoritative post-mutation snapshot
}

// --------------------------------------------------------------------------- section renderers

function renderPermissionsSection(section) {
  return tmpl.permissionsSection(section, { onApplyBucket: applyBucket });
}

function renderStandardSection(section, contextCost) {
  return tmpl.standardSection(section, {
    onInspectClick: openSourceModal,
    onToggle: handleToggle,
    contextCost,
  });
}

function renderSection(section, contextCost) {
  if (section.kind === "permissions") return renderPermissionsSection(section);
  return renderStandardSection(section, contextCost);
}

function render(snap) {
  const main = document.getElementById("main");
  // Section model comes straight from the server snapshot (buildBehaviorView), no client fork.
  const view = snap.behaviorView || [];
  main.replaceChildren(
    // Harness Context summary first; tmpl.contextSummary returns null on snapshots that
    // predate contextCost (rolling upgrade), so it drops out cleanly.
    ...[tmpl.contextSummary(snap)].filter(Boolean),
    tmpl.configFiles(snap, { onInspectClick: openSourceModal }),
    ...view.map((section) => renderSection(section, snap.contextCost)).filter(Boolean),
  );
}

// --------------------------------------------------------------------------- poll

let last = null;
let lastSnapshot = null;
function applySnapshot(snap) {
  lastSnapshot = snap;
  const changed = snapshotChanged(last, snap);
  if (changed) {
    last = changed;
    render(snap);
  }
  portalSetUpdatedAt();
}
function showError(err) {
  console.error(err);
}

async function load() {
  try {
    applySnapshot(await api.fetchConfig());
  } catch (e) {
    showError(e);
  } finally {
    portalHideLoading();
  }
}

const POLL_INTERVAL_MS = 10000;

load();
setInterval(load, POLL_INTERVAL_MS);
// Theme toggle + nav live in the shared /portal/shared/theme.js. The config page has no
// canvas to redraw, so it needs no "roborepo:themechange" listener.

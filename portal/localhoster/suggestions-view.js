// Discovered-routes dropdown content: a portal-menu-button (portal/shared/menu-button.js) mounted
// per-card by app.js shows this as its panel. Not a dialog — see index.html's routes-trigger slot
// comment for why this moved off the three-dot menu.
//
// Kept out of app.js for the same reason history-view.js is: app.js is already long, and this is a
// self-contained render concern.

import { portalFillSlots as fill, portalTpl as tpl } from "/portal/shared/api.js";
import { fetchMetadata } from "./api.js";

const SOURCE_LABELS = {
  openapi: "OpenAPI",
  sitemap: "Sitemap",
  manifest: "Manifest",
  robots: "Robots",
};

// captureLink(project, instance, suggestion) must return the mutation's result (or throw) — same
// contract updateLinks already has. isSaved(instance, path) tells a row whether to show the
// checkmark, decided by the caller (app.js) since it owns lastSnapshot/currentLinks, not this view.
export async function buildRoutesDropdown(project, instance, { onStale, captureLink, isSaved } = {}) {
  let result;
  try {
    result = await fetchMetadata(instance.opaqueKey);
  } catch {
    return message("Suggestions are unavailable right now.");
  }

  // A 404 means the key went stale — the app's port changed since this snapshot was rendered.
  if (result?.ok === false) {
    onStale?.();
    return message("This app's port changed — reloading…");
  }

  const suggestions = result?.suggestions || [];
  if (!suggestions.length) return message("No discovered routes.");

  const list = document.createElement("div");
  list.className = "routes-dropdown-list";
  for (const suggestion of suggestions) {
    list.append(routeLinkRow(project, instance, suggestion, { captureLink, isSaved }));
  }
  return list;
}

// Capture-on-click, not capture-on-open: opening the dropdown never mutates anything, only actually
// using a link does — and only once. A route already in app.links (isSaved) is a pure navigation,
// no mutation call at all, so re-clicking a saved link never risks a stale-revision 409 for
// something that's already true.
function routeLinkRow(project, instance, suggestion, { captureLink, isSaved }) {
  const saved = isSaved?.(instance, suggestion.path) ?? false;
  const row = fill(tpl("tpl-route-link-row"), {
    source: SOURCE_LABELS[suggestion.source] || suggestion.source,
    path: suggestion.path,
    href: { href: suggestion.path.startsWith("/") ? `${instance.origin || ""}${suggestion.path}` : suggestion.path },
  });
  const check = row.querySelector("[data-slot=saved-check]");
  if (check) check.hidden = !saved;
  if (!saved) {
    row.addEventListener("click", () => {
      // Fire-and-forget: the link opens via the anchor's own default behavior regardless of
      // whether the capture succeeds, since a failed save should never block navigation to a route
      // the user already confirmed they want by clicking it.
      captureLink?.(project, instance, suggestion).then(() => {
        if (check) check.hidden = false;
      }).catch(() => {});
    });
  }
  return row;
}

function message(text) {
  const p = document.createElement("p");
  p.className = "no-links";
  p.textContent = text;
  return p;
}

// Discovered-routes dropdown content: a portal-menu-button (portal/shared/menu-button.js) mounted
// per-card by app.js shows this as its panel. Not a dialog — see index.html's routes-trigger slot
// comment for why this moved off the three-dot menu.
//
// Two sections, because the two kinds of discovery answer different questions. A sitemap/manifest
// path is a PAGE — something you open, so it is a link and it opens in a new tab. An OpenAPI entry
// is an API ROUTE — most require a method, a body, or auth, so opening one in a browser yields a
// 404/405/JSON blob rather than anything useful. Those get a contract panel and a runnable curl
// instead of a link that lies about being clickable.
//
// Pages sort first: they are the ones you can act on immediately.
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
export async function buildRoutesDropdown(project, instance, { onStale, captureLink, isSaved, onOpenApiRoute } = {}) {
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

  // `kind` is set by the backend (modules/localhoster/metadata.mjs). Falling back on its absence
  // keeps this working against a cached snapshot minted before that field existed.
  const pages = suggestions.filter((s) => (s.kind || "page") === "page");
  const apis = suggestions.filter((s) => s.kind === "api");

  const list = document.createElement("div");
  list.className = "routes-dropdown-list";
  if (pages.length) {
    list.append(sectionHeading("Pages"));
    for (const suggestion of pages) {
      list.append(routeLinkRow(project, instance, suggestion, { captureLink, isSaved }));
    }
  }
  if (apis.length) {
    list.append(sectionHeading("API Routes"));
    for (const suggestion of apis) {
      list.append(apiRouteRow(instance, suggestion, onOpenApiRoute));
    }
  }
  return list;
}

function sectionHeading(text) {
  const heading = document.createElement("div");
  heading.className = "routes-section-heading";
  heading.textContent = text;
  return heading;
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

// An API route is described, not navigated to. The row is a button that opens the contract modal —
// see fillApiRouteDialog, which app.js wires to #api-route-dialog.
function apiRouteRow(instance, suggestion, onOpenApiRoute) {
  const row = fill(tpl("tpl-route-api-row"), {
    method: suggestion.method || "GET",
    path: suggestion.path,
  });
  row.querySelector("[data-slot=method]").dataset.method = (suggestion.method || "GET").toLowerCase();
  row.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenApiRoute?.(instance, suggestion);
  });
  return row;
}

// Populates the API contract modal for one endpoint. Exported so app.js — which owns the dialog
// element and calls showModal() — stays the only place that touches page-level refs, matching how
// history-view.js is structured.
export function fillApiRouteDialog(dialog, instance, suggestion) {
  const method = suggestion.method || "GET";
  dialog.querySelector("[data-slot=method]").textContent = method;
  dialog.querySelector("[data-slot=method]").dataset.method = method.toLowerCase();
  dialog.querySelector("[data-slot=path]").textContent = suggestion.path;

  const summaryEl = dialog.querySelector("[data-slot=summary]");
  const summary = suggestion.summary?.trim();
  summaryEl.hidden = !summary;
  summaryEl.textContent = summary || "";

  const params = suggestion.parameters || [];
  const body = suggestion.requestBody;
  const paramsSlot = dialog.querySelector("[data-slot=params]");
  // Rebuilt per open — the dialog is one shared element reused by every endpoint.
  paramsSlot.replaceChildren();
  for (const [label, location] of [["Path params", "path"], ["Query params", "query"]]) {
    const matching = params.filter((p) => p.in === location);
    if (matching.length) paramsSlot.append(paramTable(label, matching));
  }
  if (body?.fields?.length) {
    paramsSlot.append(paramTable(`Request body (${body.mediaType})`, body.fields));
  }
  if (!paramsSlot.childElementCount) {
    const none = document.createElement("p");
    none.className = "routes-api-empty";
    none.textContent = "No parameters documented.";
    paramsSlot.append(none);
  }

  const { command, placeholders } = buildCurl(instance, suggestion);
  dialog.querySelector("[data-slot=curl-text]").textContent = command;
  const copy = dialog.querySelector("[data-slot=curl-copy]");
  if (copy) copy.copySource = () => command;
  // Driven by what buildCurl actually substituted, not by pattern-matching the rendered command:
  // a real URL segment or header value can legitimately be uppercase, and scanning the text for
  // all-caps runs would warn about commands that are already runnable.
  const hint = dialog.querySelector("[data-slot=curl-hint]");
  hint.hidden = !placeholders.length;
  hint.textContent = placeholders.length
    ? `Replace before running: ${placeholders.join(", ")}`
    : "";
}

function paramTable(title, rows) {
  const table = fill(tpl("tpl-route-param-table"), { title });
  const body = table.querySelector("[data-slot=rows]");
  for (const row of rows) {
    body.append(fill(tpl("tpl-route-param-row"), {
      name: row.name,
      type: row.type || "—",
      required: row.required ? "required" : "optional",
      // The spec's own suggested value, so the reader can see where the curl's value came from.
      example: row.example ?? (row.enum?.length ? row.enum.join(" | ") : "—"),
    }));
  }
  return table;
}

// A command that runs as-is wherever the spec allowed it to, and names what it could not fill.
// Returns { command, placeholders } — the caller shows the placeholder list rather than
// re-deriving it from the rendered text.
//
// Values come only from the spec (example, default, or the first enum member — see firstExample in
// metadata.mjs); nothing is invented. Where the spec offers nothing, the value becomes a
// SCREAMING_SNAKE placeholder named after the parameter, so what needs editing is obvious at a
// glance rather than hidden inside a plausible-looking value.
function buildCurl(instance, suggestion) {
  const method = suggestion.method || "GET";
  const params = suggestion.parameters || [];
  const origin = instance.origin || "";
  // Recorded as they are minted, in the order they appear in the command.
  const placeholders = [];
  const mint = (name) => {
    const token = placeholder(name);
    if (!placeholders.includes(token)) placeholders.push(token);
    return token;
  };

  // Path templating: /api/plans/{key} → /api/plans/PLAN_KEY (or the spec's example).
  let path = suggestion.path;
  for (const parameter of params.filter((p) => p.in === "path")) {
    path = path.replace(`{${parameter.name}}`, () => parameter.example || mint(parameter.name));
  }
  // Any remaining {braces} had no matching parameter declared — still must not survive into a
  // command the user is told they can run.
  path = path.replace(/\{([^}]+)\}/g, (_, name) => mint(name));

  const query = params
    .filter((p) => p.in === "query")
    // Optional parameters with no suggested value are left off entirely: including every optional
    // query key would bury the required ones in placeholders the request does not need.
    .filter((p) => p.required || p.example != null)
    .map((p) => `${encodeURIComponent(p.name)}=${p.example ? encodeURIComponent(p.example) : mint(p.name)}`)
    .join("&");

  const url = `${origin}${path}${query ? `?${query}` : ""}`;
  const parts = [`curl -s${method === "GET" ? "" : ` -X ${method}`} '${url}'`];

  const body = suggestion.requestBody;
  if (body?.fields?.length) {
    parts.push(`  -H 'Content-Type: ${body.mediaType}'`);
    // Only the fields the schema marks required, plus any with a usable example. A stub carrying
    // every optional field is a body the endpoint never asked for.
    const fields = body.fields.filter((f) => f.required || f.example != null);
    const stub = (fields.length ? fields : body.fields).reduce((acc, field) => {
      acc[field.name] = field.example == null ? mint(field.name) : bodyFieldValue(field);
      return acc;
    }, {});
    parts.push(`  -d '${JSON.stringify(stub)}'`);
  } else if (body) {
    // A body is required but its shape was not documented (no properties, or a non-JSON media
    // type) — say so rather than emitting an empty -d that would post nothing.
    parts.push(`  -H 'Content-Type: ${body.mediaType}'`);
    parts.push(`  -d '${mint("request body")}'`);
  }
  return { command: parts.join(" \\\n"), placeholders };
}

// JSON-typed, so the body validates against the schema it came from. Examples arrive as strings
// (metadata.mjs stringifies them for uniform handling), and emitting {"port":"3000"} for an
// integer field would be rejected by any endpoint that actually checks its types.
//
// Only called for fields that HAVE an example — a field without one becomes a placeholder string
// upstream, which stays a string whatever the declared type, since a bare PORT token would not be
// valid JSON.
function bodyFieldValue(field) {
  if (field.type === "integer" || field.type === "number") {
    const numeric = Number(field.example);
    if (Number.isFinite(numeric)) return numeric;
  }
  if (field.type === "boolean") {
    if (field.example === "true") return true;
    if (field.example === "false") return false;
  }
  return field.example;
}

// PLAN_KEY from "planKey"/"plan-key"/"plan key" — the caller sees the parameter's own name in the
// shape constants conventionally take, so it is unmistakably a thing to replace.
function placeholder(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toUpperCase();
}

function message(text) {
  const p = document.createElement("p");
  p.className = "no-links";
  p.textContent = text;
  return p;
}

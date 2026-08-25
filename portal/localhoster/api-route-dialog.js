import { portalFillSlots as fill, portalTpl as tpl } from "/portal/shared/api.js";

// Populates the API contract modal for one endpoint. app.js owns the shared dialog element and
// showModal(); this module owns the API-contract rendering and runnable curl construction.
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
      type: row.type || "-",
      required: row.required ? "required" : "optional",
      example: row.example ?? (row.enum?.length ? row.enum.join(" | ") : "-"),
    }));
  }
  return table;
}

// A command that runs as-is where the spec allows it, and names what it could not fill.
function buildCurl(instance, suggestion) {
  const method = suggestion.method || "GET";
  const params = suggestion.parameters || [];
  const origin = instance.origin || "";
  const placeholders = [];
  const mint = (name) => {
    const token = placeholder(name);
    if (!placeholders.includes(token)) placeholders.push(token);
    return token;
  };

  let path = suggestion.path;
  for (const parameter of params.filter((p) => p.in === "path")) {
    path = path.replace(`{${parameter.name}}`, () => parameter.example || mint(parameter.name));
  }
  path = path.replace(/\{([^}]+)\}/g, (_, name) => mint(name));

  const query = params
    .filter((p) => p.in === "query")
    .filter((p) => p.required || p.example != null)
    .map((p) => `${encodeURIComponent(p.name)}=${p.example ? encodeURIComponent(p.example) : mint(p.name)}`)
    .join("&");

  const url = `${origin}${path}${query ? `?${query}` : ""}`;
  const parts = [`curl -s${method === "GET" ? "" : ` -X ${method}`} '${url}'`];

  const body = suggestion.requestBody;
  if (body?.fields?.length) {
    parts.push(`  -H 'Content-Type: ${body.mediaType}'`);
    const fields = body.fields.filter((f) => f.required || f.example != null);
    const stub = (fields.length ? fields : body.fields).reduce((acc, field) => {
      acc[field.name] = field.example == null ? mint(field.name) : bodyFieldValue(field);
      return acc;
    }, {});
    parts.push(`  -d '${JSON.stringify(stub)}'`);
  } else if (body) {
    parts.push(`  -H 'Content-Type: ${body.mediaType}'`);
    parts.push(`  -d '${mint("request body")}'`);
  }
  return { command: parts.join(" \\\n"), placeholders };
}

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

function placeholder(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toUpperCase();
}

import { fetchLoopbackText } from "./http-probe.mjs";
import { normalizeRoutePath } from "./settings-schema.mjs";

const SOURCE_PRIORITY = ["openapi", "sitemap", "manifest", "robots"];
const AUTH_LOOKING_SEGMENTS = /\/(admin|login|logout|signin|sign-in|signup|sign-up|dashboard|account|settings|internal)(\/|$|\?)/i;

// No single conventional path exists for an OpenAPI/Swagger document the way there is for
// manifest.json or sitemap.xml, but a handful of paths cover most real frameworks. Tried in this
// order, first one that parses as a valid OpenAPI/Swagger document (has a `paths` object) wins —
// an explicit `openApiUrl` override always takes priority over guessing when a caller supplies one.
// JSON only: discoverOpenApiPaths has no YAML parser, so a *.yaml path would never validate even if
// served — omitted rather than listed as a candidate that can structurally never succeed.
const CONVENTIONAL_OPENAPI_PATHS = [
  "/openapi.json",
  "/swagger.json",
  "/v3/api-docs",
  "/v2/api-docs",
  "/api-docs",
];

// Everything this module fetches is same-origin, loopback-only, cookie-free, and body/time capped —
// enforced once by fetchLoopbackText (modules/localhoster/probe.mjs), never re-implemented here.
// Discovery never throws: a source that is absent, malformed, or fails to parse simply contributes
// no suggestions, so one broken app never breaks the metadata panel for every other app.
export async function discoverMetadataSuggestions(origin, { fetchText = fetchLoopbackText, openApiUrl = null } = {}) {
  const [manifestPaths, robotsSitemapPaths, sitemapPaths, openApiPaths] = await Promise.all([
    discoverManifestPaths(origin, fetchText),
    discoverRobotsSitemapPaths(origin, fetchText),
    discoverSitemapPaths(`${origin}/sitemap.xml`, fetchText),
    discoverOpenApiPaths(openApiUrl ? [openApiUrl] : CONVENTIONAL_OPENAPI_PATHS.map((path) => `${origin}${path}`), fetchText),
  ]);

  const bySource = {
    manifest: manifestPaths,
    robots: robotsSitemapPaths,
    sitemap: sitemapPaths,
    openapi: openApiPaths,
  };

  return dedupeSuggestions(bySource, origin);
}

async function discoverManifestPaths(origin, fetchText) {
  const result = await fetchText(`${origin}/manifest.json`, { accept: "application/manifest+json,application/json" });
  if (!result.ok || !result.body) return [];
  const manifest = safeJsonParse(result.body);
  if (!manifest || typeof manifest !== "object") return [];
  const paths = [];
  if (typeof manifest.start_url === "string") paths.push({ path: manifest.start_url, label: manifest.name || manifest.short_name || null });
  return paths;
}

async function discoverRobotsSitemapPaths(origin, fetchText) {
  const result = await fetchText(`${origin}/robots.txt`, { accept: "text/plain" });
  if (!result.ok || !result.body) return [];
  const sitemapUrls = [...result.body.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].map((match) => match[1]);
  const perSitemap = await Promise.all(sitemapUrls.map((url) => discoverSitemapPaths(resolveAgainst(origin, url), fetchText)));
  return perSitemap.flat();
}

async function discoverSitemapPaths(sitemapUrl, fetchText) {
  if (!sitemapUrl) return [];
  const result = await fetchText(sitemapUrl, { accept: "application/xml,text/xml" });
  if (!result.ok || !result.body) return [];
  return [...result.body.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) => ({ path: decodeXmlEntities(match[1].trim()), label: null }));
}

// Tries each candidate URL in order and stops at the first one that parses as a valid document —
// not the first one that merely responds 200, since a dev server's catch-all route can return 200
// with an HTML shell for any path, including a guessed OpenAPI path that doesn't really exist.
//
// Each path yields one suggestion per HTTP method, not one per path: GET /items and DELETE /items
// are different operations with different contracts, and collapsing them to a bare path was what
// made these routes unusable as links — the panel could not say what to send or what would happen.
async function discoverOpenApiPaths(candidateUrls, fetchText) {
  for (const url of candidateUrls) {
    const result = await fetchText(url, { accept: "application/json,application/yaml" });
    if (!result.ok || !result.body) continue;
    const doc = safeJsonParse(result.body);
    if (!doc || typeof doc.paths !== "object" || doc.paths === null) continue;
    return openApiOperations(doc);
  }
  return [];
}

// Only the members of a path item that are operations. `parameters`, `summary`, `servers`, and
// `$ref` are siblings of the verbs in OpenAPI's path-item object, so iterating raw keys would mint
// phantom "SUMMARY /items" entries.
const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];

// Flattens the document into one entry per (path, method), carrying just enough of the contract to
// render a readable panel and build a runnable curl: the method, a summary, the parameters, and the
// request body's top-level field names. Deliberately NOT the full resolved schema — nested $ref
// graphs are large, and every field below is one the panel or the curl actually reads.
function openApiOperations(doc) {
  const operations = [];
  for (const [path, pathItem] of Object.entries(doc.paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    // Path-level parameters apply to every operation under it, so they merge into each one.
    const shared = normalizeParameters(pathItem.parameters, doc);
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== "object") continue;
      operations.push({
        path,
        label: null,
        method: method.toUpperCase(),
        summary: typeof operation.summary === "string" ? operation.summary
          : typeof operation.description === "string" ? operation.description
          : null,
        parameters: [...shared, ...normalizeParameters(operation.parameters, doc)],
        requestBody: normalizeRequestBody(operation.requestBody, doc),
      });
    }
  }
  return operations;
}

// Local $ref resolution only ("#/components/..."). An external or remote ref is left unresolved
// rather than fetched: this module's whole fetch surface is same-origin and capped, and chasing a
// ref off-document would quietly break that guarantee. Depth-capped because a $ref cycle
// (a schema referencing itself) is legal in OpenAPI and would otherwise spin forever.
function resolveRef(node, doc, depth = 0) {
  if (!node || typeof node !== "object" || typeof node.$ref !== "string" || depth > 8) return node;
  if (!node.$ref.startsWith("#/")) return node;
  let current = doc;
  for (const segment of node.$ref.slice(2).split("/")) {
    // JSON Pointer escapes, per RFC 6901 — "~1" is a literal "/" in a key, "~0" a literal "~".
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!current || typeof current !== "object") return node;
    current = current[key];
  }
  return resolveRef(current, doc, depth + 1);
}

// One flat record per parameter. `example` is what lets the curl builder emit a command that runs
// without editing (see the "real value, else placeholder" strategy in buildCurl) — it is read from
// the spec's own example/default/enum, never invented.
function normalizeParameters(parameters, doc) {
  if (!Array.isArray(parameters)) return [];
  const out = [];
  for (const raw of parameters) {
    const parameter = resolveRef(raw, doc);
    if (!parameter || typeof parameter.name !== "string") continue;
    // Only the two locations a caller can actually put a value in a curl URL. Header and cookie
    // params are real but belong to auth/session concerns this panel does not try to model.
    if (parameter.in !== "path" && parameter.in !== "query") continue;
    const schema = resolveRef(parameter.schema, doc) || {};
    out.push({
      name: parameter.name,
      in: parameter.in,
      // Path parameters are always required per the spec, whether or not they say so.
      required: parameter.required === true || parameter.in === "path",
      type: typeof schema.type === "string" ? schema.type : null,
      enum: Array.isArray(schema.enum) ? schema.enum.map(String) : null,
      example: firstExample(parameter, schema),
    });
  }
  return out;
}

// The spec's own suggested value, in descending order of intent: an explicit example beats a
// default, which beats "the first thing the enum allows". Null when the spec offers nothing, which
// is the signal for the curl builder to emit a NAMED_PLACEHOLDER instead.
function firstExample(parameter, schema) {
  for (const candidate of [parameter.example, schema.example, schema.default]) {
    if (candidate != null && typeof candidate !== "object") return String(candidate);
  }
  if (Array.isArray(schema.enum) && schema.enum.length && schema.enum[0] != null) {
    return String(schema.enum[0]);
  }
  return null;
}

// Top-level field names and their required flags — enough to show what the body must contain and to
// stub a JSON skeleton for the curl. Nested object shapes are intentionally not walked.
function normalizeRequestBody(requestBody, doc) {
  const body = resolveRef(requestBody, doc);
  if (!body || typeof body.content !== "object" || body.content === null) return null;
  // JSON first; otherwise whatever single media type the operation declares, so a form-encoded
  // endpoint still reports its content type rather than being dropped as "no body".
  const mediaType = Object.keys(body.content).find((type) => /json/i.test(type))
    || Object.keys(body.content)[0]
    || null;
  if (!mediaType) return null;
  const schema = resolveRef(body.content[mediaType]?.schema, doc) || {};
  const { properties, required } = collectObjectShape(schema, doc);
  const fields = Object.entries(properties).map(([name, rawProperty]) => {
    const property = resolveRef(rawProperty, doc) || {};
    return {
      name,
      type: typeof property.type === "string" ? property.type : null,
      required: required.has(name),
      example: firstExample({}, property),
    };
  });
  return { mediaType, required: body.required === true, fields };
}

// The object shape a schema describes, looking through the wrappers real specs actually use.
// Reading `schema.properties` alone was correct only for a bare inline object: every other shape
// below yielded zero fields, and the panel reported "No parameters documented" for a body that was
// fully documented — the failure mode that makes a contract panel worse than no panel, because it
// states an absence rather than admitting it did not look.
//
//   allOf  - merged. This is composition: "these fields AND those", so the union is the real shape.
//            Generators (FastAPI, NestJS, zod-to-openapi) emit it for any schema built on a base.
//   oneOf  - first branch only, and anyOf likewise. A union has no single field list, and merging
//   anyOf    alternatives would invent an object no valid request matches. The first branch is the
//            one the curl builder would send, so it is the one worth describing.
//   array  - described by its items. A bulk POST body is one shape repeated; naming the element's
//            fields is the useful answer, and the type column still reports the wrapper.
//
// Depth-capped for the same reason resolveRef is: a self-referential schema is legal and would
// otherwise recurse forever.
function collectObjectShape(node, doc, depth = 0) {
  const empty = { properties: {}, required: new Set() };
  const schema = resolveRef(node, doc);
  if (!schema || typeof schema !== "object" || depth > 8) return empty;

  if (schema.properties && typeof schema.properties === "object") {
    return {
      properties: schema.properties,
      required: new Set(Array.isArray(schema.required) ? schema.required : []),
    };
  }
  if (Array.isArray(schema.allOf)) {
    const merged = { properties: {}, required: new Set() };
    for (const branch of schema.allOf) {
      const part = collectObjectShape(branch, doc, depth + 1);
      Object.assign(merged.properties, part.properties);
      for (const name of part.required) merged.required.add(name);
    }
    return merged;
  }
  for (const keyword of ["oneOf", "anyOf"]) {
    if (Array.isArray(schema[keyword]) && schema[keyword].length) {
      return collectObjectShape(schema[keyword][0], doc, depth + 1);
    }
  }
  if (schema.items) return collectObjectShape(schema.items, doc, depth + 1);
  // A free-form object (`type: object` with no properties) or a map-shaped one
  // (`additionalProperties`) genuinely has no named fields to list. Returning empty here is honest:
  // the panel's "No parameters documented" is then a true statement rather than a parse failure.
  return empty;
}

// Keyed by path AND method, not path alone. An OpenAPI document routinely defines several
// operations on one path (GET /items to list, POST /items to create); collapsing those to a single
// entry would silently drop every verb but the first. Non-API sources have no method, so their key
// is just the path and they dedupe exactly as before.
//
// `kind` splits what the panel can navigate to from what it can only describe: a sitemap URL is a
// page you open, an OpenAPI operation is a contract you call. The portal renders them as two
// separate sections off this field.
function dedupeSuggestions(bySource, origin) {
  const byKey = new Map();
  for (const source of SOURCE_PRIORITY) {
    for (const entry of bySource[source] || []) {
      if (!isSameOrigin(entry.path, origin)) continue;
      const normalized = safeNormalizePath(entry.path);
      if (!normalized) continue;
      if (isAuthLooking(normalized) && source !== "openapi" && source !== "sitemap") continue;
      const kind = source === "openapi" ? "api" : "page";
      const key = entry.method ? `${entry.method} ${normalized}` : normalized;
      if (byKey.has(key)) continue;
      const suggestion = { path: normalized, label: entry.label, source, kind };
      // API-only contract fields. Omitted entirely for page suggestions rather than set to null,
      // so a sitemap entry's shape stays exactly what it has always been.
      if (kind === "api") {
        suggestion.method = entry.method || "GET";
        suggestion.summary = entry.summary || null;
        suggestion.parameters = entry.parameters || [];
        suggestion.requestBody = entry.requestBody || null;
      }
      byKey.set(key, suggestion);
    }
  }
  return [...byKey.values()];
}

function isAuthLooking(path) {
  return AUTH_LOOKING_SEGMENTS.test(path);
}

// normalizeRoutePath alone only proves a URL is *some* loopback host — a sitemap or manifest served
// by the probed app could name a different loopback port entirely (another local app, malicious or
// just misconfigured), and normalizeRoutePath would strip that URL down to a bare path with no trace
// the host ever differed. A suggestion is only trustworthy if it names this app's own origin or is a
// bare path/relative reference that can only ever resolve there.
function isSameOrigin(value, origin) {
  if (typeof value !== "string" || value.startsWith("/")) return true;
  try {
    return new URL(value, origin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

function safeNormalizePath(value) {
  try {
    return normalizeRoutePath(value);
  } catch {
    return null;
  }
}

function resolveAgainst(origin, value) {
  try {
    return new URL(value, origin).href;
  } catch {
    return null;
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function decodeXmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

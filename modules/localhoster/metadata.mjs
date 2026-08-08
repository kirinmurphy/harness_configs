import { fetchLoopbackText } from "./http-probe.mjs";
import { normalizeRoutePath } from "./settings-schema.mjs";

const SOURCE_PRIORITY = ["openapi", "sitemap", "manifest", "robots"];
const AUTH_LOOKING_SEGMENTS = /\/(admin|login|logout|signin|sign-in|signup|sign-up|dashboard|account|settings|internal)(\/|$|\?)/i;

// No single conventional path exists for an OpenAPI/Swagger document the way there is for
// manifest.json or sitemap.xml, but a handful of paths cover most real frameworks. Tried in this
// order, first one that parses as a valid OpenAPI/Swagger document (has a `paths` object) wins —
// an explicit `openApiUrl` override always takes priority over guessing when a caller supplies one.
const CONVENTIONAL_OPENAPI_PATHS = [
  "/openapi.json",
  "/openapi.yaml",
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
async function discoverOpenApiPaths(candidateUrls, fetchText) {
  for (const url of candidateUrls) {
    const result = await fetchText(url, { accept: "application/json,application/yaml" });
    if (!result.ok || !result.body) continue;
    const doc = safeJsonParse(result.body);
    if (!doc || typeof doc.paths !== "object" || doc.paths === null) continue;
    return Object.keys(doc.paths).map((path) => ({ path, label: null }));
  }
  return [];
}

function dedupeSuggestions(bySource, origin) {
  const byPath = new Map();
  for (const source of SOURCE_PRIORITY) {
    for (const entry of bySource[source] || []) {
      if (!isSameOrigin(entry.path, origin)) continue;
      const normalized = safeNormalizePath(entry.path);
      if (!normalized) continue;
      if (isAuthLooking(normalized) && source !== "openapi" && source !== "sitemap") continue;
      const existing = byPath.get(normalized);
      if (existing) continue;
      byPath.set(normalized, { path: normalized, label: entry.label, source });
    }
  }
  return [...byPath.values()];
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

import { fetchLoopbackText } from "./http-probe.mjs";
import { normalizeRoutePath } from "./settings-schema.mjs";

const SOURCE_PRIORITY = ["openapi", "sitemap", "manifest", "robots"];
const AUTH_LOOKING_SEGMENTS = /\/(admin|login|logout|signin|sign-in|signup|sign-up|dashboard|account|settings|internal)(\/|$|\?)/i;

// Everything this module fetches is same-origin, loopback-only, cookie-free, and body/time capped —
// enforced once by fetchLoopbackText (modules/localhoster/probe.mjs), never re-implemented here.
// Discovery never throws: a source that is absent, malformed, or fails to parse simply contributes
// no suggestions, so one broken app never breaks the metadata panel for every other app.
export async function discoverMetadataSuggestions(origin, { fetchText = fetchLoopbackText, openApiUrl = null } = {}) {
  const [manifestPaths, robotsSitemapPaths, sitemapPaths, openApiPaths] = await Promise.all([
    discoverManifestPaths(origin, fetchText),
    discoverRobotsSitemapPaths(origin, fetchText),
    discoverSitemapPaths(`${origin}/sitemap.xml`, fetchText),
    openApiUrl ? discoverOpenApiPaths(openApiUrl, fetchText) : Promise.resolve([]),
  ]);

  const bySource = {
    manifest: manifestPaths,
    robots: robotsSitemapPaths,
    sitemap: sitemapPaths,
    openapi: openApiPaths,
  };

  return dedupeSuggestions(bySource);
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

async function discoverOpenApiPaths(openApiUrl, fetchText) {
  const result = await fetchText(openApiUrl, { accept: "application/json,application/yaml" });
  if (!result.ok || !result.body) return [];
  const doc = safeJsonParse(result.body);
  if (!doc || typeof doc.paths !== "object" || doc.paths === null) return [];
  return Object.keys(doc.paths).map((path) => ({ path, label: null }));
}

function dedupeSuggestions(bySource) {
  const byPath = new Map();
  for (const source of SOURCE_PRIORITY) {
    for (const entry of bySource[source] || []) {
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

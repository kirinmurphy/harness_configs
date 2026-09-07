import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { repoRoot } from "./paths.mjs";
import { computePortalSourceHash } from "./portal-source-hash.mjs";
import { send } from "./portal-routes-http.mjs";
import { dispatchRoutes, validateRouteTables } from "./portal-router.mjs";
import { configRoutes } from "./portal-routes-config.mjs";
import { maintenanceRoutes } from "./portal-routes-maintenance.mjs";
import { plansRoutes } from "./portal-routes-plans.mjs";
import { localhosterRoutes } from "./portal-routes-localhoster.mjs";
import { telemetryRoutes } from "./portal-routes-telemetry.mjs";
import { repositoriesRoutes } from "./portal-routes-repositories.mjs";
import { usageRoutes } from "./portal-routes-usage.mjs";
import { handleMetadataAsset } from "./portal-routes-metadata.mjs";

// Every domain's route table, concatenated once — the single enumerable list of this portal's
// entire API surface (see portal-router.mjs). A future OpenAPI doc can be generated straight from
// this array instead of hand-maintained, since nothing routes outside it.
const API_ROUTE_TABLES = [
  configRoutes,
  maintenanceRoutes,
  plansRoutes,
  localhosterRoutes,
  repositoriesRoutes,
  usageRoutes,
  telemetryRoutes,
];
validateRouteTables(API_ROUTE_TABLES);

// Tiny local-only portal server. Binds to loopback only so telemetry/config data never leaves the
// machine. Stdlib `http` keeps the install dependency-free, matching the rest of the CLI.
const LOOPBACK = "127.0.0.1";
const PORTAL_DIR = path.join(repoRoot, "portal");
const APP_NAME = "roborepo";

// Computed once at startup so a new `serve`/`web` invocation can detect "a portal is already
// running at this path, but its code is now stale" and restart it instead of reusing it (see
// resolvePortalPort in telemetry.mjs). See portal-source-hash.mjs for why this exists.
const SOURCE_HASH = computePortalSourceHash();
const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

// Single source of truth for portal HTML pages. To add a page: (1) add an entry here, (2) create
// portal/<dir>/{index.html,styles.css,app.js} linking /portal/shared/base.css + theme.js. The
// browser nav (portal/shared/theme.js) reads this list from window.ROBOREPO_PORTAL, injected by
// pageHtml() below, so there is nothing to hand-sync client-side. See docs/user/reference/portal.md.
// Each page's HTML is just its index.html read from disk (mirrors static assets). `default: true`
// marks the page served at "/" (what `roborepo web` opens). Home owns "/" as its canonical route;
// Agents lives at canonical "/config". Order here is the global nav order.
export const PAGES = [
  { path: "/", id: "home", title: "Home", dir: "home", default: true },
  { path: "/config", id: "config", title: "Agents", dir: "config" },
  { path: "/plans", id: "plans", title: "Plans", dir: "plans" },
  // The v2 token report owns /tokens (id/dir keep the tokens2 module paths). The v1 telemetry
  // dashboard stays served at /tokens_v1 for comparison, hidden from nav (hidden: true) until the
  // v1 retirement call is made — nav headers shouldn't advertise two token pages.
  { path: "/tokens", id: "tokens2", title: "Tokens", dir: "tokens2" },
  { path: "/tokens_v1", id: "telemetry", title: "Tokens", dir: "telemetry", hidden: true },
  {
    path: "/localhoster",
    id: "localhoster",
    title: "Localhost",
    dir: "localhoster",
  },
];
const PAGE_BY_PATH = new Map(PAGES.map((p) => [p.path, p]));
// Shape shared by /api/portal/status and the browser-injected manifest so both can never drift.
const pageManifest = () =>
  // `hidden` rides along: the browser nav (theme.js) needs it to keep hidden pages served but
  // out of the header. Shape stays browser-safe (plain path/id/title/hidden).
  PAGES.map(({ path, id, title, hidden }) => hidden ? { path, id, title, hidden: true } : { path, id, title });

// The <head> boilerplate (theme-flash guard + meta tags) is identical across every page except
// the title and stylesheet href, so each page's index.html holds just a {{HEAD}} marker instead
// of repeating it. Resolved from PAGES' own title/dir fields — nothing to hand-sync per page.
const HEAD_PARTIAL_PATH = path.join(PORTAL_DIR, "shared", "head-partial.html");
const renderHead = (page) =>
  fs
    .readFileSync(HEAD_PARTIAL_PATH, "utf8")
    .replace("{{TITLE}}", page.title.toLowerCase())
    .replace("{{STYLE_HREF}}", `/portal/${page.dir}/styles.css`);

// The header/footer/nav-link <template>s (cloned client-side by portal/shared/theme.js) are
// identical across every page, so they live in one partial here instead of being duplicated per
// index.html — same pattern as {{HEAD}} above.
const CHROME_PARTIAL_PATH = path.join(
  PORTAL_DIR,
  "shared",
  "chrome-partial.html",
);
const renderChrome = () => fs.readFileSync(CHROME_PARTIAL_PATH, "utf8");

// The loading overlay must be real markup in the initial HTML response (not cloned from a
// <template> by JS) so it paints on the very first frame — a client-side clone happens after the
// page's static shell already painted, producing a visible flash of unhydrated content. It's
// injected at {{LOADING}}, which every page places as <main>'s first child (see base.css: it's
// absolutely positioned against `main { position: relative }`).
const LOADING_PARTIAL_PATH = path.join(
  PORTAL_DIR,
  "shared",
  "loading-partial.html",
);
const renderLoading = () => fs.readFileSync(LOADING_PARTIAL_PATH, "utf8");

// <template>s for shared/*.js custom elements (option-dropdown, token-chip, menu-button,
// copy-button, close-button, notice) — same one-partial-many-pages pattern as {{CHROME}}, since
// those elements are cloned/instantiated across every page, not just one.
const WIDGET_TEMPLATES_PARTIAL_PATH = path.join(
  PORTAL_DIR,
  "shared",
  "widget-templates-partial.html",
);
const renderWidgetTemplates = () => fs.readFileSync(WIDGET_TEMPLATES_PARTIAL_PATH, "utf8");

const pageHtml = (page, token) =>
  fs
    .readFileSync(path.join(PORTAL_DIR, page.dir, "index.html"), "utf8")
    .replace("{{HEAD}}", renderHead(page))
    .replace("{{CHROME}}", renderChrome())
    .replace("{{LOADING}}", renderLoading())
    .replace("{{WIDGET_TEMPLATES}}", renderWidgetTemplates())
    .replace(
      "</head>",
      `<meta name="roborepo-portal-token" content="${token}" />\n` +
        `<script>window.ROBOREPO_PORTAL = ${JSON.stringify({ token, pages: pageManifest() })};</script>\n</head>`,
    );

export function startPortalServer(handlers) {
  const { port } = handlers;
  const mutationToken = crypto.randomBytes(32).toString("base64url");
  const server = http.createServer((req, res) => {
    try {
      route(req, res, handlers, mutationToken);
    } catch (err) {
      send(
        res,
        500,
        "application/json",
        JSON.stringify({ error: String(err?.message || err) }),
      );
    }
  });
  server.listen(port, LOOPBACK, () => {
    const addr = server.address();
    const actualPort = typeof addr === "object" && addr ? addr.port : port;
    if (process.env.ROBOREPO_PORTAL_READY_FILE) {
      try {
        fs.writeFileSync(
          process.env.ROBOREPO_PORTAL_READY_FILE,
          `ready:${actualPort}\n`,
        );
      } catch {}
    }
    console.log(`roborepo portal:     http://${LOOPBACK}:${actualPort}`);
    console.log(
      `localhoster:         http://${LOOPBACK}:${actualPort}/localhoster`,
    );
    console.log(`tokens dashboard:    http://${LOOPBACK}:${actualPort}/tokens`);
    console.log("(Ctrl-C to stop)");
    handlers.onListening?.(actualPort);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && handlers.onPortInUse?.() === true) return;
    console.error(
      err.code === "EADDRINUSE"
        ? `port ${port} is in use; try --port <n>`
        : String(err),
    );
    process.exit(1);
  });
  return server;
}

// Loopback bind keeps the portal local, but browser pages can still attempt cross-origin POSTs.
// Mutating routes require both a loopback Origin (when present) and the per-server token embedded
// only in served portal HTML. Read-only routes stay tokenless for curl/debugging.
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return LOOPBACK_ORIGIN.test(origin);
}

function mutationTokenAllowed(req, token) {
  return req.headers["x-roborepo-portal-token"] === token;
}

// Any non-read method mutates and must clear the origin+token guard. Today only POST endpoints
// exist; PATCH was added with the repository API (Phase 4), so the guard covers it too.
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
function isMutation(req) {
  return MUTATING_METHODS.has(req.method);
}

// Each handleXApi/handlePortalX function returns true once it has written a response, false if the
// URL/method didn't match so route() can try the next domain. route() itself only does URL parsing,
// the origin+token guard, dispatch in order, and the final 404 — no domain-specific logic here.
function route(req, res, handlers, mutationToken) {
  const [urlPath, qs = ""] = (req.url || "/").split("?");

  if (isMutation(req) && !originAllowed(req)) {
    return send(
      res,
      403,
      "application/json",
      JSON.stringify({ error: "cross-origin request rejected" }),
    );
  }
  if (isMutation(req) && !mutationTokenAllowed(req, mutationToken)) {
    return send(
      res,
      403,
      "application/json",
      JSON.stringify({ error: "portal token required" }),
    );
  }

  if (dispatchRoutes(API_ROUTE_TABLES, req, res, urlPath, qs, handlers)) return;
  if (handleMetadataAsset(req, res, urlPath, { pages: PAGES, appName: APP_NAME, apiRouteTables: API_ROUTE_TABLES })) return;
  if (handlePortalPage(req, res, urlPath, mutationToken)) return;
  if (handlePortalAsset(req, res, urlPath)) return;
  if (handleDocsAsset(req, res, urlPath)) return;
  if (handlePortalStatus(req, res, urlPath)) return;
  send(res, 404, "text/plain", "not found");
}

function handlePortalPage(req, res, urlPath, mutationToken) {
  const page = PAGE_BY_PATH.get(urlPath);
  if (!page) return false;
  send(res, 200, "text/html; charset=utf-8", pageHtml(page, mutationToken));
  return true;
}

function handlePortalAsset(req, res, urlPath) {
  if (!urlPath.startsWith("/portal/")) return false;
  servePortalAsset(req, urlPath, res);
  return true;
}

function handleDocsAsset(req, res, urlPath) {
  if (!urlPath.startsWith("/docs/")) return false;
  serveDocsAsset(req, urlPath, res);
  return true;
}

function handlePortalStatus(req, res, urlPath) {
  if (urlPath !== "/api/portal/status") return false;
  send(
    res,
    200,
    "application/json",
    JSON.stringify({
      ok: true,
      pid: process.pid,
      appRoot: repoRoot,
      portalDir: PORTAL_DIR,
      sourceHash: SOURCE_HASH,
      pages: pageManifest(),
    }),
  );
  return true;
}

// Static assets are re-requested on every page nav. no-store forced a full re-download + re-parse
// each time; instead we send an ETag (mtime+size) and Cache-Control: no-cache so the browser
// revalidates with a conditional GET and gets a tiny 304 when the file is unchanged. "no-cache"
// (not max-age) means edits to CSS/JS still show on the next nav — right for a dev tool — while
// skipping the redundant transfer. Returns the headers to attach, or null on a served 304.
function assetCacheHeaders(req, res, assetPath) {
  let stat;
  try {
    stat = fs.statSync(assetPath);
  } catch {
    return {}; // caller's readFileSync will fail next and 404; no cache headers to add.
  }
  const etag = `"${stat.mtimeMs}-${stat.size}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" });
    res.end();
    return null;
  }
  return { ETag: etag, "Cache-Control": "no-cache" };
}

function servePortalAsset(req, urlPath, res) {
  const relative = decodeURIComponent(urlPath.slice("/portal/".length));
  const assetPath = path.resolve(PORTAL_DIR, relative);
  if (!assetPath.startsWith(PORTAL_DIR + path.sep))
    return send(res, 404, "text/plain", "not found");
  const cacheHeaders = assetCacheHeaders(req, res, assetPath);
  if (cacheHeaders === null) return; // 304 already written
  let content;
  try {
    content = fs.readFileSync(assetPath);
  } catch {
    return send(res, 404, "text/plain", "not found");
  }
  const type =
    STATIC_TYPES[path.extname(assetPath)] || "application/octet-stream";
  send(res, 200, type, content, cacheHeaders);
}

function serveDocsAsset(req, urlPath, res) {
  const relative = decodeURIComponent(urlPath.slice("/".length));
  const docsRoot = path.join(repoRoot, "docs");
  const assetPath = path.resolve(repoRoot, relative);
  if (!assetPath.startsWith(docsRoot + path.sep))
    return send(res, 404, "text/plain", "not found");
  const cacheHeaders = assetCacheHeaders(req, res, assetPath);
  if (cacheHeaders === null) return; // 304 already written
  let content;
  try {
    content = fs.readFileSync(assetPath);
  } catch {
    return send(res, 404, "text/plain", "not found");
  }
  const type =
    STATIC_TYPES[path.extname(assetPath)] || "text/plain; charset=utf-8";
  send(res, 200, type, content, cacheHeaders);
}

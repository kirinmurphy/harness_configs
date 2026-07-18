import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { repoRoot } from "./paths.mjs";

// Tiny local-only portal server. Binds to loopback only so telemetry/config data never leaves the
// machine. Stdlib `http` keeps the install dependency-free, matching the rest of the CLI.
const LOOPBACK = "127.0.0.1";
const PORTAL_DIR = path.join(repoRoot, "portal");
const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

// Single source of truth for portal HTML pages. To add a page: (1) add an entry here, (2) create
// portal/<dir>/{index.html,styles.css,app.js} linking /portal/shared/base.css + theme.js. The
// browser nav (portal/shared/theme.js) reads this list from window.ROBOREPO_PORTAL, injected by
// pageHtml() below, so there is nothing to hand-sync client-side. See docs/reference/services/portal.md.
// Each page's HTML is just its index.html read from disk (mirrors static assets). `default: true`
// marks the page served at "/" (what `roborepo serve` opens). Keep "/config" as a stable alias for
// existing docs, tests, and saved browser links.
export const PAGES = [
  { path: "/", id: "config", title: "Config", dir: "config", default: true },
  { path: "/plans", id: "plans", title: "Plans", dir: "plans" },
  { path: "/telemetry", id: "telemetry", title: "Telemetry", dir: "telemetry" },
];
const PAGE_BY_PATH = new Map(PAGES.flatMap((p) => (
  p.id === "config" ? [[p.path, p], ["/config", p]] : [[p.path, p]]
)));
// Shape shared by /api/portal/status and the browser-injected manifest so both can never drift.
const pageManifest = () => PAGES.map(({ path, id, title }) => ({ path, id, title }));

// The <head> boilerplate (theme-flash guard + meta tags) is identical across every page except
// the title and stylesheet href, so each page's index.html holds just a {{HEAD}} marker instead
// of repeating it. Resolved from PAGES' own title/dir fields — nothing to hand-sync per page.
const HEAD_PARTIAL_PATH = path.join(PORTAL_DIR, "shared", "head-partial.html");
const renderHead = (page) => fs.readFileSync(HEAD_PARTIAL_PATH, "utf8")
  .replace("{{TITLE}}", page.title.toLowerCase())
  .replace("{{STYLE_HREF}}", `/portal/${page.dir}/styles.css`);

const pageHtml = (page, token) => fs.readFileSync(path.join(PORTAL_DIR, page.dir, "index.html"), "utf8")
  .replace("{{HEAD}}", renderHead(page))
  .replace("</head>", `<meta name="roborepo-portal-token" content="${token}" />\n`
    + `<script>window.ROBOREPO_PORTAL = ${JSON.stringify({ token, pages: pageManifest() })};</script>\n</head>`);

export function startPortalServer(handlers) {
  const { port } = handlers;
  const mutationToken = crypto.randomBytes(32).toString("base64url");
  const server = http.createServer((req, res) => {
    try {
      route(req, res, handlers, mutationToken);
    } catch (err) {
      send(res, 500, "application/json", JSON.stringify({ error: String(err?.message || err) }));
    }
  });
  server.listen(port, LOOPBACK, () => {
    const addr = server.address();
    const actualPort = typeof addr === "object" && addr ? addr.port : port;
    if (process.env.ROBOREPO_PORTAL_READY_FILE) {
      try {
        fs.writeFileSync(process.env.ROBOREPO_PORTAL_READY_FILE, `ready:${actualPort}\n`);
      } catch {}
    }
    console.log(`roborepo portal:     http://${LOOPBACK}:${actualPort}`);
    console.log(`telemetry dashboard: http://${LOOPBACK}:${actualPort}/telemetry`);
    console.log("(Ctrl-C to stop)");
    handlers.onListening?.(actualPort);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && handlers.onPortInUse?.() === true) return;
    console.error(err.code === "EADDRINUSE" ? `port ${port} is in use; try --port <n>` : String(err));
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

// Each handleXApi/handlePortalX function returns true once it has written a response, false if the
// URL/method didn't match so route() can try the next domain. route() itself only does URL parsing,
// the origin+token guard, dispatch in order, and the final 404 — no domain-specific logic here.
function route(req, res, handlers, mutationToken) {
  const [urlPath, qs = ""] = (req.url || "/").split("?");

  if (req.method === "POST" && !originAllowed(req)) {
    return send(res, 403, "application/json", JSON.stringify({ error: "cross-origin request rejected" }));
  }
  if (req.method === "POST" && !mutationTokenAllowed(req, mutationToken)) {
    return send(res, 403, "application/json", JSON.stringify({ error: "portal token required" }));
  }

  if (handleConfigApi(req, res, urlPath, qs, handlers)) return;
  if (handlePlansApi(req, res, urlPath, qs, handlers)) return;
  if (handlePortalPage(req, res, urlPath, mutationToken)) return;
  if (handlePortalAsset(req, res, urlPath)) return;
  if (handlePortalStatus(req, res, urlPath)) return;
  if (handleTelemetryApi(req, res, urlPath, qs, handlers)) return;
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
  servePortalAsset(urlPath, res);
  return true;
}

function handlePortalStatus(req, res, urlPath) {
  if (urlPath !== "/api/portal/status") return false;
  send(res, 200, "application/json", JSON.stringify({
    ok: true,
    pid: process.pid,
    appRoot: repoRoot,
    portalDir: PORTAL_DIR,
    pages: pageManifest(),
  }));
  return true;
}

function handleConfigApi(req, res, urlPath, qs, handlers) {
  const { loadConfig, loadConfigSource, mutatePackage, mutateSkill, mutateBehavior, mutateCommand } = handlers;

  // Mutations are POST-only, origin-checked, token-checked, and JSON-bodied (route() already ran
  // the origin+token guard). Each writes config then returns the fresh snapshot so the client
  // re-renders from one response.
  if (req.method === "POST" && (urlPath === "/api/config/packages" || urlPath === "/api/config/skills")) {
    readJsonBody(req, async (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      const { id, enabled } = body || {};
      if (typeof id !== "string" || typeof enabled !== "boolean") {
        return send(res, 400, "application/json", JSON.stringify({ error: "expected { id: string, enabled: boolean }" }));
      }
      const mutate = urlPath === "/api/config/packages" ? mutatePackage : mutateSkill;
      const result = await mutate(id, enabled); // mutatePackage is async (service components)
      const status = result.ok ? 200 : 400;
      send(res, status, "application/json", JSON.stringify({ ...result, config: loadConfig() }));
    });
    return true;
  }

  // Flat model: either a named behavior (by manifest id) or an arbitrary command (by token
  // array) moves to a bucket. "default" reverts to the manifest's own default for that item.
  // Global only — no profile, no scope; see permissions-render.mjs / config-mutate.mjs.
  if (req.method === "POST" && urlPath === "/api/config/permissions") {
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      const { behaviorId, tokens, bucket } = body || {};
      const validBucket = bucket === "default" || ["deny", "ask", "allow"].includes(bucket);
      if (!validBucket || (typeof behaviorId !== "string" && !Array.isArray(tokens))) {
        return send(res, 400, "application/json", JSON.stringify({
          error: "expected { behaviorId: string, bucket } or { tokens: string[], bucket } — bucket one of deny|ask|allow|default",
        }));
      }
      const result = typeof behaviorId === "string"
        ? mutateBehavior(behaviorId, bucket)
        : mutateCommand(tokens, bucket);
      const status = result.ok ? 200 : 400;
      send(res, status, "application/json", JSON.stringify({ ...result, config: loadConfig() }));
    });
    return true;
  }

  if (urlPath === "/api/config") {
    send(res, 200, "application/json", JSON.stringify(loadConfig()));
    return true;
  }
  if (urlPath === "/api/config/source") {
    // Read-only: returns the full source that defines a tool (skill/command/rules/hooks) for the
    // /config click-to-inspect popup. loadConfigSource whitelists kind+id against the catalog.
    const params = new URLSearchParams(qs);
    const result = loadConfigSource({
      kind: params.get("kind"),
      id: params.get("id"),
      harness: params.get("harness") || "claude",
    });
    send(res, result.ok ? 200 : 400, "application/json", JSON.stringify(result));
    return true;
  }
  return false;
}

function handlePlansApi(req, res, urlPath, qs, handlers) {
  const { loadPlans, loadPlanDocument, buildPlansPrompt, updatePlanSettings, refreshPlans } = handlers;

  if (urlPath === "/api/plans") {
    send(res, 200, "application/json", JSON.stringify(loadPlans()));
    return true;
  }
  if (urlPath === "/api/plans/document") {
    const params = new URLSearchParams(qs);
    try {
      send(res, 200, "application/json", JSON.stringify(loadPlanDocument({ key: params.get("key") })));
    } catch (err) {
      send(res, 400, "application/json", JSON.stringify({ error: String(err?.message || err) }));
    }
    return true;
  }
  if (req.method === "POST" && urlPath === "/api/plans/prompt") {
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      try {
        send(res, 200, "application/json", JSON.stringify(buildPlansPrompt(body || {})));
      } catch (error) {
        send(res, 400, "application/json", JSON.stringify({ error: String(error?.message || error) }));
      }
    });
    return true;
  }
  if (req.method === "POST" && urlPath === "/api/plans/settings") {
    readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      try {
        send(res, 200, "application/json", JSON.stringify(updatePlanSettings(body || {})));
      } catch (error) {
        send(res, 400, "application/json", JSON.stringify({ error: String(error?.message || error) }));
      }
    });
    return true;
  }
  if (req.method === "POST" && urlPath === "/api/plans/refresh") {
    send(res, 200, "application/json", JSON.stringify(refreshPlans()));
    return true;
  }
  return false;
}

function handleTelemetryApi(req, res, urlPath, qs, handlers) {
  const { loadAnalysis, loadSession, loadInsightsLlm } = handlers;

  if (urlPath === "/api/insights-llm") {
    // On-demand LLM synthesis of the deterministic facts. May take seconds (shells to claude -p).
    send(res, 200, "application/json", JSON.stringify(loadInsightsLlm()));
    return true;
  }
  if (urlPath === "/api/data") {
    // The client passes ?range=<ms> to scope the WHOLE report (every panel) to a trailing time
    // window, and an optional &end=<ms epoch> when panning to a fixed window rather than "latest".
    // ?harness=claude (or codex) scopes all panels to a single harness; omit for all harnesses.
    const params = new URLSearchParams(qs);
    const rangeMs = params.has("range") ? Number(params.get("range")) : null;
    const end = params.has("end") ? Number(params.get("end")) : null;
    const harness = params.get("harness") || null;
    const window = Number.isFinite(rangeMs) && rangeMs > 0 ? { rangeMs, end: Number.isFinite(end) ? end : null } : null;
    send(res, 200, "application/json", JSON.stringify(loadAnalysis(window, harness)));
    return true;
  }
  if (urlPath === "/api/session") {
    // Bridge a flagged event to its chat: locate the transcript by session id and surface the
    // heaviest turns + a ready-to-paste analysis prompt. loadSession owns the file I/O (telemetry.mjs)
    // so the server stays I/O-free, mirroring loadAnalysis.
    const params = new URLSearchParams(qs);
    const id = params.get("id");
    const harness = params.get("harness") || "claude";
    const finding = params.get("finding") || "abnormal token usage";
    const repo = params.get("repo") || null;
    if (!id) {
      send(res, 400, "application/json", JSON.stringify({ error: "missing id" }));
      return true;
    }
    send(res, 200, "application/json", JSON.stringify(loadSession({ id, harness, finding, repo })));
    return true;
  }
  return false;
}

function servePortalAsset(urlPath, res) {
  const relative = decodeURIComponent(urlPath.slice("/portal/".length));
  const assetPath = path.resolve(PORTAL_DIR, relative);
  if (!assetPath.startsWith(PORTAL_DIR + path.sep)) return send(res, 404, "text/plain", "not found");
  let content;
  try {
    content = fs.readFileSync(assetPath);
  } catch {
    return send(res, 404, "text/plain", "not found");
  }
  const type = STATIC_TYPES[path.extname(assetPath)] || "application/octet-stream";
  send(res, 200, type, content);
}

function readJsonBody(req, cb) {
  let raw = "";
  let tooBig = false;
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 64 * 1024) { tooBig = true; req.destroy(); } // local control payloads are tiny
  });
  req.on("end", () => {
    if (tooBig) return cb(null, new Error("body too large"));
    try { cb(raw ? JSON.parse(raw) : {}, null); } catch (err) { cb(null, err); }
  });
  req.on("error", (err) => cb(null, err));
}

function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

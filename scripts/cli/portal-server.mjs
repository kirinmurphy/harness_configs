import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { repoRoot } from "./paths.mjs";

// Tiny local-only portal server. Binds to loopback only so telemetry/config data never leaves the
// machine. Stdlib `http` keeps the install dependency-free, matching the rest of the CLI.
const LOOPBACK = "127.0.0.1";
const PORTAL_DIR = path.join(repoRoot, "scripts", "portal");
const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

// Single source of truth for portal HTML pages. To add a page: (1) add an entry here, (2) create
// scripts/portal/<dir>/{index.html,styles.css,app.js} linking /portal/shared/base.css + theme.js,
// (3) add the page to PORTAL_PAGES in scripts/portal/shared/theme.js so the nav includes it.
// Each page's HTML is just its index.html read from disk (mirrors static assets). `default: true`
// marks the page served at "/" (what `roborepo serve` opens).
export const PAGES = [
  { path: "/", id: "config", title: "Config", dir: "config", default: true },
  { path: "/telemetry", id: "telemetry", title: "Telemetry", dir: "telemetry" },
];
const PAGE_BY_PATH = new Map(PAGES.map((p) => [p.path, p]));
const pageHtml = (dir) => fs.readFileSync(path.join(PORTAL_DIR, dir, "index.html"), "utf8");

export function startPortalServer(handlers) {
  const { port } = handlers;
  const server = http.createServer((req, res) => {
    try {
      route(req, res, handlers);
    } catch (err) {
      send(res, 500, "application/json", JSON.stringify({ error: String(err?.message || err) }));
    }
  });
  server.listen(port, LOOPBACK, () => {
    if (process.env.ROBOREPO_PORTAL_READY_FILE) {
      try {
        const addr = server.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : port;
        fs.writeFileSync(process.env.ROBOREPO_PORTAL_READY_FILE, `ready:${actualPort}\n`);
      } catch {}
    }
    console.log(`roborepo portal:     http://${LOOPBACK}:${port}`);
    console.log(`telemetry dashboard: http://${LOOPBACK}:${port}/telemetry`);
    console.log("(Ctrl-C to stop)");
    handlers.onListening?.();
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && handlers.onPortInUse?.() === true) return;
    console.error(err.code === "EADDRINUSE" ? `port ${port} is in use; try --port <n>` : String(err));
    process.exit(1);
  });
  return server;
}

function route(req, res, handlers) {
  const { loadAnalysis, loadSession, loadInsightsLlm, loadConfig, loadConfigSource, mutatePackage, mutateSkill, mutateProfile } = handlers;
  const [urlPath, qs = ""] = (req.url || "/").split("?");

  // Mutations: local-only loopback server, so no auth — but still POST-only and JSON-bodied.
  // Each writes config then returns the fresh snapshot so the client re-renders from one response.
  if (req.method === "POST" && (urlPath === "/api/config/packages" || urlPath === "/api/config/skills")) {
    return readJsonBody(req, async (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      const { id, enabled } = body || {};
      if (typeof id !== "string" || typeof enabled !== "boolean") {
        return send(res, 400, "application/json", JSON.stringify({ error: "expected { id: string, enabled: boolean }" }));
      }
      const mutate = urlPath === "/api/config/packages" ? mutatePackage : mutateSkill;
      const result = await mutate(id, enabled); // mutatePackage is async (service components)
      const status = result.ok ? 200 : 400;
      return send(res, status, "application/json", JSON.stringify({ ...result, config: loadConfig() }));
    });
  }

  if (req.method === "POST" && urlPath === "/api/config/permissions") {
    return readJsonBody(req, (body, err) => {
      if (err) return send(res, 400, "application/json", JSON.stringify({ error: "invalid JSON body" }));
      const { profile, confirmedLooser, scope } = body || {};
      if (typeof profile !== "string") {
        return send(res, 400, "application/json", JSON.stringify({ error: "expected { profile: string, scope?: 'global'|'project', confirmedLooser?: boolean }" }));
      }
      const result = mutateProfile(profile, !!confirmedLooser, scope || "global");
      // needsConfirm is a soft rejection (looser profile, no confirm yet) — 409 so the client can
      // prompt then retry with confirmedLooser, distinct from a 400 validation error.
      const status = result.ok ? 200 : result.needsConfirm ? 409 : 400;
      return send(res, status, "application/json", JSON.stringify({ ...result, config: loadConfig() }));
    });
  }

  const page = PAGE_BY_PATH.get(urlPath);
  if (page) return send(res, 200, "text/html; charset=utf-8", pageHtml(page.dir));
  if (urlPath.startsWith("/portal/")) return servePortalAsset(urlPath, res);
  if (urlPath === "/api/config") {
    return send(res, 200, "application/json", JSON.stringify(loadConfig()));
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
    return send(res, result.ok ? 200 : 400, "application/json", JSON.stringify(result));
  }
  if (urlPath === "/api/insights-llm") {
    // On-demand LLM synthesis of the deterministic facts. May take seconds (shells to claude -p).
    return send(res, 200, "application/json", JSON.stringify(loadInsightsLlm()));
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
    return send(res, 200, "application/json", JSON.stringify(loadAnalysis(window, harness)));
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
    if (!id) return send(res, 400, "application/json", JSON.stringify({ error: "missing id" }));
    return send(res, 200, "application/json", JSON.stringify(loadSession({ id, harness, finding, repo })));
  }
  send(res, 404, "text/plain", "not found");
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

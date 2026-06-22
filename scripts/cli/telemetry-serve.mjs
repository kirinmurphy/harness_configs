import http from "node:http";
import { dashboardHtml } from "./telemetry-dashboard.mjs";
import { configHtml } from "./config-dashboard.mjs";

// Tiny local-only dashboard server. Binds to loopback only — telemetry never leaves the machine.
// Routes: the static HTML shells and JSON analysis/config endpoints the pages poll. Stdlib `http`
// keeps the install dependency-free, matching the rest of the CLI.
const LOOPBACK = "127.0.0.1";

export function startTelemetryServer(handlers) {
  const { port } = handlers;
  const server = http.createServer((req, res) => {
    try {
      route(req, res, handlers);
    } catch (err) {
      send(res, 500, "application/json", JSON.stringify({ error: String(err?.message || err) }));
    }
  });
  server.listen(port, LOOPBACK, () => {
    console.log(`telemetry dashboard: http://${LOOPBACK}:${port}`);
    console.log(`config dashboard:    http://${LOOPBACK}:${port}/config`);
    console.log("(Ctrl-C to stop)");
  });
  server.on("error", (err) => {
    console.error(err.code === "EADDRINUSE" ? `port ${port} is in use; try --port <n>` : String(err));
    process.exit(1);
  });
  return server;
}

function route(req, res, handlers) {
  const { loadAnalysis, loadSession, loadInsightsLlm, loadConfig, mutatePackage, mutateSkill, mutateProfile } = handlers;
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

  if (urlPath === "/") return send(res, 200, "text/html; charset=utf-8", dashboardHtml());
  if (urlPath === "/config") return send(res, 200, "text/html; charset=utf-8", configHtml());
  if (urlPath === "/api/config") {
    return send(res, 200, "application/json", JSON.stringify(loadConfig()));
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

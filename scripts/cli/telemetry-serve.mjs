import http from "node:http";
import { dashboardHtml } from "./telemetry-dashboard.mjs";

// Tiny local-only dashboard server. Binds to loopback only — telemetry never leaves the machine.
// Two routes: the static HTML shell and a JSON analysis endpoint the page polls. Stdlib `http`
// keeps the install dependency-free, matching the rest of the CLI.
const LOOPBACK = "127.0.0.1";

export function startTelemetryServer({ port, loadAnalysis, loadSession }) {
  const server = http.createServer((req, res) => {
    try {
      route(req, res, loadAnalysis, loadSession);
    } catch (err) {
      send(res, 500, "application/json", JSON.stringify({ error: String(err?.message || err) }));
    }
  });
  server.listen(port, LOOPBACK, () => {
    console.log(`telemetry dashboard: http://${LOOPBACK}:${port}  (Ctrl-C to stop)`);
  });
  server.on("error", (err) => {
    console.error(err.code === "EADDRINUSE" ? `port ${port} is in use; try --port <n>` : String(err));
    process.exit(1);
  });
  return server;
}

function route(req, res, loadAnalysis, loadSession) {
  const [path, qs = ""] = (req.url || "/").split("?");
  if (path === "/") return send(res, 200, "text/html; charset=utf-8", dashboardHtml());
  if (path === "/api/data") {
    // The client passes ?range=<ms> to scope the WHOLE report (every panel) to a trailing time
    // window, and an optional &end=<ms epoch> when panning to a fixed window rather than "latest".
    const params = new URLSearchParams(qs);
    const rangeMs = params.has("range") ? Number(params.get("range")) : null;
    const end = params.has("end") ? Number(params.get("end")) : null;
    const window = Number.isFinite(rangeMs) && rangeMs > 0 ? { rangeMs, end: Number.isFinite(end) ? end : null } : null;
    return send(res, 200, "application/json", JSON.stringify(loadAnalysis(window)));
  }
  if (path === "/api/session") {
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

function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

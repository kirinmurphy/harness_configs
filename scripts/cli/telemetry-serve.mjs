import http from "node:http";
import { dashboardHtml } from "./telemetry-dashboard.mjs";

// Tiny local-only dashboard server. Binds to loopback only — telemetry never leaves the machine.
// Two routes: the static HTML shell and a JSON analysis endpoint the page polls. Stdlib `http`
// keeps the install dependency-free, matching the rest of the CLI.
const LOOPBACK = "127.0.0.1";

export function startTelemetryServer({ port, loadAnalysis }) {
  const server = http.createServer((req, res) => {
    try {
      route(req, res, loadAnalysis);
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

function route(req, res, loadAnalysis) {
  const url = (req.url || "/").split("?")[0];
  if (url === "/") return send(res, 200, "text/html; charset=utf-8", dashboardHtml());
  if (url === "/api/data") return send(res, 200, "application/json", JSON.stringify(loadAnalysis()));
  send(res, 404, "text/plain", "not found");
}

function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

// Tiny HTTP helpers shared by every portal-routes-*.mjs handler: uniform JSON/text response
// writing and body-reading. No page-specific logic lives here.

export function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

export function readJsonBody(req, cb) {
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

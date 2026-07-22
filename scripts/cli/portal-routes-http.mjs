// Tiny HTTP helpers shared by every portal-routes-*.mjs handler: uniform JSON/text response
// writing and body-reading. No page-specific logic lives here.

// Default: no-store, correct for the token-bearing HTML pages and the live API JSON. Static-asset
// handlers pass `headers` to override (ETag + no-cache) so browsers can revalidate CSS/JS with a
// cheap 304 instead of re-downloading on every page nav.
export function send(res, status, type, body, headers) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    ...headers,
  });
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

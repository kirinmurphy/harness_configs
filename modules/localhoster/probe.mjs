import http from "node:http";
import https from "node:https";

const DEFAULT_TIMEOUT_MS = 800;
export const MAX_BODY_BYTES = 64 * 1024;

export async function probeHttpCandidate(candidate, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const first = await probeOrigin(candidate.origin, { timeoutMs });
  if (first.http || !looksLikeTlsError(first.errorCode, first.errorMessage)) return first;
  const httpsOrigin = candidate.origin.replace(/^http:/, "https:");
  return probeOrigin(httpsOrigin, { timeoutMs, protocol: "https" });
}

// Shared low-level fetch for anything that needs a capped, timed-out, cookie-free GET against a
// loopback URL — probeOrigin below and modules/localhoster/metadata.mjs's manifest/robots/sitemap/
// OpenAPI reads both build on this rather than re-implementing the timeout/body-cap/redirect-safety
// trio. Never attaches cookies or auth headers; Node's http/https client only sends what is set
// explicitly on `headers`, so omitting them here is the whole guarantee.
export function fetchLoopbackText(url, { timeoutMs = DEFAULT_TIMEOUT_MS, maxBodyBytes = MAX_BODY_BYTES, accept = "*/*" } = {}) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, status: null, body: null, contentType: null, error: "invalid URL" });
      return;
    }
    if (!isLoopbackUrl(parsed.href)) {
      resolve({ ok: false, status: null, body: null, contentType: null, error: "non-loopback host" });
      return;
    }
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: "GET",
      timeout: timeoutMs,
      headers: { "User-Agent": "roborepo-localhoster", Accept: accept },
    }, (res) => {
      const status = res.statusCode || null;
      const location = res.headers.location ? safeRedirect(parsed.href, res.headers.location) : null;
      // Redirects are reported, never followed — a follow could leave the loopback origin this
      // fetch was scoped to, and the caller (metadata.mjs) has no use for a redirected document's
      // body anyway; it only needs to know a source declared itself present.
      if (location) {
        res.resume();
        resolve({ ok: false, status, body: null, contentType: null, redirect: location, redirectExternal: !isLoopbackUrl(location) });
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (body.length < maxBodyBytes) body += chunk.slice(0, maxBodyBytes - body.length);
      });
      res.on("end", () => {
        resolve({ ok: status != null && status >= 200 && status < 300, status, body, contentType: res.headers["content-type"] || null });
      });
    });
    req.on("timeout", () => {
      req.destroy(Object.assign(new Error("fetch timeout"), { code: "TIMEOUT" }));
    });
    req.on("error", (err) => {
      resolve({ ok: false, status: null, body: null, contentType: null, error: err.message || String(err) });
    });
    req.end();
  });
}

export async function probeHttpCandidates(candidates, options = {}) {
  const concurrency = options.concurrency || 8;
  const results = [];
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= candidates.length) return;
      results[index] = await probeHttpCandidate(candidates[index], options);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  return results;
}

async function probeOrigin(origin, { timeoutMs, protocol } = {}) {
  const url = new URL(origin);
  const client = url.protocol === "https:" ? https : http;
  const started = Date.now();

  return new Promise((resolve) => {
    const req = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      timeout: timeoutMs,
      headers: { "User-Agent": "roborepo-localhoster", Accept: "text/html,*/*;q=0.1" },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (body.length < MAX_BODY_BYTES) body += chunk.slice(0, MAX_BODY_BYTES - body.length);
      });
      res.on("end", () => {
        const location = res.headers.location ? safeRedirect(origin, res.headers.location) : null;
        resolve({
          http: true,
          status: res.statusCode || null,
          latencyMs: Date.now() - started,
          protocol: protocol || url.protocol.replace(":", ""),
          title: titleFromHtml(body),
          favicon: faviconFromHtml(origin, body),
          redirect: location,
          redirectExternal: location ? !isLoopbackUrl(location) : false,
        });
      });
    });
    req.on("timeout", () => {
      req.destroy(Object.assign(new Error("probe timeout"), { code: "TIMEOUT" }));
    });
    req.on("error", (err) => {
      resolve({
        http: isTlsTrustError(err),
        status: null,
        latencyMs: Date.now() - started,
        protocol: protocol || url.protocol.replace(":", ""),
        title: null,
        favicon: null,
        tls: isTlsTrustError(err) ? "untrusted" : null,
        errorCode: err.code || null,
        errorMessage: err.message || String(err),
      });
    });
    req.end();
  });
}

function titleFromHtml(body) {
  const match = String(body || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1].replace(/\s+/g, " ").trim()).slice(0, 120) : null;
}

function faviconFromHtml(origin, body) {
  const match = String(body || "").match(/<link[^>]+rel=["'][^"']*(?:icon|shortcut icon)[^"']*["'][^>]*>/i);
  if (!match) return null;
  const href = match[0].match(/\shref=["']([^"']+)["']/i)?.[1];
  if (!href) return null;
  try {
    const url = new URL(href, origin);
    return isLoopbackUrl(url.href) ? url.href : null;
  } catch {
    return null;
  }
}

function safeRedirect(origin, location) {
  try {
    return new URL(location, origin).href;
  } catch {
    return null;
  }
}

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function looksLikeTlsError(code, message) {
  return /SSL|TLS|wrong version number|EPROTO|HTTPS/i.test(`${code || ""} ${message || ""}`);
}

function isTlsTrustError(err) {
  return isTlsTrustErrorCode(err.code);
}

export function isTlsTrustErrorCode(code) {
  return ["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(code);
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

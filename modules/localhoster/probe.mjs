import http from "node:http";
import https from "node:https";

const DEFAULT_TIMEOUT_MS = 800;
const MAX_BODY_BYTES = 64 * 1024;

export async function probeHttpCandidate(candidate, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const first = await probeOrigin(candidate.origin, { timeoutMs });
  if (first.http || !looksLikeTlsError(first.errorCode, first.errorMessage)) return first;
  const httpsOrigin = candidate.origin.replace(/^http:/, "https:");
  return probeOrigin(httpsOrigin, { timeoutMs, protocol: "https" });
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
  return ["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(err.code);
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

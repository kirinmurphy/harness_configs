#!/usr/bin/env node
// Metadata suggestion discovery: manifest/robots/sitemap/OpenAPI parsing, dedup, auth-path
// filtering, and the safety guards (loopback-only, no redirects followed, body cap). fetchText is
// stubbed per test so nothing here opens a real socket.
import assert from "node:assert/strict";
import http from "node:http";
import { discoverMetadataSuggestions, fetchLoopbackText, findCurrentInstanceByOpaqueKey } from "../../modules/localhoster/index.mjs";

function stubFetch(byUrl) {
  return async (url) => byUrl[url] || { ok: false, status: 404, body: null, contentType: null };
}

try {
  // ---- Manifest ----
  {
    const suggestions = await discoverMetadataSuggestions("http://localhost:5173", {
      fetchText: stubFetch({
        "http://localhost:5173/manifest.json": { ok: true, status: 200, body: JSON.stringify({ name: "My App", start_url: "/app" }) },
      }),
    });
    assert.deepEqual(suggestions, [{ path: "/app", label: "My App", source: "manifest" }]);
  }
  console.log("ok  manifest parsing");

  // ---- Robots + sitemap ----
  {
    const suggestions = await discoverMetadataSuggestions("http://localhost:5173", {
      fetchText: stubFetch({
        "http://localhost:5173/robots.txt": { ok: true, status: 200, body: "User-agent: *\nSitemap: http://localhost:5173/custom-sitemap.xml\n" },
        "http://localhost:5173/custom-sitemap.xml": {
          ok: true,
          status: 200,
          body: "<urlset><url><loc>http://localhost:5173/resume</loc></url><url><loc>http://localhost:5173/about</loc></url></urlset>",
        },
        "http://localhost:5173/sitemap.xml": { ok: false, status: 404, body: null },
      }),
    });
    assert.deepEqual(suggestions.map((s) => s.path).sort(), ["/about", "/resume"]);
    assert.ok(suggestions.every((s) => s.source === "robots"));
  }
  console.log("ok  robots Sitemap: parsing");

  // ---- Conventional /sitemap.xml fallback ----
  {
    const suggestions = await discoverMetadataSuggestions("http://localhost:5173", {
      fetchText: stubFetch({
        "http://localhost:5173/sitemap.xml": { ok: true, status: 200, body: "<urlset><url><loc>http://localhost:5173/blog</loc></url></urlset>" },
      }),
    });
    assert.deepEqual(suggestions, [{ path: "/blog", label: null, source: "sitemap" }]);
  }
  console.log("ok  conventional /sitemap.xml fallback");

  // ---- OpenAPI ----
  {
    const suggestions = await discoverMetadataSuggestions("http://localhost:5173", {
      openApiUrl: "http://localhost:5173/openapi.json",
      fetchText: stubFetch({
        "http://localhost:5173/openapi.json": {
          ok: true,
          status: 200,
          body: JSON.stringify({ paths: { "/api/users": {}, "/api/admin/reset": {} } }),
        },
      }),
    });
    assert.deepEqual(suggestions.map((s) => s.path).sort(), ["/api/admin/reset", "/api/users"]);
    assert.ok(suggestions.every((s) => s.source === "openapi"), "OpenAPI evidence overrides the auth-looking filter");
  }
  console.log("ok  OpenAPI path extraction");

  // ---- Cross-source duplicate-path dedup, highest-confidence source wins ----
  {
    const suggestions = await discoverMetadataSuggestions("http://localhost:5173", {
      openApiUrl: "http://localhost:5173/openapi.json",
      fetchText: stubFetch({
        "http://localhost:5173/manifest.json": { ok: true, status: 200, body: JSON.stringify({ start_url: "/dashboard" }) },
        "http://localhost:5173/openapi.json": { ok: true, status: 200, body: JSON.stringify({ paths: { "/dashboard": {} } }) },
      }),
    });
    assert.deepEqual(suggestions, [{ path: "/dashboard", label: null, source: "openapi" }]);
  }
  console.log("ok  cross-source duplicate-path dedup");

  // ---- Unsafe/cross-origin URL rejection ----
  {
    const suggestions = await discoverMetadataSuggestions("http://localhost:5173", {
      fetchText: stubFetch({
        "http://localhost:5173/sitemap.xml": {
          ok: true,
          status: 200,
          body: "<urlset><url><loc>https://evil.example.com/steal</loc></url><url><loc>http://localhost:5173/safe</loc></url></urlset>",
        },
      }),
    });
    assert.deepEqual(suggestions, [{ path: "/safe", label: null, source: "sitemap" }]);
  }
  console.log("ok  unsafe/cross-origin URL rejection");

  // ---- Same-loopback-different-port rejection: a sitemap naming another local app's port must not
  // silently collapse into a bare path this app's origin then gets credited with. ----
  {
    const suggestions = await discoverMetadataSuggestions("http://localhost:5173", {
      fetchText: stubFetch({
        "http://localhost:5173/sitemap.xml": {
          ok: true,
          status: 200,
          body: "<urlset><url><loc>http://localhost:9999/other-apps-route</loc></url><url><loc>http://localhost:5173/mine</loc></url></urlset>",
        },
      }),
    });
    assert.deepEqual(suggestions, [{ path: "/mine", label: null, source: "sitemap" }]);
  }
  console.log("ok  same-loopback-different-port URL rejection");

  // ---- Credential-bearing URL rejection ----
  {
    const suggestions = await discoverMetadataSuggestions("http://localhost:5173", {
      fetchText: stubFetch({
        "http://localhost:5173/sitemap.xml": {
          ok: true,
          status: 200,
          body: "<urlset><url><loc>http://user:pass@localhost:5173/hidden</loc></url></urlset>",
        },
      }),
    });
    assert.deepEqual(suggestions, []);
  }
  console.log("ok  credential-bearing URL rejection");

  // ---- Authenticated-looking route filtering, and its OpenAPI/sitemap-evidence override ----
  {
    const manifestOnly = await discoverMetadataSuggestions("http://localhost:5173", {
      fetchText: stubFetch({
        "http://localhost:5173/manifest.json": { ok: true, status: 200, body: JSON.stringify({ start_url: "/admin/panel" }) },
      }),
    });
    assert.deepEqual(manifestOnly, [], "manifest-only evidence does not override the auth-looking filter");

    const sitemapEvidence = await discoverMetadataSuggestions("http://localhost:5173", {
      fetchText: stubFetch({
        "http://localhost:5173/sitemap.xml": { ok: true, status: 200, body: "<urlset><url><loc>http://localhost:5173/admin/panel</loc></url></urlset>" },
      }),
    });
    assert.deepEqual(sitemapEvidence, [{ path: "/admin/panel", label: null, source: "sitemap" }]);
  }
  console.log("ok  authenticated-looking route filtering with evidence override");

  // ---- Malformed sources never throw ----
  {
    const suggestions = await discoverMetadataSuggestions("http://localhost:5173", {
      fetchText: stubFetch({
        "http://localhost:5173/manifest.json": { ok: true, status: 200, body: "not json" },
        "http://localhost:5173/robots.txt": { ok: true, status: 200, body: "not a robots file at all" },
      }),
    });
    assert.deepEqual(suggestions, []);
  }
  console.log("ok  malformed sources produce no suggestions instead of throwing");

  // ---- fetchLoopbackText: real socket, external redirect reported not followed, body cap, timeout ----
  {
    const server = http.createServer((req, res) => {
      if (req.url === "/external-redirect") {
        res.writeHead(302, { Location: "https://example.com/out" });
        res.end();
        return;
      }
      if (req.url === "/huge") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("x".repeat(70 * 1024));
        return;
      }
      if (req.url === "/slow") return; // never responds, exercises the timeout path
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = server.address().port;
      const plain = await fetchLoopbackText(`http://127.0.0.1:${port}/data`);
      assert.equal(plain.ok, true);
      assert.equal(plain.status, 200);
      assert.equal(JSON.parse(plain.body).ok, true);

      const redirected = await fetchLoopbackText(`http://127.0.0.1:${port}/external-redirect`);
      assert.equal(redirected.ok, false);
      assert.equal(redirected.redirectExternal, true, "external redirect is reported, not followed");

      const huge = await fetchLoopbackText(`http://127.0.0.1:${port}/huge`, { maxBodyBytes: 1024 });
      assert.equal(huge.body.length, 1024, "body is capped, not buffered in full");

      const timedOut = await fetchLoopbackText(`http://127.0.0.1:${port}/slow`, { timeoutMs: 50 });
      assert.equal(timedOut.ok, false);

      const nonLoopback = await fetchLoopbackText("http://example.com/data");
      assert.equal(nonLoopback.ok, false);
      assert.equal(nonLoopback.error, "non-loopback host");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log("ok  fetchLoopbackText guards: external redirect, body cap, timeout, non-loopback rejection");

  // ---- Invalid/expired opaque keys resolve to no instance ----
  // loadLocalhosterMetadata (scripts/cli/localhoster.mjs) turns this into the route's 404; that
  // wiring is exercised through the singleton snapshot cache and isn't hermetic to unit-test here
  // (see localhoster-check.mjs, which tests this same resolver directly rather than through the CLI
  // singleton).
  {
    assert.equal(findCurrentInstanceByOpaqueKey({ projects: [], unmatchedInstances: [] }, "lk_missing"), null);
  }
  console.log("ok  invalid opaque key resolves to no instance");
} finally {
  // no shared temp state to clean up — every fixture above is either an in-memory stub or a
  // self-closing http.createServer.
}

console.log("ok: localhoster metadata");

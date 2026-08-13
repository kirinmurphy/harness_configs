#!/usr/bin/env node
// Metadata suggestion discovery: manifest/robots/sitemap/OpenAPI parsing, dedup, auth-path
// filtering, and the safety guards (loopback-only, no redirects followed, body cap). fetchText is
// stubbed per test so nothing here opens a real socket.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { discoverMetadataSuggestions, fetchLoopbackText, findCurrentInstanceByOpaqueKey, probeHttpCandidates } from "../../modules/localhoster/index.mjs";
// mergeSavedLinks is pure and DOM-free, but it lives in a portal module whose sibling imports use
// browser-absolute paths ("/portal/shared/api.js") that node cannot resolve. Rather than move
// rendering logic out of the view or stand up a DOM, read the source and evaluate just that one
// exported function. It is self-contained — no imports, no globals — so this stays honest: the
// assertions below run the same code the browser does, byte for byte.
const mergeSavedLinks = await loadMergeSavedLinks();

async function loadMergeSavedLinks() {
  const source = await fs.readFile(
    new URL("../../portal/localhoster/suggestions-view.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export function mergeSavedLinks");
  assert.ok(start !== -1, "mergeSavedLinks not found in suggestions-view.js");
  // Ends at the next top-level declaration; the function body's own closing brace is indented.
  const end = source.indexOf("\n}\n", start) + 3;
  const body = source.slice(start, end).replace("export function", "function");
  return (0, eval)(`${body}; mergeSavedLinks`);
}

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
    assert.deepEqual(suggestions, [{ path: "/app", label: "My App", source: "manifest", kind: "page" }]);
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
    assert.deepEqual(suggestions, [{ path: "/blog", label: null, source: "sitemap", kind: "page" }]);
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
          body: JSON.stringify({ paths: { "/api/users": { get: {} }, "/api/admin/reset": { post: {} } } }),
        },
      }),
    });
    assert.deepEqual(suggestions.map((s) => s.path).sort(), ["/api/admin/reset", "/api/users"]);
    assert.ok(suggestions.every((s) => s.source === "openapi"), "OpenAPI evidence overrides the auth-looking filter");
    assert.ok(suggestions.every((s) => s.kind === "api"), "OpenAPI operations are api-kind, not navigable pages");
  }
  console.log("ok  OpenAPI path extraction");

  // ---- One suggestion per (path, method): several verbs on one path are distinct operations with
  // distinct contracts, and keying dedup on path alone would keep only the first. ----
  {
    const suggestions = await discoverMetadataSuggestions("http://localhost:5173", {
      openApiUrl: "http://localhost:5173/openapi.json",
      fetchText: stubFetch({
        "http://localhost:5173/openapi.json": {
          ok: true,
          status: 200,
          body: JSON.stringify({
            paths: {
              "/api/items": {
                get: { summary: "List items" },
                post: { summary: "Create an item" },
                // Not an operation — a sibling of the verbs. Must not become "SUMMARY /api/items".
                summary: "Items collection",
              },
            },
          }),
        },
      }),
    });
    assert.deepEqual(
      suggestions.map((s) => `${s.method} ${s.path}`).sort(),
      ["GET /api/items", "POST /api/items"],
    );
    assert.equal(suggestions.find((s) => s.method === "POST").summary, "Create an item");
  }
  console.log("ok  one suggestion per (path, method), non-verb path-item keys ignored");

  // ---- Operation contract capture: params (path-level merged into each operation), $ref
  // resolution, and request-body field names. ----
  {
    const suggestions = await discoverMetadataSuggestions("http://localhost:5173", {
      openApiUrl: "http://localhost:5173/openapi.json",
      fetchText: stubFetch({
        "http://localhost:5173/openapi.json": {
          ok: true,
          status: 200,
          body: JSON.stringify({
            paths: {
              "/api/plans/{key}": {
                parameters: [{ name: "key", in: "path", schema: { type: "string" } }],
                get: {
                  summary: "Fetch a plan",
                  parameters: [{ $ref: "#/components/parameters/Mode" }],
                },
                post: {
                  requestBody: {
                    required: true,
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          required: ["label"],
                          properties: { label: { type: "string" }, port: { type: "integer", default: 3000 } },
                        },
                      },
                    },
                  },
                },
              },
            },
            components: {
              parameters: {
                Mode: { name: "mode", in: "query", schema: { type: "string", enum: ["portable", "repository-aware"] } },
              },
            },
          }),
        },
      }),
    });
    const get = suggestions.find((s) => s.method === "GET");
    // Path-level parameter merged in, and marked required even though the spec never said so.
    const key = get.parameters.find((p) => p.name === "key");
    assert.equal(key.in, "path");
    assert.equal(key.required, true, "path parameters are required by definition");
    assert.equal(key.example, null, "no example in the spec means no invented value");
    // $ref resolved out of components, with the enum's first member as the suggested value.
    const mode = get.parameters.find((p) => p.name === "mode");
    assert.equal(mode.in, "query");
    assert.equal(mode.example, "portable", "enum first member is the suggested value");

    const post = suggestions.find((s) => s.method === "POST");
    assert.equal(post.requestBody.mediaType, "application/json");
    assert.equal(post.requestBody.required, true);
    assert.deepEqual(post.requestBody.fields.map((f) => f.name).sort(), ["label", "port"]);
    assert.equal(post.requestBody.fields.find((f) => f.name === "label").required, true);
    assert.equal(post.requestBody.fields.find((f) => f.name === "port").example, "3000", "schema default is a usable value");
  }
  console.log("ok  OpenAPI operation contract capture: params, $ref resolution, request body");

  // ---- A self-referencing $ref is legal OpenAPI and must not spin forever. ----
  {
    const suggestions = await discoverMetadataSuggestions("http://localhost:5173", {
      openApiUrl: "http://localhost:5173/openapi.json",
      fetchText: stubFetch({
        "http://localhost:5173/openapi.json": {
          ok: true,
          status: 200,
          body: JSON.stringify({
            paths: { "/api/loop": { get: { parameters: [{ $ref: "#/components/parameters/Cycle" }] } } },
            components: { parameters: { Cycle: { $ref: "#/components/parameters/Cycle" } } },
          }),
        },
      }),
    });
    assert.equal(suggestions.length, 1, "a $ref cycle terminates instead of hanging");
    assert.deepEqual(suggestions[0].parameters, [], "an unresolvable cyclic parameter is dropped");
  }
  console.log("ok  cyclic $ref terminates");

  // ---- Conventional OpenAPI path guessing: no openApiUrl override supplied ----
  {
    const suggestions = await discoverMetadataSuggestions("http://localhost:5173", {
      fetchText: stubFetch({
        // openapi.json and openapi.yaml (tried first) are absent; swagger.json is the first hit.
        "http://localhost:5173/swagger.json": { ok: true, status: 200, body: JSON.stringify({ paths: { "/api/orders": { get: {} } } }) },
      }),
    });
    assert.deepEqual(suggestions.map((s) => s.path), ["/api/orders"]);
    assert.equal(suggestions[0].source, "openapi");
  }
  console.log("ok  conventional OpenAPI path guessing, no override needed");

  // ---- A 200 response that isn't a real OpenAPI document (dev-server catch-all) is skipped, not
  // treated as a hit — guessing must not stop at the first 200, only the first valid document. ----
  {
    const suggestions = await discoverMetadataSuggestions("http://localhost:5173", {
      fetchText: stubFetch({
        "http://localhost:5173/openapi.json": { ok: true, status: 200, body: "<!doctype html><title>App</title>" },
        "http://localhost:5173/openapi.yaml": { ok: true, status: 200, body: "<!doctype html><title>App</title>" },
        "http://localhost:5173/swagger.json": { ok: true, status: 200, body: "<!doctype html><title>App</title>" },
        "http://localhost:5173/v3/api-docs": { ok: true, status: 200, body: JSON.stringify({ paths: { "/real": { get: {} } } }) },
      }),
    });
    assert.deepEqual(suggestions.map((s) => s.path), ["/real"]);
    assert.equal(suggestions[0].source, "openapi");
  }
  console.log("ok  catch-all 200 responses are skipped, not treated as a valid OpenAPI hit");

  // ---- Cross-source duplicate-path dedup, highest-confidence source wins ----
  {
    const suggestions = await discoverMetadataSuggestions("http://localhost:5173", {
      openApiUrl: "http://localhost:5173/openapi.json",
      fetchText: stubFetch({
        "http://localhost:5173/manifest.json": { ok: true, status: 200, body: JSON.stringify({ start_url: "/dashboard" }) },
        "http://localhost:5173/openapi.json": { ok: true, status: 200, body: JSON.stringify({ paths: { "/dashboard": { get: {} } } }) },
      }),
    });
    assert.deepEqual(suggestions.map((s) => s.path), ["/dashboard"]);
    assert.equal(suggestions[0].source, "openapi", "highest-confidence source wins the path");
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
    assert.deepEqual(suggestions, [{ path: "/safe", label: null, source: "sitemap", kind: "page" }]);
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
    assert.deepEqual(suggestions, [{ path: "/mine", label: null, source: "sitemap", kind: "page" }]);
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
    assert.deepEqual(sitemapEvidence, [{ path: "/admin/panel", label: null, source: "sitemap", kind: "page" }]);
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

  // ---- IPv6-only listeners are reachable ----
  // URL.hostname keeps an IPv6 literal's brackets; http.request's `hostname` option does not want
  // them and goes to DNS instead, failing ENOTFOUND. Every IPv6-only listener was therefore probed
  // as dead and dropped from the snapshot — an Astro dev server on [::1]:4321 disappeared while the
  // same process's wildcard HMR port survived. Uses a real server on ::1 because the bug was
  // exactly in how a live socket gets addressed.
  {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><head><title>v6 app</title></head><body>ok</body></html>");
    });
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "::1", resolve);
      });
      const { port } = server.address();
      const [viaV6] = await probeHttpCandidates([
        { protocol: "http", host: "::1", port, origin: `http://[::1]:${port}` },
      ]);
      assert.equal(viaV6.http, true, "IPv6 literal origin must be probed, not sent to DNS");
      assert.equal(viaV6.status, 200);
      assert.equal(viaV6.title, "v6 app");
    } catch (err) {
      // A machine with IPv6 loopback disabled cannot host this fixture; skip rather than fail on an
      // environment difference the code under test has no say in.
      if (err?.code !== "EADDRNOTAVAIL") throw err;
      console.log("skip  IPv6 loopback unavailable on this host");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log("ok  IPv6-only listeners are probed rather than dropped");

  // ---- Saved-link merge (portal/localhoster/suggestions-view.js) ----
  // Saving a route must not rewrite where it came from, and a saved API path must not appear both
  // as a Page and under API Routes. Both were real regressions: /tokens came from the sitemap but
  // rendered as "User Added", and a saved /api path listed twice.
  {
    const pagesIn = [
      { path: "/tokens", source: "sitemap", kind: "page" },
      { path: "/plans", source: "sitemap", kind: "page" },
    ];
    const apisIn = [
      { path: "/api/plans", source: "openapi", kind: "api", method: "GET" },
      { path: "/api/plans", source: "openapi", kind: "api", method: "DELETE" },
    ];
    const links = [
      { id: "l1", path: "/tokens", label: "Design Tokens" },
      { id: "l2", path: "/api/plans", label: "Plans API" },
      { id: "l3", path: "/scratch", label: "My Scratch Page" },
    ];
    const { pages, apis } = mergeSavedLinks(pagesIn, apisIn, links);

    // A saved sitemap route keeps source "sitemap" — NOT "user" — and gains the saved marker,
    // the user's label, and the link id the edit/delete actions need.
    const tokens = pages.find((p) => p.path === "/tokens");
    assert.equal(tokens.source, "sitemap");
    assert.equal(tokens.saved, true);
    assert.equal(tokens.label, "Design Tokens");
    assert.equal(tokens.linkId, "l1");

    // An undiscovered saved path is the only genuine "User Added" row, and leads the list.
    assert.equal(pages[0].path, "/scratch");
    assert.equal(pages[0].source, "user");

    // The saved API path renders under API Routes only, never duplicated into Pages.
    assert.equal(pages.some((p) => p.path === "/api/plans"), false);
    assert.equal(apis.find((a) => a.method === "GET").saved, true);
    // One link records a path, not a method, so the sibling DELETE stays unmarked.
    assert.equal(apis.find((a) => a.method === "DELETE").saved, undefined);

    // An unsaved discovered route is untouched.
    assert.equal(pages.find((p) => p.path === "/plans").saved, undefined);
  }
  console.log("ok  saved links merge without overwriting a route's discovered source");
} finally {
  // no shared temp state to clean up — every fixture above is either an in-memory stub or a
  // self-closing http.createServer.
}

console.log("ok: localhoster metadata");

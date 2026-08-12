# Portal Architecture

## Purpose

The portal is the local `roborepo web` UI: Config (`/`, alias `/config`), Plans (`/plans`),
Localhoster (`/localhoster`), and Tokens (`/tokens`). It is static HTML/CSS/browser JavaScript
served by a loopback-only Node HTTP server — no build step, no framework, no bundler. This doc
covers the shared architecture (page manifest, browser API helpers, server route dispatch) that
every page relies on. Page-specific behavior lives in
`docs/user/reference/config-control-panel.md` and `docs/user/reference/plans-portal.md`.

## Directory Layout

```
portal/
  shared/
    base.css     — shared palette + chrome styles
    theme.js     — header/footer/nav/theme-toggle, reads window.ROBOREPO_PORTAL
    api.js       — shared fetch/token/clipboard/DOM helpers (ES module)
  config/{index.html,styles.css,app.js}
  plans/{index.html,styles.css,app.js}
  localhoster/{index.html,styles.css,app.js,api.js,state.js,templates.js}
  telemetry/{index.html,styles.css,app.js}
scripts/cli/portal-server.mjs   — the server: page manifest, route dispatch, static assets
scripts/cli/portal-router.mjs   — the route table matcher every domain file builds on
scripts/cli/portal-routes-metadata.mjs — /manifest.json, /sitemap.xml, /robots.txt (generated from PAGES)
```

Every page's `index.html` links `/portal/shared/base.css` and loads `theme.js` and its own
`app.js` as `<script type="module">` (module scripts defer by default, so no separate `defer`
attribute is needed).

## How the Manifest Reaches the Browser

`PAGES` in `scripts/cli/portal-server.mjs` is the single source of truth for page metadata
(`id`, `path`, `title`, `dir`, optional `default`). There is no browser-side copy to hand-sync:

1. `pageManifest()` derives the browser-safe `{ path, id, title }` shape from `PAGES`.
2. `pageHtml()` injects `window.ROBOREPO_PORTAL = { token, pages: [...] }` into every served
   page's `<head>`, right beside the existing `<meta name="roborepo-portal-token">` tag.
3. `/api/portal/status` returns the same `pageManifest()` shape, so the terminal-facing status
   check and the browser nav can never drift.
4. `portal/shared/theme.js` reads `window.ROBOREPO_PORTAL.pages` to render the nav and mark the
   active link. If the global is missing (e.g. a page opened directly as a file, or a broken
   injection), `theme.js` throws `"portal manifest missing"` immediately instead of silently
   rendering an empty nav.
5. `theme.js` also injects a full-page loading overlay (`#page-loading`) alongside the header and
   footer. Each page hides it (via `portalHideLoading()`) once its own first data fetch resolves;
   it is not shown again on later polls. Page-specific status/metadata (plan counts, telemetry
   stats, etc.) is ordinary in-page markup scoped near what it describes — not a persistent status
   bar.

## Adding a Page

1. Add an entry to `PAGES` in `scripts/cli/portal-server.mjs` (`id`, `path`, `title`, `dir`).
2. Create `portal/<dir>/{index.html,styles.css,app.js}`. `index.html` links
   `/portal/shared/base.css`, then loads `/portal/shared/theme.js` and `/portal/<dir>/app.js` as
   `type="module"`.
3. In `app.js`, import what you need from `/portal/shared/api.js` (see below) instead of writing
   page-local fetch/token/clipboard helpers.
4. If the page needs its own read or mutating API routes, add a `scripts/cli/portal-routes-<domain>.mjs`
   exporting a route table built with `defineRoutes()` (see "Server Route Dispatch") and add it to
   `API_ROUTE_TABLES` in `portal-server.mjs`.
5. Run the checks in "Checks to Run" below.

Nothing else needs updating — the nav, `/api/portal/status`, and the `/config` alias behavior are
all driven by `PAGES` and `PAGE_BY_PATH`.

## Shared Browser API (`portal/shared/api.js`)

An ES module every page imports from. It owns the mutation-token contract so no page reimplements
it:

| Export | Purpose |
| --- | --- |
| `portalConfig()` | Reads `window.ROBOREPO_PORTAL`; throws `"portal manifest missing"` if absent. |
| `portalGetJson(path)` | `fetch` + `.json()`; throws with the server's `error`/`message` on a non-OK response. |
| `portalPostJson(path, body)` | Same, but POST with `Content-Type: application/json` and `X-Roborepo-Portal-Token` attached from `portalConfig().token`. Also throws if the response body has `ok: false`. |
| `portalCopyText(text, onCopied?)` | Wraps `navigator.clipboard.writeText`; swallows clipboard-blocked errors; calls `onCopied()` on success. |
| `portalSetUpdatedAt(date?)` | Updates the `#portal-updated` header chip. |
| `portalHideLoading()` | Hides the shared full-page loading overlay (`#page-loading`, injected by `theme.js`). Call once after a page's first data fetch resolves — success or handled error — never again after that. |
| `portalTpl(id)` | Clones a `<template>` element's first child by id. The shared render pattern for dynamically-injected markup, so pages keep an HTML anchor instead of building raw strings. |
| `portalEl(tag, attrs, ...children)` | Small DOM builder: `attrs.class` sets `className`, other keys become attributes; children can be strings or nodes. |

### Adding a Read API

Add an entry to the relevant domain's route table in its `scripts/cli/portal-routes-<domain>.mjs`
file (see "Server Route Dispatch") whose handler returns JSON via
`send(res, 200, "application/json", JSON.stringify(...))`. No token or origin check is required
for GET routes — they stay tokenless on purpose so `curl`/local debugging keeps working. Call it
from the page with `portalGetJson(path)`.

### Adding a Mutating API

Mutating routes must be POST (or PATCH — see `portal-routes-repositories.mjs`). `route()` already
gates every mutating method with the origin check and the mutation-token check before any handler
runs (see "Mutation-Token Contract" below), so the handler itself only needs to validate its body
shape and return a JSON result. Call it from the page with `portalPostJson(path, body)` — the
token header is attached automatically.

## Server Route Dispatch

Every domain's API surface is declared as a **route table**, not an if-chain — this is the pattern
every new domain must follow. `scripts/cli/portal-routes-<domain>.mjs` exports an array built with
`defineRoutes()` (from `scripts/cli/portal-router.mjs`):

```js
// scripts/cli/portal-routes-usage.mjs
export const usageRoutes = defineRoutes([
  {
    method: "GET",
    path: "/api/usage",
    handler: (req, res, { handlers }) => {
      send(res, 200, "application/json", JSON.stringify(buildUsageResponse()));
      return true;
    },
  },
]);
```

A route entry is `{ method, path, handler }`:

| Field | Value | Notes |
| --- | --- | --- |
| `method` | `GET` / `POST` / `PATCH` / omitted | Omit to match any method — rare; only read-only routes with no side effect should do this. |
| `path` | Literal (`/api/plans`) or `:param` pattern (`/api/repositories/:id/associations`) | Matcher splits pattern and URL on `/` and compares segment-by-segment, so a `:param` only ever captures one segment. |
| `handler` | `(req, res, { params, qs, handlers }) => boolean` | `params` holds decoded `:param` values (repository ids contain `:`/`/`, so they arrive percent-encoded and come out decoded). Returns `true` once it has written a response; may return `false` to let matching continue, mirroring the old `handle<Domain>Api` contract. |

`portal-server.mjs` concatenates every domain's table into one `API_ROUTE_TABLES` array and calls
`dispatchRoutes(API_ROUTE_TABLES, req, res, urlPath, qs, handlers)` once per request:

```mermaid
sequenceDiagram
    participant C as Client
    participant R as route()
    participant D as dispatchRoutes()
    participant H as matched handler

    C->>R: HTTP request
    R->>R: parse urlPath + qs
    R->>R: origin + mutation-token guard (mutating methods only)
    R->>D: dispatchRoutes(API_ROUTE_TABLES, ...)
    D->>D: walk tables, match path segments
    alt path matches, method matches
        D->>H: handler(req, res, { params, qs, handlers })
        H-->>C: JSON response
    else path matches, method does not
        D-->>C: 405 method not allowed
    else no path matches
        D-->>R: false
        R->>R: try metadata / page / asset / status
        R-->>C: 404 not found (final fallback)
    end
```

That single `API_ROUTE_TABLES` array is the entire enumerable API surface of the portal, in one
place — which is what would let a future OpenAPI document be generated straight from it instead of
hand-maintained. Each domain's table:

| File | Export | Routes |
| --- | --- | --- |
| `portal-routes-config.mjs` | `configRoutes` | `/api/config`, `/api/config/source`, `/api/config/packages`, `/api/config/skills`, `/api/config/permissions` |
| `portal-routes-plans.mjs` | `plansRoutes` | `/api/plans`, `/api/plans/document`, `/api/plans/prompt`, `/api/plans/settings`, `/api/plans/priority`, `/api/plans/lifecycle`, `/api/plans/refresh` |
| `portal-routes-localhoster.mjs` | `localhosterRoutes` | `/api/localhoster`, `/api/localhoster/refresh`, `/api/localhoster/history`, `/api/localhoster/metadata`, `/api/localhoster/links`, `/api/localhoster/association`, `/api/localhoster/project`, `/api/localhoster/alias`, `/api/localhoster/compose-project` |
| `portal-routes-repositories.mjs` | `repositoriesRoutes` | `/api/repositories`, `/api/repositories/:id`, `/api/repositories/:id/associations`, `/api/repositories/:id/plans-enrollment` — path-param routes; a method with no matching route on a path that does match returns `405`, matching the old handler's explicit `methodNotAllowed` |
| `portal-routes-usage.mjs` | `usageRoutes` | `/api/usage`, `/api/usage/refresh` |
| `portal-routes-telemetry.mjs` | `telemetryRoutes` | `/api/data`, `/api/session`, `/api/insights-llm`, `/api/telemetry/markers` (GET/POST), `/api/telemetry/experiments` (GET/POST), `/api/telemetry/experiments/:id/end` (POST), `/api/telemetry/analysis` (POST) — see `docs/reference/services/telemetry.md` for the marker/experiment/analysis domain |
| `portal-routes-metadata.mjs` | `handleMetadataAsset` | `/manifest.json`, `/sitemap.xml`, `/robots.txt` — called separately from `API_ROUTE_TABLES` since these are unauthenticated static assets, not `/api/*` routes (see "Self-Describing Metadata" below) |
| `portal-server.mjs` | `handlePortalPage` | Serves a page's `index.html` (with the injected manifest + token) |
| `portal-server.mjs` | `handlePortalAsset` | Static files under `/portal/` |
| `portal-server.mjs` | `handlePortalStatus` | `/api/portal/status` |

`scripts/cli/portal-routes-http.mjs` holds the `send`/`readJsonBody` helpers every route file
imports.

Adding a new API domain means adding one more `portal-routes-<domain>.mjs` file exporting one more
route table, and one more line in `portal-server.mjs`'s `API_ROUTE_TABLES` array — each domain's
API surface stays in its own file instead of growing a shared one.

`validateRouteTables()` (`portal-router.mjs`) runs once, synchronously, right after
`API_ROUTE_TABLES` is built — before the server binds a port. It rejects a route with no leading
`/` or no handler function, and rejects two routes that resolve to the same `method` + segment
shape (`:param` names are normalized away for this check, so `/api/x/:id` and `/api/x/:foo` count
as the same route and collide). A copy-pasted or malformed entry fails loudly at startup instead of
silently shadowing another route at request time.

## Self-Describing Metadata

The portal serves `/manifest.json`, `/sitemap.xml`, and `/robots.txt` at their conventional root
paths (`portal-routes-metadata.mjs`), so `roborepo:portal` is itself a live, correct example of the
same same-origin conventions `modules/localhoster/metadata.mjs` discovers on other apps (see
`docs/reference/services/localhoster.md`'s "Metadata suggestions" section).

| Artifact | Source | Why |
| --- | --- | --- |
| `manifest.json` | Generated from `PAGES` at request time | Can never drift from the real page list — adding or removing a page changes it on the next request, nothing to hand-sync. |
| `sitemap.xml` | Generated from `PAGES` at request time | Same guarantee as `manifest.json`. |
| `robots.txt` | Static: `Disallow: /` for every agent, plus a `Sitemap:` declaration | Deliberate, not a placeholder — the portal only ever binds to loopback (`LOOPBACK` in `portal-server.mjs`) and will never actually be crawled, so the file's job is to be an honest, safe example of the convention rather than to invite indexing. |
| OpenAPI document for `/api/*` | Not built yet | Generating one from `API_ROUTE_TABLES` (see "Server Route Dispatch") is a natural follow-up now that the route surface is a single enumerable array. |

## Telemetry Analysis Performance Model

The portal server is single-threaded (Node stdlib `http`), so any expensive synchronous work on a
request blocks every other request while it runs. The telemetry analysis (~35k events / 31MB spool
→ ~780ms of read + parse + analyze + serialize) used to run on the `/api/data` request path, which
is what made navigating between portal pages feel unresponsive while telemetry was capturing. Three
layers keep that work off the request path (all in `scripts/cli/telemetry.mjs`, main-thread — no
worker):

1. **Incremental spool store** (`readSpoolEventsCached` + `syncSpoolFile`, `_spoolStore`). The spool
   is append-only, so instead of re-reading + re-parsing the whole file each request, parsed events
   are held in memory per file with a byte cursor; each sync reads only newly-appended bytes. A
   partial trailing line (a capture mid-write) is carried, not parsed, until its newline lands. The
   one shrink case is `capSpool` (telemetry-capture.mjs rewrites a file smaller past ~25MB) — the
   store detects `size < offset` and rebuilds that file. Steady-state read drops from ~450-590ms to
   ~1.3ms. The two live-server readers (`cachedAnalysisJson`, `loadInsightsLlm`) use this; the one-shot
   CLI paths (`telemetry report`/`export`) keep the plain full-read `readSpoolEvents`. The incremental
   byte-tail primitive (offset advance, partial-line hold, shrink/rotate detection) lives in
   `scripts/cli/jsonl-tail.mjs` (`readAppendedLines`), shared with the transcript reader.
2. **Serialized-JSON memoization** (`cachedAnalysisEntry`, `_analysisCache`). The serialized report
   JSON is cached per `spoolSignature | window | harness` (the report object is discarded once
   stringified — only the route consumes it, as a string). The ~10MB default response is not
   re-`JSON.stringify`'d per request — the route sends the cached string via `loadAnalysisJson`.
3. **Debounced background refresh** (`startAnalysisRefresh` / `tickAnalysisRefresh`). A timer polls
   the cheap `spoolSignature`; when it changes it debounces (2s poll / 12s quiet / 60s max-wait) and
   recomputes the **default view** (`window=null, harness=null` — what page loads and the 5s poll
   request) once, keeping it warm. Windowed/panned/harness-filtered requests stay on-demand (cached
   after first compute). The timer is stopped on SIGTERM alongside PID cleanup.

Net: the default `/api/data` is served in ~0.4ms warm; the ~180-270ms analyze runs at most once per
debounce window, between requests, never inside one. The dashboard may lag a new capture by up to
the debounce interval — acceptable, and surfaced by the existing "updated" timestamp.

## Mutation-Token Contract

The server binds to loopback only (`127.0.0.1`), but a browser page can still attempt a
cross-origin POST. Every POST request passes through two checks in `route()` before any handler
runs:

1. **Origin check** — if an `Origin` header is present, it must match `127.0.0.1`/`localhost`
   (any port). Requests with no `Origin` header (e.g. `curl`) are allowed through.
2. **Mutation-token check** — the `X-Roborepo-Portal-Token` header must match the token generated
   once per server process (`crypto.randomBytes(32)`) and embedded only in served page HTML via
   `window.ROBOREPO_PORTAL.token`.

A forged POST from an unrelated site fails the origin check; a POST from a script that never
loaded a portal page fails the token check. `portalPostJson` always attaches the token from
`portalConfig()`, so any page using it automatically satisfies this contract — this is what fixed
Telemetry's "turn on telemetry" button, which previously POSTed without the token header.

## Checks to Run

- `npm test` (`scripts/test/test-roborepo.sh`) — starts the portal server, asserts
  `/api/portal/status`, token exposure, mutating POST success/400/403 responses, and that each
  served `app.js` parses (`node --check`).
- `roborepo web` — click through Config → Plans → Localhoster → Tokens, confirm nav highlighting, and
  exercise each page's mutations (Config toggles, Plans refresh/discovery-root edits, Telemetry
  "turn on telemetry").
- `node --input-type=module --check < portal/<page>/app.js` for a quick module-syntax check on a
  page you edited (page scripts are ES modules, so plain `node --check` on the file path also
  works since `.js` files in this repo are treated as modules by the check).

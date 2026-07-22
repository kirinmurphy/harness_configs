# Portal Architecture

## Purpose

The portal is the local `roborepo serve` web UI: Config (`/`, alias `/config`), Plans (`/plans`),
Localhoster (`/localhoster`), and Telemetry (`/telemetry`). It is static HTML/CSS/browser JavaScript served by a loopback-only
Node HTTP server — no build step, no framework, no bundler. This doc covers the shared
architecture (page manifest, browser API helpers, server route dispatch) that every page relies
on. Page-specific behavior lives in `docs/reference/services/config-control-panel.md` and
`docs/reference/services/plans-portal.md`.

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
   exporting a `handle<Domain>Api` function (see "Server Route Dispatch") and wire it into `route()`
   in `portal-server.mjs`.
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

Add a branch to the relevant `handle<Domain>Api` function in its `scripts/cli/portal-routes-<domain>.mjs`
file (see below) that returns JSON via `send(res, 200, "application/json", JSON.stringify(...))`.
No token or origin check is required for GET routes — they stay tokenless on purpose so
`curl`/local debugging keeps working. Call it from the page with `portalGetJson(path)`.

### Adding a Mutating API

Mutating routes must be POST. `route()` already gates every POST with the origin check and the
mutation-token check before any handler runs (see "Mutation-Token Contract" below), so the handler
itself only needs to validate its body shape and return a JSON result. Call it from the page with
`portalPostJson(path, body)` — the token header is attached automatically.

## Server Route Dispatch

`route()` in `scripts/cli/portal-server.mjs` only does: URL/query parsing, the origin + mutation-
token guard, calling each domain handler in order, and the final 404. Each `handle<Domain>Api`
function lives in its own `scripts/cli/portal-routes-<domain>.mjs` file (imported into
`portal-server.mjs`), receives `(req, res, urlPath, qs, handlers)`, and returns `true` once it has
written a response, `false` if the URL/method didn't match so `route()` falls through to the next
one. `scripts/cli/portal-routes-http.mjs` holds the `send`/`readJsonBody` helpers every route file
imports:

- `portal-routes-config.mjs` → `handleConfigApi` — `/api/config`, `/api/config/source`,
  `/api/config/packages`, `/api/config/skills`, `/api/config/permissions`
- `portal-routes-plans.mjs` → `handlePlansApi` — `/api/plans`, `/api/plans/document`,
  `/api/plans/prompt`, `/api/plans/settings`, `/api/plans/refresh`
- `portal-routes-localhoster.mjs` → `handleLocalhosterApi` — `/api/localhoster`,
  `/api/localhoster/refresh`, `/api/localhoster/links`, `/api/localhoster/association`,
  `/api/localhoster/project`
- `handlePortalPage` (in `portal-server.mjs`) — serves a page's `index.html` (with the injected
  manifest + token)
- `handlePortalAsset` (in `portal-server.mjs`) — static files under `/portal/`
- `handlePortalStatus` (in `portal-server.mjs`) — `/api/portal/status`
- `portal-routes-telemetry.mjs` → `handleTelemetryApi` — `/api/data`, `/api/session`,
  `/api/insights-llm`

Adding a new API domain means adding one more `portal-routes-<domain>.mjs` file and one more import
+ dispatch line in `route()` — each domain's API surface stays in its own file instead of growing
a shared one.

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
- `roborepo serve` — click through Config → Plans → Localhoster → Telemetry, confirm nav highlighting, and
  exercise each page's mutations (Config toggles, Plans refresh/discovery-root edits, Telemetry
  "turn on telemetry").
- `node --input-type=module --check < portal/<page>/app.js` for a quick module-syntax check on a
  page you edited (page scripts are ES modules, so plain `node --check` on the file path also
  works since `.js` files in this repo are treated as modules by the check).

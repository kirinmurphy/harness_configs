---
id: localhoster-metadata-suggestions
priority: high
next_action: Manually verify against a real local app (HTTPS self-signed, authenticated-page) before closing; otherwise ready for review/merge
blocked_by: []
depends_on:
  - localhoster-final
related:
  - localhoster-docker-process-providers
  - localhoster-git-health-history
  - canonical-repository-identity-plan-v2
reviewed_commit:
---

# Localhoster Metadata Suggestions

## Summary

Fetch safe conventional same-origin metadata for current Localhoster apps and present discovered
routes as suggestions, never as automatic quick links.

## Current State

- `/api/localhoster/metadata?key=<opaque-key>` is already routed
  (`scripts/cli/portal-routes-localhoster.mjs:24`) to `loadLocalhosterMetadata`
  (`scripts/cli/localhoster.mjs:122`), which resolves the opaque key via
  `findCurrentInstanceByOpaqueKey` (same SSRF/enumeration guard `loadLocalhosterHistory` uses) and
  returns `{ ok: true, origin, suggestions: [], deferred: "..." }` — an explicitly deferred empty
  result, not a stub route.
- `modules/localhoster/probe.mjs`'s `probeHttpCandidate` already does same-origin HTTP
  GET with an 800ms timeout, a 64KB body cap, `<title>` and `<link rel=icon>` extraction, and
  redirect-target loopback classification (`redirectExternal`). It is not wired into the metadata
  loader yet and does not touch `/sitemap.xml`, `robots.txt`, manifest, or OpenAPI documents — this
  plan extends discovery to those sources, not just title/favicon.
- No `modules/localhoster/metadata.mjs` exists yet.
- Portal has an existing pattern to mirror: `portal/localhoster/history-view.js` is a self-contained
  view module opened via an `onHistory` callback wired in `portal/localhoster/app.js`, fetching
  through `portal/localhoster/api.js`'s `portalGetJson`. Suggestions follow the same shape
  (`createSuggestionsView`, `onSuggestions` callback, `fetchMetadata`).
- "Add as quick link" cannot silently append to the existing `links` mutation
  (`modules/localhoster/settings.mjs` `mutateLinks`, POST `/api/localhoster/links`) — that mutation
  **replaces** the app's whole `links` array rather than merging, so the portal action instead opens
  the existing add-link dialog prefilled with the suggestion.
- `normalizeRoutePath` lives in `modules/localhoster/settings-schema.mjs` (re-exported via
  `settings.mjs` and `index.mjs`) — not `discovery.mjs`. Already rejects cross-origin,
  protocol-relative, and credentialed paths — reused for validating discovered suggestion paths.

## Relation to Canonical Repository Identity (v2)

No dependency. This plan does same-origin HTTP metadata discovery and touches no repository
identity or Git-root resolution, so it is unaffected by `canonical-repository-identity-plan-v2` and
can ship before or after it. Listed as `related` only for sibling-plan awareness.

## Goals

- Inspect manifest, favicon, robots sitemap declarations, conventional `/sitemap.xml`, and
  explicitly linked/configured OpenAPI documents.
- Never send cookies or credentials.
- Enforce loopback-only same-origin fetches, strict body-size limits, redirect limits, and safe URL
  sanitization.
- Deduplicate suggestions by normalized path and label each source.
- Exclude authenticated/admin-looking paths unless they came from explicit OpenAPI or sitemap
  evidence.
- Keep curated links authoritative; suggestions require user action.

## Implementation Plan

- [x] Add `modules/localhoster/metadata.mjs`:
  - [x] Export `discoverMetadataSuggestions(origin, { fetchText, openApiUrl })`, with an injectable
        text-fetch client so tests never hit real sockets.
  - [x] Reuse a shared loopback-fetch guard for every fetch this module makes (manifest, robots.txt,
        `/sitemap.xml`, OpenAPI doc) rather than re-implementing timeout/body-cap/redirect safety.
        Implemented as a new export, `fetchLoopbackText`, extracted from `probeHttpCandidate`'s
        low-level mechanics in `modules/localhoster/probe.mjs` (`probeOrigin` itself is unchanged;
        the two share the same timeout/body-cap constants and loopback check, not a duplicated copy).
  - [x] Parse `manifest.json` for `start_url`/`name`. **Deviation:** only the conventional
        `/manifest.json` path is checked; `<link rel=manifest>` HTML scanning was dropped as
        redundant with the conventional-path fallback for this iteration (most dev servers serve
        `/manifest.json` regardless of whether the page also links it). Documented as a known limit
        in `docs/reference/services/localhoster.md`.
  - [x] Parse `robots.txt` for `Sitemap:` declarations; fetch and parse discovered sitemap URLs and
        the conventional `/sitemap.xml` fallback for `<loc>` paths.
  - [x] Support an explicitly configured OpenAPI document via an `openApiUrl` option and extract
        route paths from its `paths` keys. **Deviation:** no settings field or `<link>`-based
        auto-discovery for the OpenAPI URL was added — the option exists and is tested, but nothing
        currently supplies a value in production. Wiring a settings field is left for a follow-up if
        the suggestion panel proves useful without it.
  - [x] Validate every discovered path with `normalizeRoutePath` (from `settings-schema.mjs`, not
        `discovery.mjs` as originally assumed here) before inclusion; drop anything that fails.
  - [x] Exclude paths matching an authenticated/admin heuristic unless the same path was explicitly
        present in OpenAPI or sitemap evidence.
  - [x] Deduplicate suggestions by normalized path, keeping the highest-confidence source label
        (`openapi` > `sitemap` > `manifest` > `robots`).
  - [x] Never forward cookies/auth headers on any request this module makes.
- [x] Update `loadLocalhosterMetadata` (`scripts/cli/localhoster.mjs`) to call
  `discoverMetadataSuggestions(instance.origin)` instead of returning the hardcoded `deferred` empty
  result; 404-on-unknown-key behavior unchanged. The route handler
  (`scripts/cli/portal-routes-localhoster.mjs`) was updated to await the now-async loader via
  `Promise.resolve(loader(...))`, since it is shared with the still-sync `loadLocalhosterHistory`.
- [x] Add `portal/localhoster/suggestions-view.js` mirroring `history-view.js`'s open/close/render
  structure. **Deviation from the original "append via mutateLinks" idea:** `mutateLinks` replaces
  the app's whole `links` array rather than appending, so "Add as quick link" instead opens the
  existing add-link dialog prefilled with the suggestion (`openLinkDialogWithSuggestion` in
  `app.js`), reusing that form's validation and revision-conflict handling instead of a silent append.
- [x] Wire an `onSuggestions` callback in `portal/localhoster/app.js`'s `cardActions()` and
  `composeProjectActions()`, add a "Suggested routes" entry to the card action menu
  (`data-action="suggestions"` in `index.html`, wired in `templates.js`'s `wireCardActions`), and add
  `fetchMetadata` to `api.js`. **Scope note:** the compose-container inline port row (a separate,
  denser template with its own bare "History" button, no action menu) was left without a matching
  suggestions entry — adding a second bare button there risked clutter and the main card surface
  already covers every app that also appears as a compose member.
- [x] Documented privacy/behavior in `docs/reference/services/localhoster.md` under a new "Metadata
  suggestions" section (what is fetched, source-priority dedup, auth-path filtering and its
  evidence-based override) plus entries under "Current Limits" for known gaps.

## Post-implementation review

A `/code-review` pass against the full implementation diff (commit `14803b1`) found two issues,
both fixed in a follow-up commit:

- **Same-loopback-different-port collapse (fixed).** `normalizeRoutePath` validates that a
  discovered URL's host is *some* loopback host, but not that it matches the *specific* app being
  probed — a sitemap or manifest could name a different local app's port, and the suggestion would
  silently collapse to a bare path attributed to the probed app's origin, with no way for the user to
  see the mismatch before confirming "Add as quick link." Fixed by adding an origin-scoped
  `isSameOrigin` check in `metadata.mjs`'s `dedupeSuggestions`, run before path normalization; added
  a regression test (`same-loopback-different-port URL rejection`).
- **OpenAPI discovery is unreachable in production (doc-only fix).** `discoverMetadataSuggestions`
  supports an `openApiUrl` option and it's exercised in tests, but no settings field, CLI flag, or UI
  supplies one, so this source never runs today. Not a bug — tightened the reference doc's wording
  (both the "Metadata suggestions" section and "Current Limits") so this reads as an explicit gap
  rather than an implied-complete feature.

## Validation

- [x] `scripts/test/localhoster-metadata-check.mjs` added, covering: manifest parsing, robots
  `Sitemap:` parsing, `/sitemap.xml` fallback parsing, OpenAPI path extraction, cross-source
  duplicate-path dedup, unsafe/cross-origin URL rejection, credential-bearing URL rejection,
  authenticated-looking route filtering (and its OpenAPI/sitemap-evidence override), malformed
  sources producing no suggestions instead of throwing, and `fetchLoopbackText`'s own guards
  (external redirect reported-not-followed, body-size cap, timeout, non-loopback rejection) against
  a real local `http.createServer`. Invalid-opaque-key resolution is covered via
  `findCurrentInstanceByOpaqueKey` directly (matching how `localhoster-check.mjs` already tests that
  resolver) rather than through the CLI singleton snapshot cache, which has a fire-and-forget
  background refresh that isn't hermetic to invoke from a unit test.
- [x] `"test:localhoster-metadata": "node scripts/test/localhoster-metadata-check.mjs"` added to
  `package.json`.
- [x] `node --check` passed on every touched/added `.mjs`/`.js` file.
- [x] `npm run test:localhoster-metadata` (new, 11/11 passing) and `npm run test:localhoster`
  (existing core suite) both pass. Also ran every other `test:localhoster-*` script
  (`-git`, `-health`, `-history`, `-docker`, `-docker-stats`, `-docker-mounts`,
  `-compose-identity`, `-repository-merge`, `-process`) since this change touched shared exports in
  `probe.mjs`/`http-probe.mjs`/`index.mjs` — all pass, no regressions.
- [x] Manual real-network verification: started a real local app on `127.0.0.1:4517` serving
  `manifest.json`/`robots.txt`/`sitemap.xml`, called `discoverMetadataSuggestions` against it over a
  real socket (no stub), and confirmed correct output — `/app` from manifest with its label,
  `/resume` and `/admin/panel` from the robots-declared sitemap, with `/admin/panel` correctly kept
  despite looking authenticated because it carried sitemap evidence. Also confirmed the live
  `/api/localhoster/metadata?key=...` route returns `{ ok: true, suggestions: [...] }` against a real
  running worktree portal instance (a separate instance on port 4417, started and torn down without
  touching the user's already-running portal on port 4317).
- [ ] **Not exercised:** HTTPS/self-signed origins, an authenticated-page scenario, and the browser
  UI (dialog rendering, "Suggested routes" menu entry, "Add as quick link" prefill flow) — the Chrome
  browser automation extension was not connected this session. Explicitly flagged as unverified; see
  "Current Limits" in the localhoster reference doc.

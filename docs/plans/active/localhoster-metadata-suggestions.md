---
id: localhoster-metadata-suggestions
priority: high
next_action: Implement safe same-origin metadata discovery and quick-link suggestions
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
  view module opened via an `onHistory` callback wired in `portal/localhoster/app.js` (lines ~386,
  ~472), fetching through `portal/localhoster/api.js`'s `portalGetJson`. Suggestions should follow
  the same shape (`createSuggestionsView`, `onMetadata` callback) rather than a new pattern.
- "Add as quick link" reuses the existing `links` mutation
  (`modules/localhoster/settings.mjs` `mutateLinks`, POST `/api/localhoster/links`) — no new mutation
  type needed, only a portal action that appends one entry to `links` via the settings API.
- `normalizeRoutePath` (`modules/localhoster/discovery.mjs`, re-exported via `index.mjs`) already
  rejects cross-origin, protocol-relative, and credentialed paths — reuse it (or its logic) for
  validating discovered suggestion paths before they're offered as links.

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

- [ ] Add `modules/localhoster/metadata.mjs`:
  - [ ] Export `discoverMetadataSuggestions(origin, { fetchText, now })` (or equivalent), with an
        injectable text-fetch client so tests never hit real sockets — mirrors how `probe.mjs` takes
        `runCommand`/`probeHttp` seams in `discovery.mjs`.
  - [ ] Reuse `probeHttpCandidate`'s loopback/redirect/body-size/timeout guards for every fetch this
        module makes (manifest, robots.txt, `/sitemap.xml`, OpenAPI doc); do not re-implement them.
  - [ ] Parse `manifest.json` (via `<link rel=manifest>` or conventional path) for `name`/`start_url`.
  - [ ] Parse `robots.txt` for `Sitemap:` declarations; fetch and parse discovered sitemap URLs and
        the conventional `/sitemap.xml` fallback for `<loc>` paths.
  - [ ] Support an explicitly configured/linked OpenAPI document (from app settings or a discovered
        `<link rel="...openapi...">`/well-known path) and extract route paths from its `paths` keys.
  - [ ] Validate every discovered path with `normalizeRoutePath` (or shared logic) before inclusion;
        drop anything that fails.
  - [ ] Exclude paths matching an authenticated/admin heuristic (e.g. `/admin`, `/login`,
        `/dashboard`, `/account` path segments) unless the same path was explicitly present in
        OpenAPI or sitemap evidence — then keep it but label the source.
  - [ ] Deduplicate suggestions by normalized path, keeping the highest-confidence source label per
        path (`manifest` | `robots` | `sitemap` | `openapi`).
  - [ ] Never forward cookies/auth headers on any request this module makes.
- [ ] Update `loadLocalhosterMetadata` (`scripts/cli/localhoster.mjs:122`) to call
  `discoverMetadataSuggestions(instance.origin, ...)` instead of returning the hardcoded
  `deferred` empty result; keep the 404-on-unknown-key behavior unchanged.
- [ ] Add `portal/localhoster/suggestions-view.js` mirroring `history-view.js`'s
  open/close/render structure, listing each suggestion with its source label and an "Add as quick
  link" button that POSTs to `/api/localhoster/links` via the existing `mutateLinks` path (append,
  don't replace, the current `links` array — reuse the merge behavior `settings.mjs` already has for
  multi-source link lists).
- [ ] Wire an `onMetadata` callback in `portal/localhoster/app.js` next to the existing `onHistory`
  wiring (~lines 386, 472), and add the corresponding `portalGetJson` call in `api.js` alongside
  `loadLocalhosterHistory`'s fetch.
- [ ] Document privacy/troubleshooting limits (what is fetched, what is never fetched, HTTPS
  self-signed behavior, why authenticated-looking paths are hidden by default) in the localhoster
  portal or CLI docs.

## Validation

- New `scripts/test/localhoster-metadata-check.mjs` (matching the existing
  `localhoster-git-check.mjs` / `localhoster-health-check.mjs` per-area split) with fixture tests
  covering: manifest parsing, robots `Sitemap:` parsing, `/sitemap.xml` parsing, OpenAPI path
  extraction, cross-source duplicate-path dedup, unsafe/cross-origin URL rejection, external
  redirect handling, oversized-body truncation, credential-bearing URL rejection, authenticated-
  looking route filtering (and its OpenAPI/sitemap-evidence override), and invalid/expired opaque
  keys returning 404.
- Add `"test:localhoster-metadata": "node scripts/test/localhoster-metadata-check.mjs"` to
  `package.json`, matching `test:localhoster-git` / `test:localhoster-health`.
- `node --check` on every touched/added `.mjs`/`.js` file.
- `npm run test:localhoster-metadata` (new) and `npm run test:localhoster` (existing core suite,
  since `loadLocalhosterMetadata`'s call site changes) both pass.
- Manual HTTPS/self-signed and authenticated-page scenarios against a real local app when feasible;
  otherwise state explicitly in the completion report that only fixture coverage was exercised.

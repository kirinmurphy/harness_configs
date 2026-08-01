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

`localhoster-final` has key-validated `/api/localhoster/metadata?key=<opaque-key>` returning an
explicitly deferred empty result. HTTP probing already extracts title and favicon with loopback,
redirect, body-size, and timeout protections.

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

- Add `modules/localhoster/metadata.mjs` with injectable fetch/client and parser fixtures.
- Wire `/api/localhoster/metadata?key=<opaque-key>` to on-demand metadata reads.
- Add portal suggestion display and “Add as quick link” action using the existing links mutation.
- Document privacy and troubleshooting limits.

## Validation

- Fixture tests cover manifest, robots, sitemap, OpenAPI, duplicate paths, unsafe URLs, external
  redirects, oversized bodies, credentials redaction, authenticated-looking route filtering, and
  invalid/expired opaque keys.
- `node --check` touched JS files.
- `npm run test:localhoster`.
- Manual HTTPS/self-signed and authenticated-page scenarios when feasible; otherwise document the
  fixture-only limit before completion.

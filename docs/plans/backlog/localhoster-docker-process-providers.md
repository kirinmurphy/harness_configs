---
id: localhoster-docker-process-providers
priority: low
next_action: Implement Docker/Compose and process-metrics providers behind Localhoster capability reporting
blocked_by: []
depends_on:
  - localhoster-final
related:
  - localhoster-git-health-history
  - localhoster-metadata-suggestions
reviewed_commit:
---

# Localhoster Docker And Process Providers

## Summary

Add Docker/Compose enrichment and current process metrics to the Localhoster provider model without
changing the existing settings, quick-link, or portal mutation contracts.

## Current State

`localhoster-final` split the provider foundation into capability, listener, origin, probe,
identity, snapshot, and API boundaries. Docker and process metrics are visible as unsupported
provider capabilities.

## Goals

- Inspect running Docker containers and Compose labels read-only.
- Merge Docker and listener observations that describe the same published host endpoint.
- Collect current PID, parent PID where available, executable name, working directory, elapsed
  runtime, resident memory, and sampled CPU percentage.
- Treat Docker absence, daemon shutdown, permission failures, and exited processes as partial
  provider results with capability notes.
- Keep PID, CPU, and memory as current snapshot facts only; never persist them to settings.

## Implementation Plan

- Add `modules/localhoster/docker.mjs` and `modules/localhoster/process-metrics.mjs`.
- Extend provider aggregation so Docker/process providers run on their own cadence or on demand.
- Add fixture-driven parsers for Docker JSON/label output and process command output.
- Merge Docker/listener observations by normalized host endpoint.
- Surface provider warnings and stale results in snapshots.
- Add portal display fields only for real provider data.

## Validation

- Fixture tests cover Compose labels, Docker daemon unavailable, permission failures, duplicate
  endpoint merge, exited process, missing metrics, and redaction.
- `node --check` touched JS files.
- `npm run test:localhoster`.
- Manual Docker validation on macOS when Docker Desktop is available; otherwise record the limit in
  this plan before completion.

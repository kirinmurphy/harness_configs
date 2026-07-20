---
id: localhoster-git-health-history
priority: high
next_action: Implement Git provider, health-state normalization, and bounded JSONL history
blocked_by: []
depends_on:
  - localhoster-final
related:
  - localhoster-docker-process-providers
  - localhoster-metadata-suggestions
reviewed_commit:
---

# Localhoster Git Health And History

## Summary

Add local Git context, health-state normalization, and bounded transition history for Localhoster
apps while preserving the no-repository-config requirement.

## Current State

`localhoster-final` emits current instances with stable project/app identity, quick links, health
configuration settings, and opaque instance keys. Persisted history is explicitly deferred.

## Goals

- Collect Git branch, detached HEAD, short commit, dirty state, and ahead/behind from existing
  local refs only.
- Never fetch remotes or invoke hooks.
- Normalize health states into `healthy`, `degraded`, `unhealthy`, `starting`, `unknown`, and
  `inactive`.
- Debounce consecutive failures before recording transitions.
- Append bounded JSONL events for first seen, origin change, health transitions, exposure changes,
  duplicate changes, and inactive transitions.
- Tolerate a truncated final JSONL line and compact by retention days plus file-size cap.

## Implementation Plan

- Add `modules/localhoster/git.mjs`, `modules/localhoster/health.mjs`, and
  `modules/localhoster/history.mjs`.
- Cache Git results by repository root per scan.
- Add in-memory history write queue and atomic compaction.
- Wire `/api/localhoster/history?key=<opaque-key>` to real bounded event reads.
- Add portal history/evidence display only after event shape is stable.

## Validation

- Fixture tests cover branch, detached HEAD, dirty state, no remote, ahead/behind from local refs,
  no-fetch behavior, health grace windows, flap resistance, malformed JSONL, compaction, retention,
  and maximum size.
- `node --check` touched JS files.
- `npm run test:localhoster`.
- Manual macOS validation with a moved/no-remote repository when feasible; otherwise document the
  fixture-only limit before completion.

---
id: localhoster-git-health-history
priority: high
next_action: Implement Git provider, health-state normalization, and bounded JSONL history, consuming the shared resolver from canonical-repository-identity-plan-v2 Phase 1
blocked_by: []
depends_on:
  - localhoster-final
  - canonical-repository-identity-plan-v2
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

## Dependency on Canonical Repository Identity (v2)

Do this work **after** `canonical-repository-identity-plan-v2` Phase 1 lands. That phase extracts
Git-root resolution, worktree/common-directory handling, and a per-scan resolution cache out of
`modules/localhoster/identity.mjs` into the shared `modules/repositories/` module. This plan must
consume that resolver instead of building its own:

- **Git root + per-scan caching:** Use the shared resolver's root resolution and resolution cache.
  Do not add an independent "cache Git results by repository root per scan" implementation — v2
  owns it, and building a second one creates the duplicate resolver code v2's migration explicitly
  removes.
- **Branch / HEAD / dirty / ahead-behind:** These become runtime metadata attached to the canonical
  repository record and its local root, not Localhoster-only state. A worktree process resolves to
  the underlying canonical repository (shared remote) while retaining its worktree-specific branch
  and root.
- **`repositoryId` on history events:** Bounded JSONL events should carry the canonical
  `repositoryId` (and local `rootId` where location matters) so history joins the shared registry.

If this plan is scheduled before v2 Phase 1 instead, treat any root-resolution and per-scan cache
code as intentionally throwaway to be replaced during v2's resolver migration, and say so here.

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

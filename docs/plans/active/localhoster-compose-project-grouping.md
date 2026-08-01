---
id: localhoster-compose-project-grouping
priority: high
next_action: Implement composeProject grouping in discovery.mjs, then the project-card rollup render in app.js/templates.js
blocked_by: []
depends_on:
  - localhoster-docker-process-providers
related:
  - localhoster-metadata-suggestions
  - localhoster-git-health-history
  - canonical-repository-identity-plan-v2
reviewed_commit:
---

# Localhoster Compose-Project Grouping

## Summary

Group Localhoster instances that belong to the same Docker Compose project under one project
card, instead of one card per listener/port. A Compose stack (app, db, nginx, mailhog, etc.) is
one logical project with several supporting containers, not several unrelated projects.

## Current State

`localhoster-docker-process-providers` added Docker/Compose enrichment
(`modules/localhoster/docker.mjs`) that merges container data onto a listener by matching
published host port, and process-metrics (CPU/RSS/elapsed) per PID. Each enriched listener still
renders as its own independent card, keyed by `instance.associationKey`
(`modules/localhoster/instance-shape.mjs`), with no relationship surfaced between sibling
containers in the same Compose project.

Two related gaps found during manual smoke testing surfaced the need for this plan:

- Non-HTTP containers (e.g. Postgres on a published host port) were previously dropped entirely
  by `discoverInstances`'s HTTP-probe-required filter (`modules/localhoster/discovery.mjs`).
  Fixed ahead of this plan: a listener with matched Docker container data now survives even
  without a successful HTTP probe, since the container observation is independent confirmation
  the listener is a real service (see `discovery.mjs`, the `!probe && !docker` skip condition).
- Docker-enriched cards with no resolvable project identity (`cwd` lookup fails for
  `com.docker.backend`, the actual host-side listening process on macOS) land in the collapsed
  "Unrecognized listeners" section alongside real noise (ControlCenter, Dropbox), making them easy
  to miss even though `docker.mjs` already captures `composeProject`/`composeService` per
  container.

## Goals

- Instances sharing a `docker.composeProject` value are presented as one project entry, showing
  "N associated ports/instances" rather than N separate top-level cards.
- A non-HTTP container (Postgres, etc.) that belongs to a Compose project with at least one
  HTTP-probed sibling is shown as an associated instance under that project, not filtered out and
  not required to pass its own HTTP probe.
- A Compose project with no git/HTTP-resolvable identity of its own still groups by
  `composeProject`, independent of the existing repo-identity/`associationKey` logic.
- Existing non-Docker instances (plain HTTP dev servers with no container) are unaffected —
  current one-card-per-listener behavior stays for anything without `instance.docker`.
- Grouped project cards remain linkable/aliasable to a repo the same way a single instance is
  today, so "attach this Compose project to my repo" stays one action.

## Non-Goals

- No change to non-Docker listener discovery or grouping.
- No attempt to group by anything other than `composeProject` (e.g. no shared-network inference,
  no heuristic grouping for containers without Compose labels).
- No UI for editing/renaming a Compose project's display name in this pass.

## Implementation Plan

- `modules/localhoster/discovery.mjs`: after building `instances`, compute a
  `composeProject -> instance[]` index from `instance.docker.composeProject` and attach it to the
  snapshot (or a sibling structure) rather than folding it into `associationKey`, so existing
  identity/dedup logic is untouched.
- `modules/localhoster/instance-shape.mjs`: no change to `associationKey` itself; add whatever
  minimal shape is needed for the portal to look up an instance's Compose siblings.
- `portal/localhoster/app.js`: new render path — instances with a shared `composeProject` render
  as one project card (reuse or extend `tpl-card`) with a rollup of associated ports/instances,
  instead of each appearing independently in "Running now" or "Unrecognized listeners".
- `portal/localhoster/templates.js`: add a rollup detail renderer (associated instance list: name,
  port, health) inside the project card, likely reusing the tooltip/detail pattern already used
  for git/docker/process-metrics badges.
- Confirm interaction with the existing "Unrecognized listeners" bucket: a grouped project with at
  least one Compose-labeled container should never render into that collapsed section, since group
  membership itself is the resolvable identity.

## Validation

- Fixture tests: multiple containers sharing one `composeProject` merge into one project entry;
  a Compose project with only non-HTTP containers still renders (using the discovery fix already
  landed); a container with no Compose labels keeps today's single-card behavior; mixed
  HTTP+non-HTTP siblings in one project all appear as associated instances.
- `node --check` touched JS files.
- `npm run test:localhoster`, `npm run test:localhoster-docker`.
- Manual validation against a real multi-container Compose stack (app + db + supporting services)
  to confirm the rollup count and associated-instance list match `docker ps` for that project.

## Follow-up: Resource Threshold Alerting

Not scoped into this plan's implementation — captured here during manual smoke testing as a
distinct next feature, to be scoped and possibly branched separately.

Every quantifiable per-port/per-container stat currently surfaced is purely informational, with no
threshold classification: health state, latency, CPU%, RSS, elapsed uptime. None of these get
flagged when they indicate a real capacity/performance problem.

Proposed shape:

- Define qualifiers per metric: within acceptable levels / approaching overload (warn) / overload
  (alert), plus spike detection (a sudden jump relative to recent samples, not just an absolute
  threshold crossing) since a spike can matter even under a static threshold.
- Surface the qualifier visually on the specific item that crossed it — orange for approaching
  overload, red for overload — at whatever level the metric lives (port-level for latency/health,
  container-level for CPU/RSS/uptime, matching the project/container/port split this plan
  established).
- Add a warning panel at the top of the Localhoster page (parallel to the existing
  `renderWarnings`/`#warnings` mechanism in `portal/localhoster/app.js`) that aggregates and
  highlights every item currently in warn or alert state, so a problem doesn't require expanding
  every card to notice.
- Needs a decision on where thresholds come from: fixed defaults, per-project override via
  `settings.composeProjects[name]` (same settings surface this plan added), or both.
- Spike detection needs a short rolling history of samples per metric — process-metrics collection
  is currently a single point-in-time snapshot per scan (`modules/localhoster/process-metrics.mjs`),
  so this would need its own small ring-buffer/history mechanism, separate from the existing
  instance-history feature (`modules/localhoster/history-diff.mjs`), which tracks discrete
  transition events, not continuous numeric series.

## Follow-up: Detect Stale Git Remote (repo renamed upstream)

Not scoped into this plan's implementation — surfaced during manual smoke testing when this
repo's own `origin` remote was found still pointing at `github.com/kirinmurphy/harness_configs`
(the project's old name) after the GitHub repo itself had been renamed to `roborepo`. Git never
auto-syncs a local remote URL on a GitHub-side rename; GitHub keeps the old URL working via
redirect, so `fetch`/`push` silently kept succeeding through the redirect and the mismatch went
unnoticed. In Localhoster specifically, this caused the same running server/repo to resolve to two
different identities depending on when discovery ran, appearing as a separate "harness_configs"
entry that would show up and disappear.

Proposed shape:

- A check (candidate home: `roborepo doctor`, or a small standalone utility reusable from there)
  that compares a repo's configured remote URL against GitHub's canonical current name for that
  same repo, and flags a mismatch.
- Two viable detection methods, either sufficient alone: (1) HTTP redirect check —
  `curl -sI https://github.com/<org>/<name>` and read the `Location` header when GitHub 301/302s
  to the renamed path; (2) GitHub API — `gh repo view <org>/<name> --json nameWithOwner` (or the
  REST `/repos/{owner}/{repo}` equivalent) and compare its `nameWithOwner`/`full_name` against the
  locally configured remote.
- Natural fit for the canonical-repository-registry work already planned in
  `docs/plans/backlog/portal-homepage-repository-section.md` — `repositoryId`/`urlKey` resolution
  is exactly the layer that should catch and normalize a renamed remote, rather than building a
  parallel one-off check inside Localhoster.
- Not scoped or prioritized yet — revisit when picking up either `roborepo doctor` work or the
  repository-registry plan.

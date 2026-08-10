---
id: h4tqm2wz
priority: medium
next_action: Add ownership classification to collectGitForComposeProjects in modules/localhoster/discovery.mjs, returning ownership/ownershipEvidence alongside the existing rootId
blocked_by: []
depends_on: []
related:
  - localhoster-compose-project-grouping
  - localhoster-repository-card-merge
  - localhoster-metadata-suggestions
reviewed_commit:
---

# Container Ownership Across Checkouts

## Summary

Place each Docker Compose stack on the repository card according to what it actually depends on,
rather than according to which working directory `docker compose up` happened to run from.

A repository open in several working directories at once — a main clone plus linked worktrees, each
called a **checkout** below — can run containers that belong to one of them or to all of them. A
stack serving every checkout (a shared database, say) becomes its own entity alongside them. A
stack tied to one checkout stays a member of it. Where the evidence supports neither claim, the
stack sits at repository level and says so rather than guessing.

## Context

A repository card already renders one root section per checkout
(`localhoster-repository-card-merge`), which is what makes "which checkout owns this container" a
question the card has to answer.

A Compose stack can relate to those checkouts in four ways, and each has a different correct home:

| # | Configuration | Example | Correct placement |
| --- | --- | --- | --- |
| 1 | Shared backing services | One Postgres/Auth/Storage stack; every checkout's dev server points at it | Repository level, alongside checkouts |
| 2 | Per-checkout stack | Isolated env per branch, `COMPOSE_PROJECT_NAME` suffixed or ports offset | Inside that checkout's root section |
| 3 | Mixed | A shared database **and** a per-branch app container in one repository | Split: each by its own evidence |
| 4 | Checkout-independent tooling | Local registry, mail catcher — in the repository, tied to no checkout | Repository level |

Configuration 3 is why the classification has to be per stack rather than a repository-wide setting:
one repository can hold both kinds at once.

Today every stack is placed as though it were configuration 2. `localhoster-metadata-suggestions`
routes each stack into a root section using the project's `working_dir` — the directory
`docker compose up` ran from. That is correct for a per-checkout stack and wrong for the other
three, because the launch directory records where a command was typed, not what the containers
depend on.

The consequence is a misleading card rather than a missing one. A shared stack renders under
whichever checkout started it first, and a row under a "Worktrees" heading reads as belonging to
that branch. Acting on that reading — `docker compose down` from that row — stops the database
every other checkout is using.

## Goals

- Place a Compose stack by evidence of what it depends on, not by launch order.
- Give checkout-independent stacks their own place on the card, as peers of the checkouts.
- Never assert a checkout the evidence does not support.
- Make the blast radius of stopping a shared stack visible before it is stopped.

## Non-goals

- Changing how containers are discovered, how ports correlate, or how stacks are grouped into
  projects. `localhoster-compose-project-grouping` owns that and stays as-is.
- Managing containers (start/stop/restart) from the portal.
- Classifying individual containers separately from their Compose project. A stack is one deploy
  unit — `docker compose down` stops all of it — so it is classified and placed as one unit. See
  "Open questions" for the case that strains this.
- Any network call, or any new subprocess on the common path.

## Current state

Ownership is decided in `collectGitForComposeProjects`
(`modules/localhoster/discovery.mjs`), in three tiers. Every tier sets `rootId` the same way:

```js
rootId: identity.projectRoot ? computeRootId(identity.projectRoot) : null,
```

| Tier | Source | `resolvedFrom` |
| --- | --- | --- |
| 1 | `settings.composeProjects[name].repoPath` (manual) | `manual` |
| 2 | `com.docker.compose.project.working_dir` label | `auto` |
| 3 | Container bind-mount paths, via `docker inspect` | `auto-bind` |

`buildRepositories` (`modules/localhoster/snapshot.mjs`) then routes the group into the root
section matching that `rootId`, falling back to the main slot when it does not resolve.

Mount data is already collected, but only as a fallback. `modules/localhoster/docker-mounts.mjs`
returns bind-mount host paths per container, and its `bindSources()` returns only `Type === "bind"`
mounts, discarding named volumes. Tier 3 consumes that data to resolve *which repository* a stack
belongs to, and refuses to answer when containers disagree — "one repository or nothing".

Mounts are never consulted to answer *which checkout*, because tier 2 resolves that from
`working_dir` whenever the label exists, and the label almost always exists.

## Proposed design

### Classification

Ownership becomes a derived property with three states, computed per Compose project.

**Bind mounts decide.** A bind mount is a hard dependency on one checkout's files — the stack
cannot run without them. A named volume is persisted state that says nothing about which checkout
is in play, so it is ignored for placement (`bindSources()` already drops it).

A manual `ownership` setting, when present, wins over all of the below. Otherwise the stack's bind
mounts are resolved against every known checkout of the repository, and the result decides:

| Bind mounts resolve to | State | Evidence `kind` | Placement |
| --- | --- | --- | --- |
| Exactly one checkout | `owned` | `bind-mount` | That checkout's root section |
| Two or more checkouts | `shared` | `conflict` | Repository level, as a peer of the checkouts |
| The repository root only | `shared` | `repo-root` | Repository level, as a peer of the checkouts |
| Nothing (named volumes only, or no mounts) | `unverified` | `none` | Repository level, marked inferred |

`working_dir` is demoted rather than removed: it still resolves *which repository* a stack belongs
to (tier 2, unchanged), but it no longer decides *which checkout*.

`shared` and `unverified` render in the same place but are not the same claim. `shared` is a
positive finding ("evidence says this is not checkout-specific"); `unverified` is an absence
("nothing here supports any placement"). The card distinguishes them, matching the
correct-or-absent discipline the git badge already follows.

### Data shape

`collectGitForComposeProjects` returns two new fields per project, alongside the existing ones:

```js
{
  git, repositoryId, rootId, resolvedFrom,   // unchanged
  ownership: "owned" | "shared" | "unverified",
  ownershipEvidence: {
    kind: "bind-mount" | "repo-root" | "conflict" | "none" | "manual",
    checkoutPaths: [],   // resolved checkout roots the mounts landed in
  },
}
```

`rootId` keeps its current meaning and is **only** set when `ownership === "owned"`, so a consumer
that ignores the new fields degrades to "shared stacks have no root", not to a wrong checkout.

### Rendering

A third region joins the card, between the main checkout and the worktrees:

```
REPOSITORY  <repo>   GitHub ↗   — localhost:4321  ⓘ

  main branch                    :4321   1 member

  SHARED SERVICES                                        ← new region
    <stack>   11 containers · used by every checkout  ⓘ

  WORKTREES
    feat-x                       :4322   2 members
    feat-y                       :4323   1 member
```

- The heading is a peer of `Worktrees`, reusing `.repository-worktrees-heading`.
- It renders only when a shared or unverified stack exists — a repository with none is unchanged.
- The "used by every checkout" caption is what makes the blast radius legible before acting.
- An `unverified` stack renders in the same region with its provenance stated, joining the existing
  `REPO_PROVENANCE` vocabulary in `portal/localhoster/templates.js`.

### Manual override

`settings.composeProjects[name]` gains an optional `ownership` field accepting `"shared"` or a
checkout path. The evidence is good but not omniscient (a stack may depend on a checkout through a
mechanism no mount reveals — a `.env` file naming a path, a host-network service), so the escape
hatch stays. Tier 1 already reads this object for `repoPath`; this extends it rather than adding a
new settings surface, and it keeps `validateComposeProjects`
(`modules/localhoster/settings-schema.mjs`) as the single validation point.

## Implementation plan

- [ ] Extract checkout roots per repository into a lookup keyed by `repositoryId`, so mount paths
      can be tested against every known checkout rather than only the one `working_dir` named.
- [ ] Add `classifyComposeOwnership(mountPaths, checkoutRoots)` to `modules/localhoster/discovery.mjs`
      returning `{ ownership, ownershipEvidence }` per the decision flow above. Pure function over
      already-collected data — unit-testable with no Docker.
- [ ] Call `collectMounts` for **every** Compose project, not only those that failed repository
      resolution. This is the one cost increase: one batched `docker inspect` on any scan with
      Compose projects. Measure it; if it registers, cache by container id across polls, since
      mounts cannot change without the container being recreated.
- [ ] Set `rootId` only for `owned`; leave it `null` for `shared`/`unverified`.
- [ ] Extend `settings.composeProjects[].ownership` and its validation in
      `modules/localhoster/settings-schema.mjs`.
- [ ] In `buildRepositories` (`modules/localhoster/snapshot.mjs`), collect non-`owned` groups into a
      new `entry.sharedComposeGroups[]` instead of falling back to the main root.
- [ ] Render the Shared Services region in `repositoryCard`
      (`portal/localhoster/templates.js`) plus its heading in `portal/localhoster/index.html` and
      `portal/localhoster/styles.css`.
- [ ] Extend `REPO_PROVENANCE` with the ownership evidence vocabulary so the tooltip states how
      placement was decided.
- [ ] Update the member count so a shared stack is not counted as a member of any checkout.

## Validation

- [ ] `scripts/test/localhoster-compose-identity-check.mjs`: classification unit tests covering all
      four configurations from Context — shared-volumes-only, single-checkout bind, multi-checkout
      bind conflict, and repo-root-only bind.
- [ ] Regression: a repository with exactly one checkout and one stack still renders the stack
      inside that checkout, unchanged. This is the overwhelmingly common case and must not move.
- [ ] `scripts/test/localhoster-repository-merge-check.mjs`: a shared group lands in
      `sharedComposeGroups` and in no root's `composeGroups`; member counts exclude it.
- [ ] Manual: a repository with a shared backing stack (configuration 1) renders that stack once at
      repository level, not under any worktree.
- [ ] Manual: a repository with a per-checkout stack (configuration 2) still renders it under its
      own checkout.
- [ ] All 11 `test:localhoster*` suites pass.

## Risks

- **A stack genuinely shared but bind-mounting one checkout's config** classifies as `owned` and
  renders under that branch — the failure this plan is fixing, in a narrower form. The manual
  override is the mitigation; the "used by every checkout" caption is deliberately absent from
  `owned` stacks so the card never makes that claim on inference alone.
- **`docker inspect` on every scan** is the one added cost. Bounded by the existing 6s timeout and
  batched into one call, and mount data is immutable for a container's lifetime, so caching is
  available if measurement warrants it.
- **Symlinked or relative mount sources** may not resolve to a checkout by prefix match. Falls into
  `unverified`, which is the safe direction — repository level, stated as inferred.

## Open questions

- **Per-container classification.** A single Compose project could legitimately contain both a
  shared database and a per-branch app container (configuration 3 within one stack rather than
  across two). Classifying per stack puts the whole project in one place. Splitting it would render
  containers of one `docker compose down` unit in two regions, which is arguably worse. Deferred
  until a real repository exhibits it — the current design classifies per project, and this is
  recorded so the constraint is a choice rather than an oversight.
- **Does `shared` deserve a distinct visual weight from a checkout row?** It is a peer in the
  hierarchy but a different kind of thing. Starting with the same row treatment under its own
  heading; revisit once it can be seen on a real card.

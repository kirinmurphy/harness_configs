---
id: harness-presence-signal-expansion
priority: low
next_action: Decide which install-time decisions (skill linking, root-config export, summary display) should use discovery's richer presence signal vs. the strict home-dir check, then thread a second field through harness detected.
blocked_by:
  - discoverable-harness-provider-architecture
depends_on: []
related:
  - discoverable-harness-provider-architecture
reviewed_commit:
---

# Harness Presence Signal Expansion

## Summary

`roborepo harness detected` (added in Phase 4 of `discoverable-harness-provider-architecture-plan.md`)
currently reports presence as strict home-directory existence only (`~/.claude` exists), matching the
`harness_present()` shell function it replaced byte-for-byte. Node-side discovery
(`scripts/harnesses/discovery.mjs`) already computes a richer signal — executable-on-PATH,
config-file existence, confidence tiers (`confirmed`/`probable`/`possible`/`absent`) — that `harness
list`/`harness refresh` already surface, but install/uninstall/repair/doctor do not consume it.

## Current State

`harnessDetected()` in `scripts/cli/harness.mjs` emits one TSV row per provider:
`id<TAB>homePath<TAB>present(0|1)<TAB>displayName`, where `present` is `fs.existsSync(homePath)` —
nothing else. This was a deliberate scope decision made while wiring shell install scripts onto this
export (Phase 4): a machine with the `claude` or `codex` binary on `PATH` but no `~/.claude`/`~/.codex`
directory yet (i.e. the harness has never actually been run) is reported as *not present*, so install
does not materialize a home directory the harness itself hasn't created.

## Why This Was Deferred

Broadening presence to "executable on PATH counts as present" changes install-time behavior (skill
linking, root-config export creating `~/.claude/settings.json`, the post-install summary) for anyone
who has a harness CLI installed but has never launched it. That's a real, user-visible behavior change,
not a mechanical refactor step, and Phase 4's job was swapping the *source* shell reads from
(`manifests/platform/harnesses.tsv` parsing) to (`harness detected`) without changing what gets
installed where. Bundling the behavior change into that swap would have made the refactor's diff
unreviewable against the plan's own "Refactor changes active user config" risk mitigation
(characterize + compare byte-for-byte).

## Goals

- Decide, per install-time decision site, whether the strict or the broader signal is correct:
  - Skill linking into `~/.claude`/`~/.codex` (currently strict — arguably correct to stay strict,
    since linking creates the directory).
  - Root-config export (`export_user_config`) — same reasoning.
  - Post-install summary display ("Claude: available/not installed") — arguably should show the
    broader signal, since a user with the binary on PATH but no config yet is meaningfully different
    from a user with no harness at all.
  - `roborepo doctor` health checks — likely wants the broader signal as a diagnostic hint even when
    strict presence is false.
- Avoid re-litigating this per call site by picking one extra field/column, not a second command.

## Implementation Plan

- Add a `confidence` column to `harness detected`'s TSV output (reuse `discoverHarnessProviders`'s
  existing confidence tiers) alongside the existing strict `present` column, so callers can choose
  which to gate on without a second round trip.
- Update the specific call sites identified in Goals above one at a time, each with its own
  before/after characterization note in the commit message (this is a behavior change, not a
  refactor — no byte-for-byte requirement, but the change itself needs to be visible and reviewable).
- Update `scripts/test/harness-cli-check.mjs`'s `testDetectedReflectsHomeDirOnly` to also assert the
  new confidence column, and rename/extend it since "home dir only" will no longer be the whole story.

## Validation

- `node scripts/test/harness-cli-check.mjs`
- `bash scripts/test/test-roborepo.sh --quiet`
- `bash scripts/doctor.sh --quiet`
- Manual check: a machine with `claude`/`codex` on PATH but no home dir yet — confirm each updated
  call site does what was decided in Goals, not what strict presence used to force.

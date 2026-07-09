# Documentation Map And Audit

## Purpose

This audit reviews the reader-facing Markdown documentation outside `docs/plans/` for:

- repetition and unclear ownership
- stale or contradictory behavior
- linkability and navigation
- semantic mappability across the documentation set

It does not treat generated harness instructions, skill bodies, command files, or rules fragments as primary docs, even though they are Markdown. Those files are source content for the harnesses. The reviewed documentation surface is:

- `README.md`
- `docs/README.md`
- `docs/architecture/*.md`
- `docs/guides/*.md`
- `docs/reference/internal/*.md`
- `docs/reference/services/*.md`
- `manifests/inventory/README.md`

## Summary

| Check | Result |
| --- | --- |
| Files reviewed | 25 reader-facing Markdown files |
| Excluded | `docs/plans/**` and generated/instruction Markdown |
| Broken relative file links | None found |
| Main problem | Several docs describe the same areas without a clear doc-of-record |
| Highest staleness risk found | permissions profile language, root-config merge paths, materialization shape |
| Cleanup status | Primary stale items fixed; remaining recommendations are structural follow-ups |

## Semantic Map

Use this as the target ownership model. Each row should have one primary doc, with supporting docs linking back to it instead of restating the same behavior.

| Semantic area | Primary doc | Supporting docs | Notes |
| --- | --- | --- | --- |
| First install | `docs/guides/first-time-setup.md` | `README.md`, `docs/guides/install-workflows.md`, `docs/guides/setup-and-daily-use.md` | First-time setup should stay short and point to install workflows for conflict details. |
| Daily operations | `docs/guides/setup-and-daily-use.md` | `docs/reference/services/roborepo-cli.md`, `docs/reference/services/roborepo.md` | This should be workflow-oriented, not a full CLI reference. |
| CLI command list | `docs/reference/services/roborepo-cli.md` | `docs/reference/services/roborepo.md`, `README.md` | `roborepo-cli.md` should be the compact user command table. |
| CLI internals | `docs/reference/services/roborepo.md` | `docs/reference/services/roborepo-cli.md` | Keep implementation/module details here. Avoid duplicating the full user command table elsewhere. |
| Install collision behavior | `docs/reference/internal/config-collision-handling.md` | `docs/guides/install-workflows.md`, `docs/guides/first-time-setup.md` | This is the source of truth for keep/overwrite/abort, staged update paths, pre-install backups, root-config drift. |
| Filesystem materialization | `docs/reference/services/architecture.md` | `docs/architecture/manifest-and-symlinks.md`, `docs/architecture/config-code-separation.md` | Needs cleanup because some examples still use older adopt/archive terminology. |
| Harness parity concepts | `docs/reference/internal/harnesses-explained.md` | `docs/reference/internal/harness-anatomy.md`, `docs/architecture/cross-harness-behavior-assessment.md` | Teaching doc owns the why. Anatomy owns exact commands. Assessment owns Claude/Codex comparison. |
| Harness element reference | `docs/reference/internal/harness-anatomy.md` | `docs/reference/internal/harnesses-explained.md` | Good hub, but should not carry stale root-config future-plan language. |
| Rules generation/layering | `docs/reference/internal/rules-parity-and-layering.md` | `docs/reference/internal/config-collision-handling.md`, `docs/architecture/cross-harness-behavior-assessment.md` | Needs one explicit paragraph on managed-block injection preserving user text outside the block. |
| Permissions | `docs/reference/internal/harness-anatomy.md#permissions` or a new dedicated permissions doc | `docs/reference/services/codex-hooks.md`, `manifests/inventory/README.md`, `docs/guides/setup-and-daily-use.md` | Current docs are split and some still mention old profiles. Consider a dedicated `docs/reference/internal/permissions.md`. |
| Skills and commands | `docs/reference/internal/skills-and-commands.md` | `docs/reference/services/roborepo-skills.md`, `docs/reference/internal/harness-anatomy.md` | Good separation: concept doc plus user-facing CLI doc. |
| Hooks | `docs/reference/services/claude-hooks.md` and `docs/reference/services/codex-hooks.md` | `docs/reference/internal/harness-anatomy.md`, `docs/architecture/cross-harness-behavior-assessment.md` | Pair is useful. Add an umbrella pointer from `docs/README.md`. |
| MCP | `docs/reference/internal/harness-anatomy.md#mcp-servers` or a new dedicated MCP doc | `docs/reference/services/roborepo-cli.md`, `manifests/inventory/README.md` | The behavior is described in several places but lacks a focused source-of-truth page. |
| Config portal/onboarding | `docs/reference/services/config-control-panel.md` | `README.md`, `docs/guides/first-time-setup.md` | Keep detailed API/routes here; README should only summarize. |
| Telemetry/portal | `docs/reference/services/roborepo.md#preset-onboarding` and telemetry sections | `README.md`, hook docs | Telemetry is buried inside the CLI reference. A dedicated service doc would improve linkability. |
| Code/doc indexing | `docs/reference/services/jcodemunch.md`, `docs/reference/services/jdocmunch.md` | `docs/guides/setup-and-daily-use.md`, `docs/reference/services/roborepo-cli.md` | Good split. |
| Inventory manifests | `manifests/inventory/README.md` | `docs/reference/internal/harness-anatomy.md`, `docs/architecture/config-code-separation.md` | Updated to describe flat permission behavior buckets. |

## Repetition And Redundancy

| Area | Repeated in | Assessment | Recommendation |
| --- | --- | --- | --- |
| Install flow | `README.md`, `first-time-setup.md`, `setup-and-daily-use.md`, `install-workflows.md`, `architecture.md` | The story is correct in broad strokes, but the same flow is restated at different depths. | Make `first-time-setup.md` the shortest path, `install-workflows.md` the detailed user flow, and `config-collision-handling.md` the exact mechanics. Link instead of restating. |
| CLI command list | `README.md`, `roborepo-cli.md`, `roborepo.md`, `setup-and-daily-use.md` | Useful at each layer, but likely to drift as commands change. | Keep only top commands in README, compact full user table in `roborepo-cli.md`, and implementation details in `roborepo.md`. |
| Harness parity | `harnesses-explained.md`, `harness-anatomy.md`, `cross-harness-behavior-assessment.md`, `architecture.md` | These are distinct in intent, but the names do not make the difference obvious enough. | In `docs/README.md`, label them as “why”, “what/how”, “Claude vs Codex matrix”, and “filesystem shape”. |
| Skills | `skills-and-commands.md`, `roborepo-skills.md`, `harness-anatomy.md`, `architecture.md`, `README.md` | Mostly healthy: each doc has a plausible reader. | Add a one-line doc-of-record note to `roborepo-skills.md` pointing maintainers to `skills-and-commands.md`. |
| Root config preservation | `architecture.md`, `config-collision-handling.md`, `rules-parity-and-layering.md`, `cross-harness-behavior-assessment.md` | Too much overlap, and some stale phrasing remains. | Make `config-collision-handling.md` canonical. Other docs should summarize and link there. |

## Staleness Findings And Fixes

| Status | File | Issue | Resolution |
| --- | --- | --- | --- |
| Fixed | `docs/guides/setup-and-daily-use.md` | The permissions section taught old `--profile` / `--permissions` flows. | Replaced with flat behavior buckets, `roborepo onboard` / `roborepo web`, and `roborepo permissions [--check]`. |
| Fixed | `manifests/inventory/README.md` | Described `agent-permissions.json` as permission profiles. | Updated to flat permission behaviors and arbitrary command buckets. |
| Fixed | `docs/reference/services/architecture.md` | Root config examples used old `archived/`, `not_adopted/`, and copied/adopted wording. | Replaced with current `*_original_TIMESTAMP`, `*_update_TIMESTAMP`, and drift-aware root config behavior. |
| Fixed | `docs/reference/services/architecture.md` | Materialization map said skills were copied into harness dirs. | Updated to `~/.roborepo/skills/<name>` cache plus harness symlinks. |
| Fixed | `docs/reference/internal/rules-parity-and-layering.md` | Used old root-config adopt language. | Replaced with `keep` / `overwrite` / `abort` collision policy and added managed-block preservation detail. |
| Fixed | `docs/reference/internal/harness-anatomy.md` | Root config section pointed to a completed plan as if current behavior was still planned. | Replaced with current drift-aware behavior and canonical links to collision handling. |
| Fixed | `docs/reference/services/roborepo.md`, `manifests/platform/cli-commands.json` | CLI docs advertised `roborepo permissions --profile <name>`, which the renderer rejects. | Removed the profile flag from user-facing command docs and CLI usage catalog. |
| Fixed | `docs/reference/services/config-control-panel.md` | Described permission profiles, per-project scope, and looser-profile confirmation. | Updated to the current flat behavior/command bucket model and actual API body. |
| Fixed | `README.md` | Had typos and a commented implementation-history block referencing completed plans. | Fixed typos, removed the hidden history block, and updated permission catalog wording. |
| Fixed | `docs/README.md` | Listed docs without semantic ownership and treated plans as active/future implementation. | Replaced with a semantic docs map and a note that plans are working/history records, not current source of truth. |

## Linkability Findings

| Check | Result |
| --- | --- |
| Relative file links in reviewed docs | No broken file targets found |
| Most linked doc | `docs/reference/internal/harnesses-explained.md` |
| Most linked operational reference | `docs/reference/services/architecture.md` |
| Weak spot | Links are file-valid but not always semantically precise; readers may land in a large doc instead of the exact owning section. |

High-value linkability improvements:

| Improvement | Why |
| --- | --- |
| Add a semantic map to `docs/README.md` | The current index is a list. A map would show which doc owns each question. |
| Add “Doc of record” callouts to dense reference docs | Prevents repeated explanations from becoming competing sources of truth. |
| Prefer section links for large docs | `architecture.md`, `roborepo.md`, and `harness-anatomy.md` are long enough that file-level links are imprecise. |
| Avoid completed-plan links as primary explanations | Completed plans are useful history, but live reference docs should own current behavior. |

## Proposed `docs/README.md` Shape

Replace the current list-only index with a map like this:

| I need to... | Start here | Then read |
| --- | --- | --- |
| Install roborepo | `docs/guides/first-time-setup.md` | `docs/guides/install-workflows.md` |
| Understand collision behavior | `docs/reference/internal/config-collision-handling.md` | `docs/guides/install-workflows.md` |
| Use the CLI | `docs/reference/services/roborepo-cli.md` | `docs/reference/services/roborepo.md` |
| Change a harness element | `docs/reference/internal/harness-anatomy.md` | `docs/reference/internal/harnesses-explained.md` |
| Understand Claude/Codex parity | `docs/reference/internal/harnesses-explained.md` | `docs/architecture/cross-harness-behavior-assessment.md` |
| Change skills or commands | `docs/reference/internal/skills-and-commands.md` | `docs/reference/services/roborepo-skills.md` |
| Debug hooks | `docs/reference/services/claude-hooks.md`, `docs/reference/services/codex-hooks.md` | `docs/reference/internal/harness-anatomy.md#hooks` |
| Change permissions | New `docs/reference/internal/permissions.md` or `harness-anatomy.md#permissions` | `docs/reference/services/codex-hooks.md#session-permissions` |
| Understand filesystem materialization | `docs/reference/services/architecture.md` | `docs/architecture/manifest-and-symlinks.md` |

## Recommended Cleanup Order

1. Decide whether permissions and MCP each deserve a dedicated reference page.
2. Consider extracting telemetry from `docs/reference/services/roborepo.md` into a dedicated service doc.
3. Keep future docs aligned to the semantic map in `docs/README.md`.

## Validation Performed

```sh
node -e '...relative markdown link check...'
```

Result: 25 reviewed documentation files, no broken relative file links.

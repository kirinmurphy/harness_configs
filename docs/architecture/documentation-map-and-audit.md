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
- `docs/user/guides/*.md`
- `docs/internal/*.md`
- `docs/user/reference/*.md`
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
| First install | `docs/user/guides/first-time-setup.md` | `README.md`, `docs/user/guides/install-workflows.md`, `docs/user/guides/setup-and-daily-use.md` | First-time setup should stay short and point to install workflows for conflict details. |
| Daily operations | `docs/user/guides/setup-and-daily-use.md` | `docs/user/reference/roborepo-cli.md`, `docs/user/reference/roborepo.md` | This should be workflow-oriented, not a full CLI reference. |
| CLI command list | `docs/user/reference/roborepo-cli.md` | `docs/user/reference/roborepo.md`, `README.md` | `roborepo-cli.md` should be the compact user command table. |
| CLI internals | `docs/user/reference/roborepo.md` | `docs/user/reference/roborepo-cli.md` | Keep implementation/module details here. Avoid duplicating the full user command table elsewhere. |
| Install collision behavior | `docs/user/reference/config-collision-handling.md` | `docs/user/guides/install-workflows.md`, `docs/user/guides/first-time-setup.md` | This is the source of truth for keep/overwrite/abort, staged update paths, pre-install backups, root-config drift. |
| Filesystem materialization | `docs/user/reference/architecture.md` | `docs/architecture/manifest-and-symlinks.md`, `docs/architecture/config-code-separation.md` | Needs cleanup because some examples still use older adopt/archive terminology. |
| Harness parity concepts | `docs/internal/harnesses-explained.md` | `docs/internal/harness-anatomy.md` | Teaching doc owns the why (incl. the Claude-vs-Codex matrix, folded in from the former `cross-harness-behavior-assessment.md`). Anatomy owns exact commands. Per-element persistence lives in `config-collision-handling.md`. |
| Harness element reference | `docs/internal/harness-anatomy.md` | `docs/internal/harnesses-explained.md` | Good hub, but should not carry stale root-config future-plan language. |
| Rules generation/layering | `docs/internal/rules-parity-and-layering.md` | `docs/user/reference/config-collision-handling.md` | Needs one explicit paragraph on managed-block injection preserving user text outside the block. |
| Permissions | `docs/internal/harness-anatomy.md#permissions` or a new dedicated permissions doc | `docs/user/reference/codex-hooks.md`, `manifests/inventory/README.md`, `docs/user/guides/setup-and-daily-use.md` | Current docs are split and some still mention old profiles. Consider a dedicated `docs/internal/permissions.md`. |
| Skills and commands | `docs/internal/skills-and-commands.md` | `docs/user/reference/roborepo-skills.md`, `docs/internal/harness-anatomy.md` | Good separation: concept doc plus user-facing CLI doc. |
| Hooks | `docs/user/reference/claude-hooks.md` and `docs/user/reference/codex-hooks.md` | `docs/internal/harness-anatomy.md#hooks`, `docs/internal/harnesses-explained.md` | Pair is useful. Add an umbrella pointer from `docs/README.md`. |
| MCP | `docs/internal/harness-anatomy.md#mcp-servers` or a new dedicated MCP doc | `docs/user/reference/roborepo-cli.md`, `manifests/inventory/README.md` | The behavior is described in several places but lacks a focused source-of-truth page. |
| Config portal/onboarding | `docs/user/reference/config-control-panel.md` | `README.md`, `docs/user/guides/first-time-setup.md` | Keep detailed API/routes here; README should only summarize. |
| Telemetry/portal | `docs/user/reference/telemetry.md` (reference), `docs/user/guides/telemetry.md` (walkthrough) | `README.md`, hook docs | Extracted into a dedicated service doc plus a task-oriented guide (see Recommended Cleanup Order, now done). |
| Code/doc indexing | `docs/user/reference/jcodemunch.md`, `docs/user/reference/jdocmunch.md` | `docs/user/guides/setup-and-daily-use.md`, `docs/user/reference/roborepo-cli.md` | Good split. |
| Inventory manifests | `manifests/inventory/README.md` | `docs/internal/harness-anatomy.md`, `docs/architecture/config-code-separation.md` | Updated to describe flat permission behavior buckets. |

## Repetition And Redundancy

| Area | Repeated in | Assessment | Recommendation |
| --- | --- | --- | --- |
| Install flow | `README.md`, `first-time-setup.md`, `setup-and-daily-use.md`, `install-workflows.md`, `architecture.md` | The story is correct in broad strokes, but the same flow is restated at different depths. | Make `first-time-setup.md` the shortest path, `install-workflows.md` the detailed user flow, and `config-collision-handling.md` the exact mechanics. Link instead of restating. |
| CLI command list | `README.md`, `roborepo-cli.md`, `roborepo.md`, `setup-and-daily-use.md` | Useful at each layer, but likely to drift as commands change. | Keep only top commands in README, compact full user table in `roborepo-cli.md`, and implementation details in `roborepo.md`. |
| Harness parity | `harnesses-explained.md`, `harness-anatomy.md`, `architecture.md` | Resolved: `cross-harness-behavior-assessment.md` was deleted — its Claude-vs-Codex matrix folded into `harnesses-explained.md`, its per-element persistence into `config-collision-handling.md`. Three lanes remain: why / what-how / filesystem shape. | Each doc owns one lane and links rather than restates the others. |
| Skills | `skills-and-commands.md`, `roborepo-skills.md`, `harness-anatomy.md`, `architecture.md`, `README.md` | Mostly healthy: each doc has a plausible reader. | Add a one-line doc-of-record note to `roborepo-skills.md` pointing maintainers to `skills-and-commands.md`. |
| Root config preservation | `architecture.md`, `config-collision-handling.md`, `rules-parity-and-layering.md` | Resolved: `config-collision-handling.md` is canonical and now also owns per-element persistence. Other docs summarize and link there. | Keep new persistence detail in `config-collision-handling.md`; others link, never restate. |

## Staleness Findings And Fixes

| Status | File | Issue | Resolution |
| --- | --- | --- | --- |
| Fixed | `docs/user/guides/setup-and-daily-use.md` | The permissions section taught old `--profile` / `--permissions` flows. | Replaced with flat behavior buckets, `roborepo package manage` / `roborepo web`, and `roborepo permissions [--check]`. |
| Fixed | `manifests/inventory/README.md` | Described `agent-permissions.json` as permission profiles. | Updated to flat permission behaviors and arbitrary command buckets. |
| Fixed | `docs/user/reference/architecture.md` | Root config examples used old `archived/`, `not_adopted/`, and copied/adopted wording. | Replaced with current `*_original_TIMESTAMP`, `*_update_TIMESTAMP`, and drift-aware root config behavior. |
| Fixed | `docs/user/reference/architecture.md` | Materialization map said skills were copied into harness dirs. | Updated to `~/.roborepo/skills/<name>` cache plus harness symlinks. |
| Fixed | `docs/internal/rules-parity-and-layering.md` | Used old root-config adopt language. | Replaced with `keep` / `overwrite` / `abort` collision policy and added managed-block preservation detail. |
| Fixed | `docs/internal/harness-anatomy.md` | Root config section pointed to a completed plan as if current behavior was still planned. | Replaced with current drift-aware behavior and canonical links to collision handling. |
| Fixed | `docs/user/reference/roborepo.md`, `manifests/platform/cli-commands.json` | CLI docs advertised `roborepo permissions --profile <name>`, which the renderer rejects. | Removed the profile flag from user-facing command docs and CLI usage catalog. |
| Fixed | `docs/user/reference/config-control-panel.md` | Described permission profiles, per-project scope, and looser-profile confirmation. | Updated to the current flat behavior/command bucket model and actual API body. |
| Fixed | `README.md` | Had typos and a commented implementation-history block referencing completed plans. | Fixed typos, removed the hidden history block, and updated permission catalog wording. |
| Fixed | `docs/README.md` | Listed docs without semantic ownership and treated plans as active/future implementation. | Replaced with a semantic docs map and a note that plans are working/history records, not current source of truth. |

## Linkability Findings

| Check | Result |
| --- | --- |
| Relative file links in reviewed docs | No broken file targets found |
| Most linked doc | `docs/internal/harnesses-explained.md` |
| Most linked operational reference | `docs/user/reference/architecture.md` |
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
| Install roborepo | `docs/user/guides/first-time-setup.md` | `docs/user/guides/install-workflows.md` |
| Understand collision behavior | `docs/user/reference/config-collision-handling.md` | `docs/user/guides/install-workflows.md` |
| Use the CLI | `docs/user/reference/roborepo-cli.md` | `docs/user/reference/roborepo.md` |
| Change a harness element | `docs/internal/harness-anatomy.md` | `docs/internal/harnesses-explained.md` |
| Understand Claude/Codex parity | `docs/internal/harnesses-explained.md` | `docs/internal/harness-anatomy.md` |
| Change skills or commands | `docs/internal/skills-and-commands.md` | `docs/user/reference/roborepo-skills.md` |
| Debug hooks | `docs/user/reference/claude-hooks.md`, `docs/user/reference/codex-hooks.md` | `docs/internal/harness-anatomy.md#hooks` |
| Change permissions | New `docs/internal/permissions.md` or `harness-anatomy.md#permissions` | `docs/user/reference/codex-hooks.md#session-permissions` |
| Understand filesystem materialization | `docs/user/reference/architecture.md` | `docs/architecture/manifest-and-symlinks.md` |

## Recommended Cleanup Order

1. Decide whether permissions and MCP each deserve a dedicated reference page.
2. ~~Consider extracting telemetry from `docs/user/reference/roborepo.md` into a dedicated service doc.~~ Done: `docs/user/reference/telemetry.md` plus `docs/user/guides/telemetry.md`.
3. Keep future docs aligned to the semantic map in `docs/README.md`.

## Validation Performed

```sh
node -e '...relative markdown link check...'
```

Result: 25 reviewed documentation files, no broken relative file links.

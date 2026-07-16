---
name: plan-docs
description: Use when creating, validating, prioritizing, starting, syncing, reviewing, completing, archiving, or handing off repository plan documents under docs/plans. Trigger on explicit /plan-docs or requests to create a durable implementation plan, choose next plan work, start a plan, sync a plan after work, sync this plan, validate a plan, review whether a plan is complete, or prepare a plan handoff. Do not use for brief answers, PR descriptions, PR summaries, ordinary implementation without plan-document management, or casual checklists.
---

# Plan Docs

Use this skill for managed repository plans stored as Markdown under `docs/plans`.

## Mode Selection

If invoked as `/plan-docs` with no mode, return this compact help and stop:

```text
/plan-docs create    create or revise a backlog plan
/plan-docs next      choose the next ready plan
/plan-docs start     move selected work into active and begin
/plan-docs sync      update a plan from completed session work
/plan-docs validate  check schema, lifecycle, and repo consistency
/plan-docs review    decide complete/incomplete/blocked/superseded
/plan-docs handoff   prepare a next-chat handoff
```

For a named mode, read only the needed references:

- Always read `references/plan-schema.md` and `references/lifecycle.md`.
- `create`: also read `references/writing-guidelines.md` and `references/workflow-create.md`.
- `next`: read `references/workflow-next.md`.
- `start`: read `references/workflow-start.md`.
- `sync`: read `references/workflow-sync.md`.
- `validate`: read `references/workflow-validate.md`.
- `review`: read `references/workflow-review.md`.
- `handoff`: read `references/workflow-handoff.md`.
- Portal-generated prompts: read `references/prompt-contracts.md` when prompt shape matters.

## Common Rules

- Resolve the repository root and inspect `docs/plans` before changing plan files.
- Use repository files, tests, config, and Git state as evidence.
- Keep Markdown files as source of truth; do not invent a task database.
- Preserve stable plan `id` when moving files.
- Keep lifecycle transitions explicit through file movement.
- Do not silently move completed, archived, or blocked plans.
- Do not mark work complete from checked boxes alone; verify success criteria.
- Do not add machine-specific absolute paths to repository docs.
- Report changed files and verification run.

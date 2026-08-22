---
name: plan-docs
description: Use when creating, validating, prioritizing, starting, syncing, reviewing, completing, archiving, or handing off repository plan documents under docs/plans. Trigger on explicit /plan-docs or requests to create a durable implementation plan, choose next plan work, start a plan, sync a plan after work, sync this plan, validate a plan, review whether a plan is complete, or prepare a plan handoff. Do not use for brief answers, PR descriptions, PR summaries, ordinary implementation without plan-document management, or casual checklists.
---

# Plan Docs

Use this skill for managed repository plans stored as Markdown under `docs/plans`.

This skill owns frontmatter, lifecycle folders, and the required-section schema for plan
documents. Prose quality and implementation correctness come from the paired skills below.

## Paired Skills

**Load these as part of the mode; do not wait to be asked for them by name.** Their rules constrain
the plan's content, not just its wording, and they join the validation scope — the
`technical-writing` Validator checks the plan against every paired skill that was loaded.

| Skill | Load when | Contributes |
| --- | --- | --- |
| `technical-writing` | **Always** for `create`, `sync`, and `handoff`; for `review` when judging document quality | Section ordering, representation, anti-patterns, reader clarity, and the Creator/Validator loop. Knows nothing about lifecycle or frontmatter, so it never overrides a rule from this skill |
| `code-style` | The plan specifies where code goes: module boundaries, orchestration vs. execution, reuse | Ownership and layering constraints |
| `javascript-typescript` | The plan touches JS/TS — ESM, exports, types, framework-less DOM | Language and markup conventions the plan must not contradict |
| `test-harness` | The plan proposes tests, verification commands, or a regression strategy | Test selection and observable-behavior assertions |

Conditional triggers are subject matter, never plan size: a one-phase plan that specifies module
placement still needs `code-style`. State which paired skills applied and which did not — a skipped
skill and a forgotten one look identical otherwise.

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
- `create`: also read `references/writing-guidelines.md`, `references/workflow-create.md`, and
  `references/workflow-validate.md` — creation ends in validation, so the mode that produces the
  plan loads the checks that decide whether it is deliverable.
- `next`: read `references/workflow-next.md`.
- `start`: read `references/workflow-start.md`.
- `sync`: read `references/workflow-sync.md`.
- `validate`: read `references/workflow-validate.md`.
- `review`: read `references/workflow-review.md`.
- `handoff`: read `references/workflow-handoff.md`.
- Portal-generated prompts: read `references/prompt-contracts.md` when prompt shape matters.

## Creation Gates

These conditions must hold before a new plan can be called created. The full rules live in
`references/plan-schema.md`; these are the ones whose absence makes the artifact invalid.

- **Resolve the plan identity before drafting body content.** Read `docs/plans/plans-config.json`
  when it exists and choose the namespace from it; a project namespace wins over a universal one
  whenever it is the more specific fit. Form `<namespace>-<slug>.md` from that namespace, and pair
  it with a reader-facing H1 that names the outcome rather than restating the filename. When no
  config exists, say so and propose a vocabulary from the repository instead of inventing a prefix.
- **Generate an opaque `id`** of 6-8 lowercase base36 characters. Never derive it from the title,
  filename, or slug; it survives every rename and lifecycle move.
- **Frontmatter carries only** `id`, `priority`, `next_action`, `blocked_by`, `depends_on`,
  `related`, and `reviewed_commit`. Do not add `status`, `validated`, `created_at`, `updated_at`,
  `owner`, `percent_complete`, `estimated_hours`, or `tags` — changing the schema is its own
  decision, made first.
- **Lifecycle is the folder, never a field.** New plans are written to `docs/plans/backlog/`.
- **Never encode lifecycle, status, dates, or versions in the filename.**
- **Load `technical-writing` before drafting, without being asked.**
- **Run both validation layers before delivering.** `plan-docs` validation covers schema,
  lifecycle, naming, and repository consistency; the `technical-writing` Validator covers prose
  quality and every paired skill that applied. A clean report from one does not excuse the other.
- **`create` ends in backlog.** If the user also asked to start the work, validate the backlog plan
  first, then run the `start` workflow to move the same stable `id` into `docs/plans/active/`.

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

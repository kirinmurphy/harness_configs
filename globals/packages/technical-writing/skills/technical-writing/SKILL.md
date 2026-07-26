---
name: technical-writing
description: Use when creating or revising durable technical documentation — architecture notes, implementation plans, migration docs, operational runbooks, design proposals, or repo reference/guide docs — that must explain concepts, current behavior, happy path, edge cases, decisions, and implementation steps for future readers. Use for docs that need clear structure, newcomer-friendly explanations, and separation of facts, recommendations, risks, and open questions. Do not use for brief answers, quick todos, PR descriptions, commit messages, or lightweight implementation notes unless the user asks for a structured document.
---

# Technical Writing

Use this skill to write or revise technical documentation that helps future readers understand a
system, plan, migration, or operational workflow.

For anything under `docs/plans` specifically: pair with `plan-docs`. This skill covers prose
quality — what to say and how to order it once the shape is known. `plan-docs` owns frontmatter,
lifecycle folders, and the required-section schema for plan documents — don't duplicate its
section list here (see `doc-shapes.md`'s note on this).

## Mode Selection

If invoked as `/technical-writing` with no mode, return this compact help and stop:

```text
/technical-writing write    draft or revise a doc
/technical-writing review   run the Creator/Validator loop against an existing doc
```

For a named mode, read only the needed references:

- Always read this file's Core Writing Philosophy below.
- `write`: also read `references/doc-shapes.md`, `references/section-guidance.md`, and
  `references/anti-patterns.md`.
- `review`: also read `references/review-loop.md`, plus whichever of `doc-shapes.md` /
  `section-guidance.md` / `anti-patterns.md` / `doc-organization.md` the review needs to check
  against.
- Revising a documentation set (not a single doc): also read `references/doc-organization.md`.

## Core Writing Philosophy

- Establish why the system or behavior exists before describing how it works. A reader who
  understands the problem first can evaluate the solution; a reader who only sees mechanics
  cannot.
- Make the doc useful to a new engineer who lacks the conversation context.
- Separate current behavior from proposed behavior.
- Put the happy path before edge cases.
- Define domain terms before using them heavily.
- Keep each section self-contained enough that it does not depend on later sections.
- Preserve uncertainty as explicit open decisions, not buried caveats.
- Prefer concrete examples over abstract explanation when data relationships matter.
- Verify claims against source code, tests, configuration, and runtime evidence.

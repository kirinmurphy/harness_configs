---
name: technical-planning-docs
description: Use when creating or revising durable technical planning docs, architecture notes, implementation plans, migration docs, operational runbooks, design proposals, or repo documentation that must explain concepts, current behavior, happy path, edge cases, decisions, and implementation steps for future readers. Use for docs that need clear structure, newcomer-friendly explanations, and separation of facts, recommendations, risks, and open questions. Do not use for brief answers, quick todos, PR descriptions, commit messages, or lightweight implementation notes unless the user asks for a structured planning document.
---

# Technical Planning Docs

Use this skill to write or revise technical documentation that helps future readers understand a system, plan, migration, or operational workflow.

## Core Goals

- Establish why the system or behavior exists before describing how it works. A reader who understands the problem first can evaluate the solution; a reader who only sees mechanics cannot.
- Make the doc useful to a new engineer who lacks the conversation context.
- Separate current behavior from proposed behavior.
- Put the happy path before edge cases.
- Define domain terms before using them heavily.
- Keep each section self-contained enough that it does not depend on later sections.
- Preserve uncertainty as explicit open decisions, not buried caveats.
- Prefer concrete examples over abstract explanation when data relationships matter.

## Authoring Hygiene

- Do not include process rules that only help the writer choose, split, or maintain the document structure.
- Keep reader-facing docs focused on decisions, actions, evidence, workflows, and references.
- Put maintenance or authoring rules in skills, contributor guidance, or agent instructions instead of project docs.
- Avoid meta language like "keep X out of Y" unless the target reader must enforce that rule during normal project work.
- For todo docs, include only unresolved work. Do not include current behavior, completed history, or explanations that belong in guides/reference docs. Prefer concise task titles plus exact owner/source links.
- Avoid local, personal, or machine-specific paths in repo docs unless the user explicitly asks for them or the path is essential to the document's purpose. Prefer repo-relative paths such as `docs/example.md`, placeholders such as `<repo>/...`, or harness-relative paths such as `~/.codex/...` when the location is intentionally under a tool home.

## Default Document Shape

Use this shape unless the existing repo pattern strongly suggests another one:

```md
# Title

## Purpose

## Concept Model

## Current Behavior

## Happy Path

## Required Rules

## Operational Workflow

## Data Integrity And Validation

## Edge Cases

## Implementation Checklist

## Open Decisions

## Success Criteria
```

Skip sections that truly do not apply. Rename sections to match local style.

## Common Doc Shapes

Pick the simplest shape that clearly fits the request. If none clearly fits, use the default shape. These are lightweight section-order hints, not rigid templates.

### Implementation Plan

```md
# Title

## Purpose

## Current Behavior

## Proposed Behavior

## Happy Path

## Edge Cases

## Implementation Checklist

## Open Decisions
```

### Migration Or Data Promotion Plan

```md
# Title

## Purpose

## Current State

## Target State

## Happy Path

## Validation

## Failure And Retry

## Rollback

## Implementation Checklist
```

### Runbook

```md
# Title

## Purpose

## When To Use

## Preconditions

## Steps

## Verification

## Failure Handling

## Escalation
```

### Architecture Decision

```md
# Title

## Context

## Decision

## Alternatives Considered

## Consequences

## Follow-ups
```

## Section Guidance

### Purpose

Explain why the doc exists in plain language. State the user-facing or operational problem being solved.

Good:

- "This table stores redirects from old menu item IDs to surviving menu item IDs. The goal is to promote those redirects without pointing production at missing items."

Avoid:

- vague architecture framing
- unexplained acronyms
- assuming prior meeting context

### Concept Model

Define the main nouns and relationships before workflow details.

Include:

- table/file/job names
- what each object means
- simple examples for relationships
- what is source of truth vs derived/runtime data

### Current Behavior

Describe what the system does today before proposing changes.

Include:

- current creation/update path
- important constraints and missing constraints
- known gaps
- code references when useful

Keep this factual. Do not mix in recommendations unless clearly labeled.

Use current behavior sections in reference or plan docs only when the reader needs to compare current and target state. Do not keep current behavior in a todo document after it has been documented elsewhere.

### Happy Path

Describe the normal expected workflow first.

Use numbered steps. Keep it free of rare failure branches. The goal is for a reader to understand the intended path before reading exceptions.

### Required Rules

List invariants that must always hold.

Examples:

- production must not publish dependent data before upstream data exists
- retries must be idempotent
- omitted records must not imply deletion unless explicit snapshot mode exists
- manual and scheduled jobs should share one code path

### Operational Workflow

Explain scheduled jobs, manual actions, retry behavior, ownership, and audit trail.

Keep commands exact. Prefer default command first, optional arguments after.

For option-driven workflows, use a compact comparison table before deep sections. Include:

- when each option happens
- what it gives the user
- what it hinders or does not do
- what the user must do next

Then explain each option in its own section with `Best when`, `Tradeoffs`, and `User responsibility` when those distinctions affect correct use.

### Data Integrity And Validation

Explain DB constraints, app-level preflight, dependencies, and why each exists.

Separate:

- validation required before write
- DB constraints that enforce integrity
- future constraints that should be added after data is clean

### Edge Cases

Put complex cases after the normal model is established.

Use examples. Explain mitigation, not just risk.

## What Not To Document

### Do not open with a refutation

Never start a doc by explaining why an alternative approach was rejected. The reader has no context for what is being refuted, so the opening becomes a defense of a decision they did not question.

Wrong:
> "Automatic capture at session end isn't reliable: hooks run shell commands, not model reasoning; concurrent sessions cause write conflicts..."

Right: explain what the system does, then let the reader encounter the happy path before any caveats.

### Do not explain decisions to NOT do something

Docs that describe behavior and implementation should not articulate discarded approaches unless the reader must understand the tradeoff to use the system correctly.

Exception — architecture decision docs (`## Alternatives Considered`) are the correct home for rejected approaches. Even there, introduce the chosen approach first before listing alternatives.

If a discarded approach must appear, put it at the end of the doc, never the introduction. Never present it without first establishing what the system actually does.

## Validation Step

After the doc reads well, run a validation loop with two distinct roles before
calling it done. The point is to catch rule violations the drafting pass missed, then
fix them — not to re-draft. Keep the roles separate; do not let the writer grade its
own work in the same pass.

- **Creator** — writes and revises the doc. Owns the prose.
- **Validator** — does not write. Reads every rule in this skill (Core Goals,
  Authoring Hygiene, the chosen Document Shape, Section Guidance, What Not To Document,
  and Multi-Document Sets when revising a set) and checks the current draft against each
  one. Its only output is a report of violations.

The loop:

1. **Validator pass.** Go through the whole doc against the rules above and find
   violations. For each, write one report line: the rule it breaks, the offending
   location (section or quoted phrase), and what is wrong.
2. **If the validator finds violations**, hand the report to the creator. The creator
   revises the doc to address every reported item, then the loop returns to step 1 for
   a fresh validator pass on the revised draft.
3. **If the validator finds nothing**, the doc passes — it is done.
4. **Cap the loop at 10 validator passes.** If the validator still reports violations on
   the 10th pass, stop and report the last validator report as an error — do not keep
   looping. Surface what remained unresolved so the user can decide.

Each pass validates the *revised* draft, not the original — a fix in one round may
introduce a new violation, which the next pass catches.

**Surface the validator's report to the user in chat on each pass** — the violations
it found that round. The creator's revisions don't need restating; they show up in the
edited output already. The user should be able to see what each validation round caught.

## Multi-Document Sets

Use this only when revising a documentation set, not when writing one standalone doc.

Organize docs around reader intent instead of repo history. Prefer a small number of obvious buckets over a rigid global taxonomy. Common buckets include:

- guides for setup, daily use, and operational choices
- reference for exact behavior, APIs, implementation details, and capability docs
- internal or maintainer docs for repo-specific machinery that ordinary users do not need
- plans or todos for unresolved future work only

Make one doc own each explanation depth:

- README gives a compact summary and routes readers to deeper docs.
- Guide gives the practical decision model: what to do, when to choose each path, what each option gives, what it hinders, and what the user must do next.
- Reference gives exact mechanics and edge cases.
- Plans mention only remaining work and link to the owner doc for current behavior.

Do not impose folder names globally. Match existing repo conventions when they are clear. Add folders only when reader intent is currently mixed or docs are becoming hard to scan.

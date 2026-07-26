# Section Guidance

Per-section writing advice for the shapes in `doc-shapes.md`.

## Purpose

Explain why the doc exists in plain language. State the user-facing or operational problem being
solved.

Good:

- "This table stores redirects from old menu item IDs to surviving menu item IDs. The goal is to
  promote those redirects without pointing production at missing items."

Avoid:

- vague architecture framing
- unexplained acronyms
- assuming prior meeting context

## Concept Model

Define the main nouns and relationships before workflow details.

Include:

- table/file/job names
- what each object means
- simple examples for relationships
- what is source of truth vs derived/runtime data

## Current Behavior

Describe what the system does today before proposing changes.

Include:

- current creation/update path
- important constraints and missing constraints
- known gaps
- code references when useful

Keep this factual. Do not mix in recommendations unless clearly labeled.

Use current-behavior sections in reference or plan docs only when the reader needs to compare
current and target state. Do not keep current behavior in a todo document after it has been
documented elsewhere.

## Happy Path

Describe the normal expected workflow first.

Use numbered steps. Keep it free of rare failure branches. The goal is for a reader to understand
the intended path before reading exceptions.

## Required Rules

List invariants that must always hold.

Examples:

- production must not publish dependent data before upstream data exists
- retries must be idempotent
- omitted records must not imply deletion unless explicit snapshot mode exists
- manual and scheduled jobs should share one code path

## Operational Workflow

Explain scheduled jobs, manual actions, retry behavior, ownership, and audit trail.

Keep commands exact. Prefer default command first, optional arguments after.

For option-driven workflows, use a compact comparison table before deep sections. Include:

- when each option happens
- what it gives the user
- what it hinders or does not do
- what the user must do next

Then explain each option in its own section with `Best when`, `Tradeoffs`, and `User
responsibility` when those distinctions affect correct use.

## Data Integrity And Validation

Explain DB constraints, app-level preflight, dependencies, and why each exists.

Separate:

- validation required before write
- DB constraints that enforce integrity
- future constraints that should be added after data is clean

## Edge Cases

Put complex cases after the normal model is established.

Use examples. Explain mitigation, not just risk.

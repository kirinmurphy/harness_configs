---
name: code-style
description: "Use when establishing or applying general coding conventions that cross languages, including naming, file organization, helper placement, comments, exports, repetition, readability, and consistency with existing project patterns."
---

# Code Style

Use this for language-agnostic conventions. Pair with a language-specific skill when syntax, type systems, framework rules, or lint tooling matter.

## General Rules

- Follow local conventions first when they are clear and coherent.
- Prefer self-describing names over procedural comments.
- Keep comments for non-obvious architecture, complex business logic, or tool/lint exceptions with justification.
- Put primary exports and main workflow near the top; move ancillary helpers below when the language supports it cleanly.
- Extract repeated patterns into helpers when duplication appears at least twice and the abstraction is easier to understand than the repeated code.
- Keep files and folders organized around ownership and use, not arbitrary type buckets.
- Prefer named exports or explicit public APIs when a project has no stronger convention.
- Keep files focused. Default soft limit ~150 lines, hard cap ~200 lines unless the project sets its own. When a file exceeds the cap, split by responsibility (e.g. schema, defaults, mappers, view-model, ui) rather than by arbitrary size.
- Split large functions into their own file when they represent a distinct responsibility.
- Separate configuration from implementation so business-rule changes happen in one place instead of across distributed call sites.
- When a module serves more than one consumer (e.g. a CLI and a web UI), place each piece by who actually consumes it, not by which folder happens to house the entry point. Code that only produces output for one consumer (rendering, formatting, presentation) belongs with that consumer; code both consumers need stays in the shared/common location.

## Orchestrators vs. Execution Functions

When a feature area has enough layers that one file mixes "coordinate the steps" with "do the work," split those two roles into separate files.

- Orchestrators marshal: they call other functions in sequence, shape data for the next step, and decide what happens when. They should read as a short list of steps, not contain business logic themselves.
- Execution functions do one thing: an API call, a calculation that returns a result, a single field validation, a single render. Each is independently testable and named for the one thing it does.
- If a file has both, and either role is nontrivial, split: orchestration in one file, execution units in another (grouped by domain, e.g. `validators.ts`, not by generic type).

## Review Checklist

- Names describe behavior or domain meaning.
- File location matches existing ownership boundaries.
- Helpers do not obscure the main flow.
- Comments explain why, not step-by-step mechanics.
- Reuse removes real repetition without creating premature abstraction.
- Files stay within size limits, or large units are split by responsibility.
- Configuration is separated from implementation where business rules would otherwise be scattered.
- Multi-consumer code is placed by who consumes it, not by which folder holds the entry point.
- Orchestration and single-purpose execution logic are separated when a file mixes both roles.

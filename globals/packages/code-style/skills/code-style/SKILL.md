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

## Review Checklist

- Names describe behavior or domain meaning.
- File location matches existing ownership boundaries.
- Helpers do not obscure the main flow.
- Comments explain why, not step-by-step mechanics.
- Reuse removes real repetition without creating premature abstraction.
- Files stay within size limits, or large units are split by responsibility.
- Configuration is separated from implementation where business rules would otherwise be scattered.

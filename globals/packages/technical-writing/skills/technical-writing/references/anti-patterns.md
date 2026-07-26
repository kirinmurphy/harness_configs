# Anti-Patterns

## Authoring hygiene

- Do not include process rules that only help the writer choose, split, or maintain the document
  structure.
- Keep reader-facing docs focused on decisions, actions, evidence, workflows, and references.
- Put maintenance or authoring rules in skills, contributor guidance, or agent instructions instead
  of project docs.
- Avoid meta language like "keep X out of Y" unless the target reader must enforce that rule during
  normal project work.
- For todo docs, include only unresolved work. Do not include current behavior, completed history,
  or explanations that belong in guides/reference docs. Prefer concise task titles plus exact
  owner/source links.
- Avoid local, personal, or machine-specific paths in repo docs unless the user explicitly asks for
  them or the path is essential to the document's purpose. Prefer repo-relative paths such as
  `docs/example.md`, placeholders such as `<repo>/...`, or harness-relative paths such as
  `~/.codex/...` when the location is intentionally under a tool home.

## Do not open with a refutation

Never start a doc by explaining why an alternative approach was rejected. The reader has no
context for what is being refuted, so the opening becomes a defense of a decision they did not
question.

Wrong:
> "Automatic capture at session end isn't reliable: hooks run shell commands, not model reasoning;
> concurrent sessions cause write conflicts..."

Right: explain what the system does, then let the reader encounter the happy path before any
caveats.

## Do not explain decisions to NOT do something

Docs that describe behavior and implementation should not articulate discarded approaches unless
the reader must understand the tradeoff to use the system correctly.

Exception — architecture decision docs (`## Alternatives Considered`) are the correct home for
rejected approaches. Even there, introduce the chosen approach first before listing alternatives.

If a discarded approach must appear, put it at the end of the doc, never the introduction. Never
present it without first establishing what the system actually does.

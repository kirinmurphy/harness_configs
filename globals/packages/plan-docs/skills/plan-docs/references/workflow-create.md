# Create Workflow

1. Understand the desired outcome.
2. Inspect relevant repository code and docs.
3. Check whether an existing plan already owns the work.
4. Create or revise one plan instead of duplicating scope.
5. Generate an opaque `id`: 6-8 lowercase base36 characters, unrelated to the filename. Do not
   derive it from the title or slug — see "Plan ids" in `plan-schema.md`.
6. Write new plans into `docs/plans/backlog/`.
7. Add minimal frontmatter from `plan-schema.md`.
8. Follow `writing-guidelines.md`.
9. Validate readiness.
10. Leave concrete `next_action`.

If the work is too vague to be implementation-ready, create a draft backlog plan and list missing decisions.

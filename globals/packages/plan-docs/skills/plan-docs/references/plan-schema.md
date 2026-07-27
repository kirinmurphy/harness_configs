# Plan Schema

Managed plans live under `docs/plans`.

Lifecycle is derived from folders, not frontmatter:

- `docs/plans/backlog`
- `docs/plans/active`
- `docs/plans/completed`
- `docs/plans/archived`

Files directly under `docs/plans/*.md` are `unclassified`. Show them and recommend moving them; do not treat them as backlog.

Recommended frontmatter:

```yaml
---
id: stable-plan-id
priority: high
next_action: Implement the next concrete task
blocked_by: []
depends_on: []
related: []
reviewed_commit:
---
```

Rules:

- `id`: lowercase slug, unique within the repository, stable across file moves.
- `priority`: `high`, `medium`, `low`, or `none`.
- `next_action`: required for ready backlog plans and active plans; empty for completed and archived plans.
- `blocked_by`, `depends_on`, and `related`: arrays.
- `reviewed_commit`: commit intentionally reviewed against repository state; empty means never reviewed.

Do not add `status`, `validated`, `updated_at`, `created_at`, `owner`, `percent_complete`, `estimated_hours`, or `tags` unless a later plan explicitly adds them.

Readiness requires: H1 title, Summary, Goals or desired outcome, Current state or Context, Proposed design or Implementation plan, Validation or acceptance criteria, frontmatter `id`, frontmatter `priority`, and non-empty `next_action`.

Section headings are matched by label against a synonym list, so several common titles satisfy the same requirement — `Purpose` or `Overview` for Summary, `Current behavior` or `Background` for Context, `Implementation checklist`/`sequence`/`phases` or `Proposed behavior` for Proposed design, `Exit criteria` for Validation. The authoritative list is `modules/plan-docs/section-synonyms.mjs`; add to it rather than renaming existing documents.

Completed plans additionally need a `Verification` section with real content under it — evidence the work was checked, or an explicit statement of what was not verified. A bare heading does not satisfy it.

Validation reports each problem as a finding with a stable code, a plain-language message, and a resolution. Findings are advisory by default: moving a plan into a lifecycle whose requirements it does not meet raises `LIFECYCLE_REQUIREMENTS` (422) listing every problem at once, along with a generated repair prompt, but the move can still be confirmed. Nothing here blocks a move outright.

Use Markdown checkboxes for executable work:

```md
- [ ] Add parser fixture
- [x] Define schema
```

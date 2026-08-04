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

## Naming

A plan filename is `<namespace>-<slug>.md`, lowercase and hyphenated.

### Rules

- Never suffix a filename with `-plan`. Everything under `docs/plans` is a plan.
- Never encode lifecycle, priority, dates, or status in a filename (`-todo`, `-followups`,
  `-active`, `-v2`). Lifecycle is the folder; the rest is frontmatter. Filenames get linked to;
  status changes.
- Keep the slug specific enough to disambiguate from siblings in the same namespace.
- A milestone or suite series shares a prefix plus an ordinal: `<namespace>-<series>-<n>`.
- The H1 is prose for a reader — normal capitalization and spacing, naming the outcome. It is not
  the filename with the hyphens removed, and it should not restate the namespace.
- **`id` never changes when a filename changes.** It is the durable identifier that survives
  renames and folder moves; regenerating it to match a new filename breaks every `related` and
  `depends_on` reference pointing at it.

### Universal namespaces

These apply to most software projects and need no per-repository declaration:

| Namespace | Covers |
| --- | --- |
| `cli` | Command-line surface: commands, arguments, help output, interactive menus |
| `git` | Git operations, branch and worktree models, merge and history behavior |
| `infra` | Build, release, packaging, distribution, dependency and environment management |
| `os` | Operating-system-specific behavior: path semantics, platform detection, per-OS support |
| `test` | Test harness, fixtures, coverage, CI verification strategy |
| `docs` | Documentation systems, reference material, authoring conventions |
| `security` | Trust boundaries, permissions, secrets handling, supply-chain concerns |
| `perf` | Work whose primary goal is efficiency: latency, memory, cost |

### Project namespaces

Everything above is global. A repository declares only its own domain vocabulary, in
`docs/plans/plans-config.json`:

```json
{
  "schemaVersion": 1,
  "namespaces": {
    "portal": "The local web portal, any surface.",
    "telemetry": "Telemetry capture, classification, metrics, experiments, analysis."
  }
}
```

Read that file before creating or renaming a plan, and treat its keys as the allowed project
prefixes alongside the universal set above.

### Choosing between them

**A project namespace wins whenever it is the more specific fit.** The universal set is a fallback
for work a project has not claimed, not a preferred vocabulary. A project that declares `portal`
should file portal CLI work under `portal`, not `cli`, because the specific namespace is what makes
the plan findable among its siblings.

Prefer the universal namespace only when the work genuinely is generic — cross-cutting Git
mechanics, platform path handling, or build tooling that no project namespace describes better.

If none of the available namespaces fits, propose adding one to the project config rather than
inventing an unlisted prefix — an unlisted prefix is how the vocabulary decays into the ad-hoc
naming this convention exists to replace.

### When no project config exists

Most repositories will not have this file, and the convention is weak without one — universal
namespaces alone cannot describe a project's domains. Do not silently fall back to them, and do not
invent unlisted prefixes.

Instead, say the config is missing, then propose an initial vocabulary **derived from the
repository itself**:

- top-level source directories (`modules/`, `portal/`, `packages/`) — these usually *are* the
  domains;
- CLI namespaces or command groups the project already exposes;
- recurring prefixes across existing plan filenames, which reveal the vocabulary the team has
  already been reaching for.

Show the evidence behind each proposal ("`portal` because `portal/` holds five surfaces and six
plans already start with it") so the user can judge it, then **ask them to refine before writing
the file**. A namespace chosen badly gets copied into every future filename, so it is worth one
round of discussion. Expect to merge overlapping proposals and rename to the project's own words.

Write only the agreed set, and keep the file to values — `schemaVersion` and `namespaces`. These
rules stay here in the skill, not in per-repository config.

Until such a file exists, follow the repository's dominant existing convention and say which one
you inferred.

Readiness requires: H1 title, Summary, Goals or desired outcome, Current state or Context, Proposed design or Implementation plan, Validation or acceptance criteria, frontmatter `id`, frontmatter `priority`, and non-empty `next_action`.

Section headings are matched by label against a synonym list, so several common titles satisfy the same requirement — `Purpose` or `Overview` for Summary, `Current behavior` or `Background` for Context, `Implementation checklist`/`sequence`/`phases` or `Proposed behavior` for Proposed design, `Exit criteria` for Validation. The authoritative list is `modules/plan-docs/section-synonyms.mjs`; add to it rather than renaming existing documents.

Completed plans additionally need a `Verification` section with real content under it — evidence the work was checked, or an explicit statement of what was not verified. A bare heading does not satisfy it.

Validation reports each problem as a finding with a stable code, a plain-language message, and a resolution. Findings are advisory by default: moving a plan into a lifecycle whose requirements it does not meet raises `LIFECYCLE_REQUIREMENTS` (422) listing every problem at once, along with a generated repair prompt, but the move can still be confirmed. Nothing here blocks a move outright.

Use Markdown checkboxes for executable work:

```md
- [ ] Add parser fixture
- [x] Define schema
```

# Plans Portal Technical Reference

## Purpose

The Plans portal is a built-in RoboRepo portal page for local Markdown planning documents. It is
paired with an optional `plan-docs` package that installs the agent-facing `/plan-docs` workflow.

This reference describes the current runtime behavior. Historical implementation details live under
`docs/plans/`.

## Concept Model

| Noun | Meaning | Source of truth |
| --- | --- | --- |
| Discovery root | Local directory configured by the user | `path.join(stateRoot, "plan-docs", "settings.json")` or `ROBOREPO_PLAN_ROOTS` |
| Repository | A discovery root or immediate child containing `.git` or `docs/plans` | filesystem |
| Plan | Markdown file under `docs/plans/**/*.md` | repository file |
| Lifecycle | Folder under `docs/plans` | path, not frontmatter |
| Readiness | Deterministic validation result | parser/validator |
| Review state | Relationship between `reviewed_commit` and Git HEAD | Git metadata |
| Plan key | Server-issued opaque key for API calls | in-memory snapshot |

Lifecycle folders:

```text
backlog
active
completed
archived
```

Root-level `docs/plans/*.md` files are reported as `unclassified`.

## Runtime Behavior

`roborepo serve` starts the shared loopback portal server. `/plans` is registered directly in
`scripts/cli/portal-server.mjs`, alongside Config and Telemetry.

The page uses:

- `modules/plan-docs/index.mjs` for discovery, parsing, validation, Git metadata, rendering, and prompt generation
- `scripts/cli/plans.mjs` for portal-facing snapshots and package-state integration
- `scripts/portal/plans/` for static HTML/CSS/JS

The portal does not mutate plan Markdown. Settings writes only update discovery roots.

## Discovery

Resolution order:

1. Saved settings at `path.join(stateRoot, "plan-docs", "settings.json")`.
2. `ROBOREPO_PLAN_ROOTS`, split by the platform path delimiter.
3. Empty roots.

For each discovery root, the scanner checks:

1. the root itself
2. immediate child directories only

A candidate repository is any checked directory with either `.git` or `docs/plans`.
Within a repository, only `docs/plans/**/*.md` is scanned.

Limits:

- maximum document size for rendering/prompt embedding: 1 MiB
- maximum candidate repositories per refresh: 250
- maximum plan files per repository: 500

Hidden files, editor swap files, backup suffixes, and symlink escapes outside the repository boundary
are skipped.

## Plan Parsing

Frontmatter supports a strict YAML-compatible subset:

```yaml
key: scalar
key: []
key:
  - item
```

Supported managed fields:

- `id`
- `priority`
- `next_action`
- `blocked_by`
- `depends_on`
- `related`
- `reviewed_commit`

Unsupported syntax produces warnings rather than guessed behavior. Duplicate keys, invalid IDs,
invalid priority values, and non-array relationship fields are warnings.

The Markdown parser extracts:

- H1 title
- headings
- Markdown checkbox tasks
- excerpt

## Validation

Readiness requires:

- H1 title
- frontmatter `id`
- frontmatter `priority`
- Summary section
- Goals or desired outcome section
- Current state or Context section
- Proposed design or Implementation plan section
- Validation, Acceptance criteria, or Success criteria section
- `next_action` for backlog and active plans

Other warnings include:

- unclassified root-level plan file
- duplicate plan IDs in a repository
- missing dependencies
- self-dependency
- completed plans with unchecked tasks, blockers, or next action
- oversized documents

Warnings are surfaced in the list view and document drawer. They do not move files automatically.

## Git Metadata

For Git repositories, the scanner attempts to collect:

- HEAD
- branch
- last commit date for each plan file
- file status
- review state from `reviewed_commit`

Review states:

| State | Meaning |
| --- | --- |
| `never-reviewed` | no `reviewed_commit` |
| `current` | `reviewed_commit` equals HEAD |
| `possibly-stale` | `reviewed_commit` is an ancestor of HEAD |
| `unknown` | commit is missing, unavailable, or not in current history |

Repositories without Git remain browsable.

## API

All routes are served by the loopback-only portal server.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/plans` | GET | compact plan index and package state |
| `/api/plans/document?key=<key>` | GET | one plan's Markdown, rendered HTML, metadata, tasks, and warnings |
| `/api/plans/prompt` | POST | build repository-aware or portable prompt from server-issued plan keys |
| `/api/plans/settings` | POST | replace discovery roots |
| `/api/plans/refresh` | POST | rebuild the in-memory snapshot |

POST routes require the same origin and per-server mutation token protections as other portal
mutations.

The browser sends plan keys, never arbitrary file paths. The server resolves plan keys from the
current snapshot and rechecks repository boundaries before reading document content.

## Package Integration

The optional package is `plan-docs`.

When disabled:

- `/plans` remains available
- copy path/context/Markdown actions remain available
- workflow prompt actions stay hidden

When enabled:

- `plan-docs` installs a manual skill
- generated `/plan-docs` wrappers are available for Claude and Codex
- `/plans` shows workflow prompt buttons

The Plans page uses the normalized package catalog state. It does not inspect skill symlinks directly.

## Security And Privacy

- Portal binds to loopback.
- No arbitrary file-read endpoint exists.
- Discovery roots scope repository discovery only.
- Document reads require server-issued keys.
- Plan list/document responses avoid exposing repository absolute roots in plan records.
- Portable prompts use repository name, relative path, metadata, warnings, and bounded excerpts.
- The browser does not execute document scripts or write plan files.

## Key Files

- `modules/plan-docs/index.mjs`
- `scripts/cli/plans.mjs`
- `scripts/cli/portal-server.mjs`
- `scripts/portal/plans/index.html`
- `scripts/portal/plans/app.js`
- `scripts/portal/plans/styles.css`
- `globals/packages/plan-docs/package.config.json`
- `globals/packages/plan-docs/skills/plan-docs/`
- `scripts/test/plan-docs-check.mjs`

## Validation

Targeted checks:

```sh
npm run test:plans
npm run test:packages
node scripts/cli/main.mjs skill render-commands --check
node scripts/cli/main.mjs skill triggers --check
```

Broad smoke after shared portal or package changes:

```sh
npm test
```

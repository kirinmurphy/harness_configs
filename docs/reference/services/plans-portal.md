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
| Repository | The first directory found while walking a discovery root that contains `.git` or `docs/plans` | filesystem |
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

`roborepo web` starts the shared loopback portal server. `/plans` is registered directly in
`scripts/cli/portal-server.mjs`, alongside Config and Telemetry.

The page uses:

- `modules/plan-docs/index.mjs` for discovery, parsing, validation, Git metadata, rendering, and prompt generation
- `scripts/cli/plans.mjs` for portal-facing snapshots and package-state integration
- `portal/plans/` for static HTML/CSS/JS
- `portal/shared/base.css` and `portal/shared/theme.js` for the uniform portal
  header, navigation, active-page state, updated-at text, theme toggle, and shared hidden-element
  behavior

The portal does not mutate plan Markdown. Settings writes only update discovery roots.

## Discovery

Resolution order:

1. Saved settings at `path.join(stateRoot, "plan-docs", "settings.json")`.
2. `ROBOREPO_PLAN_ROOTS`, split by the platform path delimiter.
3. Empty roots.

For each discovery root, the scanner does a real recursive walk: it descends into subdirectories
looking for the first folder that has either `.git` or `docs/plans`. The moment it finds one, that
folder is treated as a repository root and the walk does not descend further into it — a
repository's own subfolders are never re-scanned as repository candidates. Nested repositories
(a repo living inside another discovered repo's tree) are still found independently as long as they
aren't inside an already-claimed repository boundary.
Within a repository, only `docs/plans/**/*.md` is scanned (unchanged, separate walk).

Directories are skipped during the walk (not descended into) if they:

- start with `.` (hidden), or
- match the ignored-directory list: `node_modules`, `.git`, `vendor`, `dist`, `build`, `.cache`,
  `coverage`, `.next`, `.venv`, `__pycache__` by default (`ignoredDirectories` in settings)

Limits:

- maximum document size for rendering/prompt embedding: 1 MiB
- maximum candidate repositories per refresh: 250
- maximum plan files per repository: 500
- maximum traversal depth: 6 levels below the discovery root
- wall-clock time budget per discovery call: ~2.5s, after which the walk stops and the result is
  marked `truncated: true`

Hidden files, editor swap files, backup suffixes, and symlink escapes outside the repository boundary
are skipped. The walk also guards against symlink cycles by tracking each directory's realpath and
never descending into one already visited.

Per-file scan results (parsed content, task counts, and git-derived fields like `reviewState`) are
cached in-process keyed by the file's mtime, so a file is only re-parsed and re-queried against git
when it actually changes on disk. Directory listing itself always runs fresh, so added/removed
files are seen immediately; only the expensive per-file work is skipped for unchanged files.

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

Section requirements are matched by heading label against a synonym list, so `Purpose` satisfies
Summary, `Current behavior` satisfies Context, and so on. The list lives in
`modules/plan-docs/section-synonyms.mjs` and is the single place to extend when a document uses a
reasonable heading the scanner does not yet recognize.

## Readiness Findings

Each problem is reported as a finding with a stable code, a plain-language message, a resolution
describing the fix, and optional structured metadata (an unchecked-task count, the accepted heading
names for a missing section). `plan.validation` carries both `findings` and `warnings`, the latter
being the message strings, so display and search keep working while the dialog, the API, and prompt
generation read the structured form.

Moving a plan into a lifecycle whose requirements it does not meet returns `422
LIFECYCLE_REQUIREMENTS` with every finding at once, and the file is not moved. Validation runs
against the file on disk — after identity, stale-state, boundary, and collision checks, immediately
before the rename — so findings always describe current content, and a stale or wrongly targeted
request gets that answer instead of repair guidance.

The response also carries a server-generated repair prompt built from those same findings. The
portal offers it as **Copy prompt to resolve warnings** alongside **View Plan** and **Move anyway**;
the prompt tells an agent to fix the document, leave the file where it is, and preserve the plan ID.
Because the prompt is generated server-side and returned with the rejection, it can never describe
requirements different from the ones on screen.

Readiness is advisory. Confirming **Move anyway** re-submits with validation bypassed, so a document
that predates the schema can still be filed.

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
| `/api/plans/priority` | POST | change one plan's priority, guarded by expected value and mtime |
| `/api/plans/lifecycle` | POST | move one plan between lifecycle folders, guarded and readiness-validated |
| `/api/plans/settings` | POST | replace discovery roots |
| `/api/plans/refresh` | POST | rebuild the in-memory snapshot |

POST routes require the same origin and per-server mutation token protections as other portal
mutations.

Mutation failures return a structured error:

```jsonc
{ "error": {
    "code": "LIFECYCLE_REQUIREMENTS",       // STALE_PLAN, DESTINATION_EXISTS, INVALID_CHANGE, …
    "message": "Couldn't move \"Plan Title\" to Completed.",
    "resolution": "Complete or remove the listed items, then try again — or move anyway.",
    "details": ["Completed plan has unchecked tasks."],   // message strings
    "findings": [                                          // readiness failures only
      { "code": "UNCHECKED_REQUIRED_TASKS", "kind": "lifecycle", "severity": "blocking",
        "message": "Completed plan has unchecked tasks.",
        "resolution": "Complete or remove the remaining required tasks.",
        "count": 3, "meta": { "remaining": 3, "total": 7 } }
    ],
    "repair": { "prompt": "/plan-docs validate\n…", "planKey": "…", "planId": "…" } } }
```

`details` is always the message projection of `findings`, so the two cannot describe different
problems. Both serialization boundaries whitelist error keys explicitly — `sendDomainError` in
`scripts/cli/portal-routes-plans.mjs` and `portalPostJson` in `portal/shared/api.js` — so a new
field on `domainError` must be added to both or it is dropped silently.

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
- `portal/shared/base.css`
- `portal/shared/theme.js`
- `portal/plans/index.html`
- `portal/plans/app.js`
- `portal/plans/styles.css`
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

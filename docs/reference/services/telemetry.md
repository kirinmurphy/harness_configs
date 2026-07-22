# Telemetry

Telemetry is RoboRepo's local, opt-in usage analysis system. It captures per-tool-call facts from
Claude and Codex hooks, turns them into deterministic conclusions (token spikes, testing behavior,
loops, cost breakdowns), and lets a user mark configuration changes and compare sessions before and
after them. Everything lives in local JSONL/JSON files under the RoboRepo state directory; nothing
leaves the machine.

## Capture

`roborepo telemetry capture --harness <claude|codex> --event <HookEvent>` is the hot hook path,
wired into `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, and `Stop`. It lives in
its own minimal-import module (`scripts/cli/telemetry-capture.mjs`) so every hook invocation does not
pay to load the portal/config/analysis dependency graph — a `node` cold-start just to append one
JSONL line. Each capture (schema v3) carries:

- timestamp, harness, event, session ID;
- hashed working directory and repository identity (root hash, remote hash, branch, short SHA);
- tool metadata (name, MCP server/tool, command hash/size, file extension/path hash — never a raw
  command or path);
- best-effort call-paired duration (`call_id`-keyed, so concurrent/nested calls never clobber each
  other's start stamp);
- a reference to the session's effective configuration snapshot (`config_snapshot_id`);
- a semantic `operation` classification (category/runner/scope/target/exit-status/failure-signature —
  never the raw shell command);
- an inferred `phase` (discovery/implementation/debugging/verification/finalization/unknown, with
  confidence and classifier version);
- `intervening`-work signals (edit-since-last-test, changed-file count/categories, diff fingerprint
  change, targeted-test-since-last-full, failure-signature change) — all hashes/booleans/counts,
  never diff content;
- transcript-derived token counts, prompt size/hash/preview, and the tool result size that most
  recently entered context (size only, never content).

Records are appended to per-harness JSONL spools (`telemetry/spool/<harness>.jsonl`), capped at
~25MB each (oldest lines trimmed, newest ~70% kept). Schema-v2 records (pre-Phase-3) remain readable
— every reader treats the spool structurally rather than gating on `.schema`.

## Markers

A marker is an immutable, append-only event: `change`, `phase`, `outcome`, `experiment-start`,
`experiment-end`, or `note`. Corrections append a new marker referencing the original via
`supersedes` rather than editing history.

```sh
roborepo telemetry mark --type change --title "Prevent full-suite debugging loops" \
  --package test-harness --skill test-harness \
  --metric test.full_suite_calls_per_debug_phase --expect decrease
```

`--type` and `--title` are required. Repeatable/optional flags: `--package`, `--skill`, `--tag`,
`--metric`, `--expect increase|decrease|no-change`, `--description`, `--session`, `--phase` (phase
markers only), `--status` (outcome markers only — `successful`/`partial`/`failed`/`abandoned`/
`unknown`), `--supersedes`, and for outcome markers `--task-category`, `--files-touched`,
`--directories-touched`, `--insertions`, `--deletions`. Repository, branch, SHA, timestamp, and a
deduplicated configuration snapshot are always resolved automatically — a caller cannot override
machine-derived identity fields.

An outcome marker is the only place `Stop` alone is never treated as success: outcome must be set
explicitly. Task category/scale on an outcome marker are `explicit` when set via the CLI; a separate
inference path (`telemetry-task-infer.mjs`) exists for analysis-time use but has no live caller today.

## Experiments

```sh
roborepo telemetry experiment start --title "Test-harness guidance v2" \
  --metric test.full_suite_calls_per_debug_phase --expect decrease \
  --guardrail outcome.completion_rate --minimum-sessions 10

roborepo telemetry experiment end <experiment-id>
roborepo telemetry experiment status [<experiment-id>]
```

`start` creates an experiment definition and its `experiment-start` marker together. `end` appends
an `experiment-end` marker and links it. `status` reports lifecycle state, definition, cohort sizes,
effect size, confidence, and whether the result is `ready` — never a provisional winner. Readiness
means: the primary metric computed for both the before/after cohort around the experiment's start
marker, both cohorts meet `eligibility.minimum_sessions_per_cohort` (default 10), and no serious
data-quality issue was flagged (one session dominating a cohort, or excluded sessions).

## Configuration snapshots

Snapshots are content-addressed (`cfg_<24-hex>`, hashed from normalized packages/rules/skills/hooks/
commands/feature-flags — session-specific fields like `harness`/`model`/`created_at` are excluded
from the hash) and deduplicated on write. Built once per session at `SessionStart` (dynamic-imported
only on that event, to keep the hot capture path's import graph small) and referenced by every later
capture in that session. `readConfigSnapshot()` has documented gaps (no full hook command strings, no
MCP server registration detail, no parsed Codex `config.toml`) — snapshots record these as
`unavailable` dimensions rather than guessing.

## Cohorts, metrics, and comparisons

**Metrics registry** (`scripts/cli/telemetry-metrics.mjs`) is the single source of truth for every
metric formula, unit, and directionality used by the CLI report, the portal, alerts, and experiments
— UI components never define their own formulas. 26 metrics across six groups: tokens, time, calls,
testing, outcome, reliability. Each metric declares `direction_good` (`lower`/`higher`/`neutral`) and
a `minimum_sample` below which a value is technically computable but should be treated as
low-confidence. Robust summaries (trimmed mean, median, percentile) are used for heavy-tailed
token/duration distributions rather than plain averages.

**Cohort filter** (`scripts/cli/telemetry-cohort.mjs`) is a normalized object shared by the CLI and
portal: `time`, `harnesses`, `models`, `repos`, `packages`/`skills` (exposure, resolved via
`config_snapshot_id`), `operations`, `phases`, `outcomes`, `task_categories`, `snapshot_ids`. The same
filter object scopes every panel — no panel-local filter silently redefines the global cohort.

**Marker-relative comparison** (`scripts/cli/telemetry-compare.mjs`) is the preferred way to answer
"did this change something": given a `change` marker, sessions are split into before/after cohorts
(sessions spanning the marker are excluded), equalized (equal session count or equal duration), and
compared per metric. Every comparison reports cohort sizes, excluded-session reasons, effect size,
and a confidence label:

- **strong signal** — both cohorts ≥20 sessions, no serious data-quality issue;
- **emerging pattern** — computable, but below the strong-signal session floor;
- **insufficient evidence** — either cohort below the minimum session count, or the metric didn't
  compute;
- **data-quality warning** — one session dominates a cohort (>40% of its captures), or sessions were
  excluded for spanning the marker.

The older earlier-vs-later **midpoint regression** (`telemetry-analyze.mjs`'s `regression()`) is
retained as a labeled *exploratory fallback* for when no marker is selected — the portal and CLI both
mark it `exploratory: true` and describe it as not tied to any specific change.

Every comparative finding follows the same **actionable finding contract**: observation, evidence
(cohort sizes, effect size), interpretation (explicitly labeled `"labeled_as": "inference"`), next
action, confidence, data-quality issues, and a ready-to-apply `analysis_filter_state` so the portal's
"open analysis" action reproduces the exact cohort/metric. No finding ever claims a package, skill, or
rule *caused* a result — wording stays at "exposed to" / "correlates with."

## Package telemetry policies

A package's `package.config.json` may declare `telemetry.policies`: `[{ metric, operator, value,
minimum_samples, severity }]`. `scripts/cli/telemetry-policy.mjs` validates policy shape (known
metric id, valid operator, numeric threshold) and evaluates a policy against a computed metric value
+ sample size, returning `satisfied` / `violated` / `insufficient-samples` / `unknown`. Policies are
advisory only — nothing in this system blocks a command or tool call. No package in this repository
declares policies yet; the mechanism is generic and ready for a package to adopt.

## CLI report

`roborepo telemetry report` (add `--deep` for an optional LLM synthesis of the deterministic facts —
never raw spool/transcript content) prints, in order: deterministic insights (each with confidence
and a next action), data-quality warnings, read warnings, recent markers, experiment readiness, usage
windows, testing efficiency, cost breakdowns, midpoint regression (labeled exploratory), loops,
sessions, spikes, and raw contributor tables. The same `analyzeTelemetry()` function and metric
registry back both this report and the portal, so CLI and portal numbers agree for the same cohort.

## Portal

`/telemetry` is a frameworkless, dependency-free page (`portal/telemetry/`) polling `/api/data` every
5 seconds. See `docs/reference/services/portal.md` for the shared portal architecture (loopback bind,
mutation-token contract, route dispatch). Telemetry-specific pieces:

- **Global cohort filter bar** — time range, harness, model, repository, and a marker-relative
  comparison selector. Serializes into the URL (`?range=`, `&end=`, `&harness=`, `&model=`, `&repo=`,
  `&marker_id=`) so a filtered view can be bookmarked, copied, and restored on reload.
- **Timeline marker overlay** — markers render as colored vertical lines (by type) on the token-usage
  chart; overlapping markers cluster; hover shows title/timestamp/SHA/packages/skills/metric; click
  opens marker detail, with a "compare across this marker" action for `change` markers.
- **Action-item panel** — each deterministic insight shows severity, confidence, headline, detail,
  next action, and an "open analysis" button that expands the Analysis explorer pre-filled with that
  finding's metric/marker.
- **Testing-efficiency panel** — leads with the most actionable abnormality (redundant full-suite
  reruns without an intervening edit), then a compact metrics table.
- **Analysis explorer** (`portal/telemetry/analysis-explorer.js`) — a collapsed-by-default drawer for
  high-cardinality comparisons the global filter bar deliberately does not expose: pick a metric from
  the registry, compare across a marker or between two independently-filtered cohorts, see the result
  with the same confidence/data-quality treatment as everywhere else.
- **Session detail** — extended with model history, the session's configuration snapshot (id +
  packages/skills), a phase timeline, semantic operation totals, its explicit outcome/task category
  (marked `source: "explicit"`, since no live inference caller exists yet), markers within a 15-minute
  window of the session, and data-quality flags — alongside the existing "surface chat context" /
  copy-prompt / transcript-open actions, which are unchanged.
- **Marker creation** — a dialog reachable from the cohort filter bar ("+ mark change") posts through
  the same validation/persistence path as the CLI (`createMarker` in `telemetry-markers.mjs`); no
  browser-side duplication of marker rules.

## API

- `GET /api/data?range=&end=&harness=&model=&repo=&marker_id=` — the full analysis report, cohort-
  scoped. Response includes `available_harnesses`/`available_models`/`available_repos`/
  `available_metrics`, window-scoped `markers`, `experiments`, `testing_efficiency`, `cohort`
  (present when a model/repo filter is active), and `marker_comparison` (present when `marker_id`
  resolves).
- `GET /api/session?id=&harness=&finding=&repo=` — bridges a flagged event to its transcript, plus
  `spool_context` (model history, config snapshot, phase timeline, operation totals, outcome, nearby
  markers, data-quality flags) derived from the spool alone, present even when the transcript itself
  is not found on disk.
- `GET /api/insights-llm` — on-demand LLM synthesis of deterministic facts (may take seconds).
- `GET/POST /api/telemetry/markers` — list or create a marker. POST reuses `createMarker()`.
- `GET/POST /api/telemetry/experiments`, `POST /api/telemetry/experiments/:id/end` — list, start, or
  end an experiment. Reuse `startExperiment()`/`endExperiment()`.
- `POST /api/telemetry/analysis` — `{ metric, marker_id }` for a marker-relative comparison, or
  `{ metric, cohort_a, cohort_b }` for a direct two-cohort comparison (no before/after language — no
  shared timestamp to split sessions around). Validates the metric id against the registry and
  returns `400` for an unknown one along with the full known-metric list.

All mutating routes are POST-only and use the portal's standard loopback-origin + mutation-token
guard (see `docs/reference/services/portal.md`).

## Privacy and retention

Telemetry never stores full prompts, shell commands, tool results, transcripts, or absolute paths by
default — only hashes, lengths, categories, and bounded previews (a 200-character prompt preview; a
4000-character *transient* failure-text buffer used only to compute a failure-signature hash, never
persisted). Estimated token/cost figures (~4 chars/token) are clearly distinguished from real
provider-reported counters. `telemetry export`/`backup`/`purge` cover markers, snapshots, and
experiments alongside the spool; `purge --backup` remains recoverable. The portal server binds to
loopback only.

## Schema versions

| Record | Schema field | Current version | Notes |
| --- | --- | --- | --- |
| Capture | `schema` | 3 | v2 records remain readable; readers never gate on `.schema`. |
| Marker | `schema` | 1 | |
| Configuration snapshot | `schema` | 1 | Content-addressed id (`cfg_<24-hex>`). |
| Experiment | `schema` | 1 | |

## Related

- `docs/plans/active/roborepo-telemetry-events-experiments-plan.md` — the implementation plan this
  system was built from, with per-phase grounding notes (concrete file:line references, deferred
  work, decisions made along the way).
- `docs/reference/services/portal.md` — the shared portal server/route/mutation-token architecture.

---
id: roborepo-telemetry-events-experiments
priority: high
next_action: "Phase 0 — use jcodemunch to map current telemetry/config flows; capture schema-v2 fixtures for Claude and Codex"
blocked_by: []
depends_on: []
related: []
reviewed_commit:
---

# Telemetry Events, Experiments, and Actionable Analysis

## Status

Proposed implementation plan grounded in the current RoboRepo `main` branch.

## Purpose

Extend RoboRepo telemetry from a useful collection of token and tool-cost summaries into an explainable analysis system that can answer questions such as:

- Did changing a rule, skill, hook, script, package, or portal implementation produce a measurable change?
- Are full test suites being used as a debugging loop instead of targeted tests?
- Which tools consume most of a session's wall-clock time or context?
- Do sessions exposed to one package, skill revision, harness, or model behave differently from comparable sessions?
- Is a higher-cost model actually cheaper per successfully completed task?
- What evidence supports an alert, how reliable is it, and what should the user do next?

The system must remain honest about attribution. It may report direct observations and controlled correlations, but it must not claim that a prompt fragment, rule, package, or skill caused model behavior unless RoboRepo can directly observe the causal action.

## Required implementation workflow: use jcodemunch

The implementing agent must use jcodemunch while working on this plan.

Before editing:

1. Resolve and index the RoboRepo checkout with jcodemunch.
2. Refresh the index if it is stale.
3. Use jcodemunch symbol search, reference search, repository outlines, and context bundles to map the full telemetry path:
   - capture hooks and CLI dispatch;
   - transcript parsing and cursors;
   - JSONL persistence and retention;
   - analysis and deterministic insights;
   - portal routes and query parsing;
   - telemetry browser state, rendering, charting, and modals;
   - package catalog, configuration snapshot, and package mutation paths.
4. Use changed-symbol and reference queries before changing shared functions or record shapes.
5. Prefer narrow jcodemunch context bundles over repeatedly reading entire source files.
6. Refresh the index or register edits after structural changes so later searches reflect the new implementation.
7. Fall back to `rg` and targeted file reads only when jcodemunch cannot answer a query. Do not use broad repository dumps as the primary exploration method.

jcodemunch has two separate roles in this feature:

- **Implementation tool:** required for navigating and changing RoboRepo safely.
- **Measured MCP package:** its calls, durations, result sizes, and correlations continue to appear in telemetry like any other MCP package.

Do not hard-code analysis around jcodemunch. MCP identification must remain server-generic, with the existing bare-name compatibility behavior retained where required by current Codex transcripts.

## Current behavior that must be preserved

### Capture lifecycle

RoboRepo currently wires `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, and `Stop` hooks for Claude and Codex. The hot capture path is intentionally isolated in `scripts/cli/telemetry-capture.mjs` so every hook does not load the portal and analysis dependency graph.

Each schema-v2 capture currently records:

- ISO timestamp;
- harness and event;
- session/conversation ID;
- hashed working directory plus its basename;
- repository label, hashed root/remote, branch, and short Git SHA;
- tool name, MCP identity, command hash/size, and privacy-safe file metadata;
- best-effort tool duration from paired pre/post hooks;
- prompt size, hash, and a 200-character normalized preview;
- transcript-derived model and cumulative token counters;
- assistant, tool, and MCP call counters;
- newest and largest transcript tool-result sizes without retaining full result content.

Capture is locally enabled/disabled through telemetry state. Records are appended to per-harness JSONL spools and capped at approximately 25 MB each.

### Current analysis

`scripts/cli/telemetry-analyze.mjs` currently derives:

- session rollups;
- delta-token spike thresholds and one worst spike per session;
- token contributors by repository, tool, MCP server, and event;
- spike-versus-normal cohorts;
- spike causes;
- recent estimated token windows;
- per-capture timeline data;
- per-tool, functional-group, and MCP-package result-size cost;
- spike anatomy and lift;
- earlier-versus-later midpoint regression;
- consecutive same-tool loop detection.

`scripts/cli/telemetry-insights.mjs` converts these facts into conservative deterministic findings. The optional deeper read sends only a computed summary—not the raw spool—to an available agent CLI.

### Current portal

The telemetry portal is frameworkless and dependency-free. It uses browser modules, HTML `<template>` elements, a canvas controller, pure state helpers, API wrappers, panel/modal controllers, and dedicated render functions.

Current global scope controls are:

- time range;
- panned time-window endpoint;
- harness.

The server applies these filters to the entire report. The page then presents:

1. deterministic action items;
2. token timelines;
3. warnings, loops, spikes, and spike causes;
4. collapsed cost analysis;
5. sessions;
6. raw supporting breakdowns.

This ordering, the local-only server, content-safe rendering, transcript-context actions, and five-second data polling must be preserved.

### Known limitations to correct

1. The model is captured but omitted from session rollups and portal filtering.
2. `package_cost` means MCP server or `native`; it does not represent RoboRepo package exposure.
3. Installed or active skills are not associated with sessions.
4. Midpoint regression is not aligned with a real implementation change.
5. A hashed Bash command cannot be classified as test/build/lint or targeted/full-suite.
6. Same-tool loop detection cannot distinguish repeated semantic operations performed through Bash.
7. A session-wide average can hide waste that occurs specifically during debugging.
8. Cost analysis does not include completion or verification outcomes.
9. Alerts do not expose cohort definitions, sample sufficiency, confidence, or data-quality limitations.
10. The single per-session tool-duration cursor can be overwritten by nested or concurrent calls; new pairing must use a stable call identifier when the harness supplies one.

## Product decisions

### 1. One event model

Use a general `telemetry marker` record rather than separate storage formats for releases, phases, outcomes, and experiments.

Supported marker types in the first complete implementation:

- `change` — implementation/configuration change;
- `phase` — explicit task phase boundary;
- `outcome` — session or task result;
- `experiment-start`;
- `experiment-end`;
- `note` — user-defined timestamped context.

Markers are immutable append-only events. Corrections append a superseding marker referencing the original ID; existing history is never edited silently.

### 2. Configuration exposure, not causal attribution

Represent relationships with explicit confidence levels:

| Relationship | Meaning | Permitted wording |
| --- | --- | --- |
| available | Installed on the machine | “available during the session” |
| active | Included in the effective session configuration | “session was exposed to” |
| observed | Invocation or loader event was directly captured | “observed in use” |
| caused | Not generally measurable | Never infer automatically |

Rules, root prompts, and active skills are composite context. RoboRepo may correlate their versioned exposure with outcomes but must not allocate portions of assistant output tokens to them.

Direct tool-result context cost remains attributable to the tool that produced the result, using the current result-size approximation. Clearly label this separately from total model tokens.

### 3. Hybrid filtering

Keep a compact global cohort bar and add a dedicated Analysis explorer.

Global filters define the cohort used by every panel:

- time range;
- harness;
- model;
- repository;
- saved experiment/cohort.

The Analysis explorer handles high-cardinality refinements:

- RoboRepo package and configuration version;
- skill and skill revision;
- tool, MCP server, functional tool group, and semantic operation;
- test scope and runner;
- marker-relative before/after window;
- branch, Git SHA, and configuration snapshot;
- task category, task scale, and phase;
- outcome status;
- metric.

Panel-local controls are permitted only for presentation or concepts unique to that panel, such as choosing calls versus duration in the testing panel. They must not silently redefine the global cohort.

### 4. Deterministic facts before synthesis

All portal alerts, comparisons, and experiment results must be computable without an LLM. Optional synthesis may explain those results, but cannot invent metrics, cohorts, confidence, or causal conclusions.

### 5. Advisory policies

Packages may define telemetry expectations, but policy violations remain advisory in this scope. Do not block tools or harness activity.

## Proposed storage architecture

Retain append-only local storage and the current dependency-free runtime.

Suggested paths under the existing telemetry state directory:

```text
telemetry/
  spool/
    claude.jsonl
    codex.jsonl
  events/
    markers.jsonl
  snapshots/
    <snapshot-id>.json
  experiments/
    <experiment-id>.json
  collector/
    ...existing cursors...
```

Do not move existing spool data in the first migration. Readers must accept schema-v2 records and the new schema side by side.

### Capture schema v3

Add fields without changing the meaning of existing fields:

```json
{
  "schema": 3,
  "capture_id": "cap_...",
  "call_id": "harness-call-id-or-derived-id",
  "config_snapshot_id": "cfg_...",
  "operation": {
    "category": "test",
    "runner": "npm",
    "scope": "full",
    "target": null,
    "signature": "hash",
    "failure_signature": "hash-or-null",
    "exit_status": "pass"
  },
  "phase": {
    "name": "debugging",
    "source": "inferred",
    "confidence": 0.83
  }
}
```

Requirements:

- `capture_id` is unique and stable.
- Prefer a harness-provided tool-use ID for `call_id`.
- When unavailable, derive a best-effort ID from session, tool, timestamp, and an incrementing cursor.
- Pair pre/post duration records by `call_id`, not only session.
- Preserve null/unknown instead of guessing.
- Do not store raw shell commands or full test output by default.
- Continue storing hashes, lengths, categories, bounded previews, and privacy-safe derived metadata.

### Marker schema

```json
{
  "schema": 1,
  "marker_id": "mark_...",
  "ts": "2026-07-19T23:10:00.000Z",
  "type": "change",
  "title": "Prevent full-suite debugging loops",
  "description": null,
  "repo": "roborepo",
  "branch": "main",
  "sha": "abc1234",
  "config_snapshot_id": "cfg_...",
  "packages": ["test-harness"],
  "skills": ["test-harness"],
  "tags": ["testing", "behavior"],
  "metric": "test.full_suite_calls_per_debug_phase",
  "expected_direction": "decrease",
  "supersedes": null
}
```

Automatically fill repository, branch, SHA, snapshot ID, and timestamp when available. User-supplied values override only optional descriptive fields, not machine-derived identity fields.

### Configuration snapshot schema

Snapshots are content-addressed and deduplicated. Capture the effective configuration, not merely repository source files.

Each snapshot should contain:

- snapshot ID and creation time;
- RoboRepo version/commit;
- harness name and harness version when detectable;
- active model when detectable at session start, with later captures allowed to override model per turn;
- enabled RoboRepo packages and package definition hashes;
- active rule source IDs and rendered-content hashes;
- installed/active skill IDs and content hashes;
- hook IDs and content/config hashes;
- commands and MCP configuration hashes;
- feature flags and relevant telemetry settings;
- source state needed to label configuration drift;
- a schema version.

Do not duplicate complete skill/rule text into every snapshot. Store normalized metadata and hashes. Existing repository or managed-cache sources provide the inspectable content.

Create the snapshot at `SessionStart` and reference it from later captures. If effective configuration changes during a session, create a new snapshot and use it for subsequent records.

### Experiment definition

```json
{
  "schema": 1,
  "experiment_id": "exp_...",
  "title": "Test-harness guidance v2",
  "start_marker_id": "mark_...",
  "end_marker_id": null,
  "primary_metric": "test.full_suite_calls_per_debug_phase",
  "expected_direction": "decrease",
  "guardrails": ["outcome.completion_rate", "outcome.verification_pass_rate"],
  "eligibility": {
    "task_categories": ["bug-fix", "build-tooling", "refactor"],
    "minimum_sessions_per_cohort": 10
  },
  "comparison": "previous-equivalent-window"
}
```

An experiment definition describes analysis intent. Its start/end remain marker events so they render naturally on the timeline.

## CLI design

### Marker command

Canonical command:

```bash
roborepo telemetry mark \
  --type change \
  --title "Prevent full-suite debugging loops" \
  --package test-harness \
  --skill test-harness \
  --metric test.full_suite_calls_per_debug_phase \
  --expect decrease
```

Required:

- `--type`;
- `--title`.

Optional repeatable fields:

- `--package`;
- `--skill`;
- `--tag`;
- `--metric`;
- `--expect increase|decrease|no-change`;
- `--description`;
- `--session`;
- `--phase` for phase markers;
- `--status` for outcome markers;
- `--supersedes`.

The command prints the created marker ID, timestamp, resolved repository/SHA, and snapshot ID. It must fail clearly for invalid enum values and never silently discard unknown flags.

### Convenience skill

Add a small RoboRepo skill that helps an agent create a meaningful marker, but keep the CLI as the source of truth.

The skill should:

- ask only for missing intent that cannot be derived;
- propose a concise title;
- associate likely packages/skills without claiming causation;
- suggest a primary metric and expected direction;
- invoke the CLI;
- report the marker ID.

Do not require a skill for ordinary use. A human must be able to create every marker directly through the CLI.

### Experiment commands

```bash
roborepo telemetry experiment start \
  --title "Test-harness guidance v2" \
  --metric test.full_suite_calls_per_debug_phase \
  --guardrail outcome.completion_rate \
  --minimum-sessions 10 \
  --expect decrease

roborepo telemetry experiment end <experiment-id>
roborepo telemetry experiment status [<experiment-id>]
```

`start` creates both the experiment definition and its marker. `end` appends an end marker and links it to the experiment. Status must show cohort size, eligibility, data-quality warnings, and whether the result is ready—not merely a provisional winner.

### Outcome command

```bash
roborepo telemetry mark \
  --type outcome \
  --session <session-id> \
  --status successful \
  --title "Portal refactor verified"
```

Supported outcome states:

- `successful`;
- `partial`;
- `failed`;
- `abandoned`;
- `unknown`.

Inferred outcomes must remain distinguishable from explicit outcomes.

### Existing command compatibility

Retain `install`, `stop`, `enable`, `disable`, `status`, `report`, `export`, `backup`, and `purge`. Update usage manifests and menus rather than adding undocumented command paths.

Backup, export, and purge must include markers, snapshots, and experiments. `purge --backup` must remain recoverable. Telemetry-only installs must still work even if configuration exposure is limited; missing snapshot dimensions should be reported as unavailable.

## Semantic tool-operation classification

Create a pure classifier module separate from the capture hot-path orchestration. The capture module may import it only if startup cost remains negligible.

### Initial categories

- `test`;
- `lint`;
- `typecheck`;
- `build`;
- `format`;
- `install`;
- `git`;
- `serve`;
- `file-read`;
- `file-write`;
- `search`;
- `mcp`;
- `other`.

### Test dimensions

- runner: `npm`, `pnpm`, `yarn`, `bun`, `node-test`, `vitest`, `jest`, `playwright`, `pytest`, shell script, or `unknown`;
- scope: `targeted`, `affected`, `full`, or `unknown`;
- safe target label when it can be derived without exposing a sensitive path;
- pass/fail/blocked/unknown;
- failure signature;
- duration;
- output-size estimate;
- whether an edit or changed failure signature occurred since the previous equivalent run.

### Classification rules

1. Prefer repository-declared command knowledge from `package.json`, Makefiles, scripts, and CI configuration.
2. Normalize wrappers such as `npm run`, `roborepo run`, and shell-script indirection.
3. Treat explicitly named test files, paths, filters, projects, or affected selectors as targeted/affected.
4. Treat a known repository-wide test script without selectors as full.
5. Return unknown when the command is ambiguous.
6. Store a rule/version identifier with the classification so historical data remains interpretable after classifier changes.

Never treat all `npm test` commands across all repositories identically without consulting repository command metadata.

## Intervening-work analysis

Repeated full-suite execution is actionable only when RoboRepo understands what happened between runs.

Track privacy-safe intervening signals:

- whether a write/edit tool completed;
- changed-file count and extension/category;
- whether Git diff fingerprint changed;
- whether a targeted test ran;
- whether the previous failure signature changed;
- whether the task phase changed;
- elapsed wall-clock time.

Derived testing findings:

- full-suite runs per session;
- full-suite runs per debugging phase;
- full-suite runs without an intervening edit;
- full-suite reruns with the same failure signature;
- percentage of captured tool time spent testing;
- targeted-to-full test ratio;
- time from full-suite failure to targeted reproduction;
- time from first failure to successful verification;
- finalization full-suite count;
- estimated tokens accumulated during testing activity.

Example deterministic finding:

> Testing consumed 51% of captured tool time. The full suite ran four times during debugging; three reruns had no intervening source edit or changed failure signature. Run one targeted reproduction after a failure and reserve the next full suite for the phase boundary.

## Phase detection

Use both explicit and inferred phases.

Supported phase names:

- `discovery`;
- `implementation`;
- `debugging`;
- `verification`;
- `finalization`;
- `unknown`.

Rules:

- Explicit phase markers take precedence from their timestamp forward until superseded.
- Inferred phases use explainable tool/activity patterns, not an opaque model.
- Store inference source, classifier version, and confidence.
- Low-confidence phases collapse to unknown in comparisons unless the user opts in.
- A session may move between phases more than once.

Initial inference examples:

- exploration/read/search with no edits → discovery;
- repeated edits with scoped validation → implementation;
- failing tests followed by edits and reruns → debugging;
- broad checks after implementation stabilizes → verification;
- final status checks, commits, and completion output → finalization.

Do not make the phase classifier responsible for determining whether the task succeeded.

## Outcomes and task cohorts

### Outcome signals

Capture or derive:

- explicit outcome marker;
- final verification status;
- completed, partial, failed, abandoned, or unknown;
- session end observed;
- user correction count when reliably detectable;
- retry count;
- time to first meaningful edit;
- time to passing targeted verification;
- time to passing final verification;
- tokens per completed task.

Never treat `Stop` alone as success.

### Task categories

Initial categories:

- documentation;
- UI;
- bug fix;
- feature;
- refactor;
- build/tooling;
- dependency/configuration;
- investigation;
- unknown.

### Task scale

Derive explainable scope dimensions:

- files and directories touched;
- insertions/deletions when Git data is available;
- localized versus cross-cutting;
- code, configuration, documentation, or generated-file mix;
- test surface affected.

Allow explicit correction through a marker or session-detail action. Preserve inferred and corrected values separately.

## Analysis engine

### Cohort model

Introduce a normalized filter object shared by CLI and portal analysis:

```json
{
  "time": { "range_ms": 604800000, "end": null },
  "harnesses": ["claude"],
  "models": ["sonnet"],
  "repos": ["roborepo"],
  "packages": [{ "id": "test-harness", "state": "active" }],
  "skills": [{ "id": "test-harness", "state": "active" }],
  "operations": ["test"],
  "phases": ["debugging"],
  "outcomes": ["successful", "partial"]
}
```

All panels must receive the same globally filtered event set. Analysis-specific refinements may produce a secondary result without changing unrelated page panels.

### Marker-relative comparisons

Replace the current midpoint-only regression as the preferred regression path.

For a selected change marker:

1. Resolve its timestamp and configuration snapshot.
2. Select eligible sessions before and after it.
3. Exclude sessions spanning the marker unless the analysis explicitly supports within-session phase comparison.
4. Match or stratify by harness, model, repository, task category, task scale, and outcome availability.
5. Use equal-duration or equal-session-count windows, selected explicitly and shown to the user.
6. Report cohort sizes and excluded-session reasons.
7. Retain midpoint regression as a labeled exploratory fallback when no marker is selected.

### Metrics registry

Create a declarative registry so alerts, experiments, CLI reports, and the portal share names, units, formatting, eligibility, and directionality.

Initial metric groups:

- Tokens: total, delta, tool-result context estimate, tokens per completed task.
- Time: session duration, captured tool duration, operation duration, time to first edit, time to verification.
- Calls: total tools, MCP calls, semantic-operation counts, calls per phase.
- Testing: full/targeted counts and ratios, redundant reruns, repeated failure signatures.
- Outcome: completion and verification rates, retries, corrections.
- Reliability: capture coverage, paired-call rate, known-model rate, known-snapshot rate.

Do not let UI components independently define formulas.

### Confidence and data quality

Every comparative finding returns:

- observation;
- evidence rows/aggregates;
- cohort definitions;
- sample sizes;
- effect size;
- baseline;
- data-quality issues;
- confidence label;
- interpretation labeled as inference;
- next action;
- a ready-to-apply Analysis filter state.

Initial labels:

- strong signal;
- emerging pattern;
- insufficient evidence;
- data-quality warning.

Suppress or downgrade conclusions when:

- cohorts are below their minimum size;
- model, snapshot, or outcome coverage is too low;
- capture coverage differs materially across cohorts;
- unmatched tool calls distort duration;
- one session dominates the result;
- task mix differs substantially;
- classifier confidence is low;
- an experiment is still collecting samples.

Use robust summaries such as median, percentile, rate, and trimmed mean where appropriate. Do not rely only on arithmetic means for heavy-tailed token or duration distributions.

### Actionable finding contract

Each insight must contain four user-visible layers:

1. **Observation:** measurable fact.
2. **Evidence:** values, cohorts, sample size, and effect size.
3. **Interpretation:** plausible explanation explicitly labeled as inference.
4. **Next action:** one concrete investigation, configuration change, or experiment.

Example:

> **Observation:** Full-suite runs increased from 1.3 to 3.8 per debugging phase after “Test-harness guidance v2.”  
> **Evidence:** 18 comparable build/tooling sessions using the same harness/model; emerging pattern.  
> **Interpretation:** The new wording may permit full-suite reruns during debugging.  
> **Next action:** Explicitly prohibit full-suite debugging loops and evaluate the next 10 eligible sessions.

No insight may say a skill or package “caused” the change unless the metric is a direct invocation property.

## RoboRepo package and skill correlation

### RoboRepo package identity

Add a separate concept from the existing MCP package rollup:

- `mcp_package_cost`: directly measured result context from an MCP server;
- `roborepo_package_exposure`: sessions whose effective snapshot included a RoboRepo package;
- `skill_exposure`: sessions whose snapshot included a skill;
- `observed_skill_use`: only when a harness or explicit loader emits a reliable event.

Rename portal labels and response fields carefully so old exports remain readable. A compatibility alias may be retained for one schema cycle.

### Skill-use limitations

Claude, Codex, and future harnesses may expose different skill invocation signals. Implement an adapter contract:

- `available` and `active` derive from the snapshot;
- `observed` derives only from an explicit harness event, tool invocation, or RoboRepo skill wrapper;
- reading a skill file may be supporting evidence but must not automatically be treated as proof the instructions influenced the response;
- unknown remains valid.

### Exposure comparisons

Permit statements such as:

> Sessions exposed to `test-harness@<hash-B>` averaged 1.4 full-suite debugging runs, compared with 3.8 for `<hash-A>`, after matching repository, model, harness, and task category.

Display the snapshot hashes, time windows, sample sizes, and unmatched dimensions. This is still correlation.

## Package telemetry policies

Allow an optional `telemetry.policies` section in package configuration:

```json
{
  "telemetry": {
    "policies": [
      {
        "metric": "test.full_suite_calls_per_debug_phase",
        "operator": "<=",
        "value": 1,
        "minimum_samples": 3,
        "severity": "warning"
      }
    ]
  }
}
```

Requirements:

- Validate metric IDs and operators when loading package definitions.
- Policies are attached to package exposure, not assumed global.
- Findings state whether the value violates an explicit policy or merely differs statistically.
- Policy findings link to filtered supporting sessions.
- Policies do not block commands in this implementation.

The `test-harness` package is the first candidate, but the policy mechanism must remain generic.

## Portal design

### Global filter bar

Extend the current server-side filter state with:

- model;
- repository;
- saved experiment/cohort.

Use compact buttons/selectors and show active-filter count. Provide “clear” and a readable cohort summary. Keep time panning behavior intact.

Filters must serialize into the URL so a filtered analysis can be copied, bookmarked, and restored after reload.

### Timeline markers

Overlay marker lines on the existing canvas timeline:

- distinct style by marker type;
- hover shows title, timestamp, SHA, packages/skills, and expected metric;
- click opens marker detail;
- overlapping markers cluster rather than becoming unreadable;
- selected experiment shades its active period;
- marker rendering respects the global time window.

Do not mutate marker positions client-side. The server supplies window-scoped markers.

### Action-item panel

Upgrade each deterministic insight row to show:

- severity;
- confidence/data-quality label;
- concise observation;
- evidence summary;
- next action;
- “open analysis” action;
- optional “mark change” or “start experiment” action when relevant.

The deeper-read feature remains secondary and receives only structured, deterministic summaries.

### Testing-efficiency panel

Add a first-class panel under warnings and abnormalities:

- testing share of captured tool time;
- full versus targeted runs;
- full-suite runs by phase;
- redundant reruns;
- unchanged failure-signature reruns;
- slowest sessions;
- direct links to session/transcript context.

The panel should lead with the most actionable abnormality rather than a comprehensive table.

### Analysis explorer

Add a collapsed-by-default or drawer-based explorer accessible from every insight and detail panel.

Structure:

1. Cohort A filters.
2. Cohort B or marker-relative comparison.
3. Metric selection.
4. Summary comparison.
5. Confidence/data-quality explanation.
6. Contributing sessions and tool calls.

Use exact filter chips for selected dimensions. Avoid placing every possible selector in the global header.

The explorer should answer:

- what was compared;
- what was excluded;
- whether the cohorts are comparable;
- which sessions dominate the result;
- where the user can inspect supporting events.

### Session detail

Extend the current session modal with:

- model history;
- configuration snapshot;
- active packages/skills;
- explicit versus inferred task category and outcome;
- phase timeline;
- semantic operation totals;
- testing-efficiency summary;
- markers inside or adjacent to the session;
- data-quality flags.

Retain the current “surface chat context,” copy-prompt, and transcript-open behavior.

### Framework and file organization

Preserve the established frameworkless architecture:

- `state.js`: pure formatting, filter serialization, and small selectors;
- `api.js`: requests only;
- `templates.js`: template cloning and slot filling;
- `renders.js`: panel orchestration;
- `chart.js`: canvas interaction and marker rendering;
- `panels.js` and `modals.js`: dialog controllers and modal data shaping;
- `app.js`: event wiring, shared view state, polling, and module orchestration.

Create focused modules when logic does not fit these responsibilities, for example `analysis-explorer.js`. Do not return to a monolithic `app.js`, add a build system, or introduce React/Vite for this feature.

## API changes

### `/api/data`

Extend query parsing to accept normalized multi-value filters. Retain existing `range`, `end`, and `harness` compatibility.

Add response fields including:

- available models, repositories, packages, skills, operations, phases, outcomes, and experiments;
- window-scoped markers;
- testing-efficiency summary;
- package/skill exposure rollups;
- data-quality summary;
- enriched actionable insights.

Ensure `version` changes when relevant markers, experiments, snapshots, or filters change—not only when spool capture count changes.

### Analysis endpoint

Add a dedicated endpoint for high-dimensional comparisons rather than inflating `/api/data` for every explorer interaction:

```text
POST /api/telemetry/analysis
```

Body:

```json
{
  "cohort_a": {},
  "cohort_b": {},
  "metric": "test.full_suite_calls_per_debug_phase",
  "marker_id": null
}
```

The server remains loopback-only. Validate request size, known metric IDs, enum values, and filter cardinality. Return structured evidence and never raw transcript content.

### Marker endpoints

Add local endpoints for portal-created markers:

- `POST /api/telemetry/markers`;
- `GET /api/telemetry/markers` through filtered data or a dedicated route;
- `POST /api/telemetry/markers/:id/supersede` if the simple route layer can support it cleanly.

All mutations use the same validation and persistence functions as the CLI.

### Experiment endpoints

Add create/end/status operations backed by shared CLI-domain functions. Do not duplicate experiment rules in the browser.

## CLI report changes

The terminal report must remain useful and numerically consistent with the portal.

Add sections for:

- active cohort summary;
- data quality;
- recent markers;
- testing efficiency;
- marker-relative regressions;
- outcome-normalized model/package comparisons;
- experiment readiness/results.

Retain current insight-first ordering, tool/group cost, spike analysis, loops, sessions, and supporting breakdowns.

Add filter flags only when they share the normalized cohort implementation. Do not create a second CLI-only filtering system.

## Implementation phases

### Phase 0 — Grounding and characterization

1. Use jcodemunch to map the current telemetry and configuration flows.
2. Capture representative schema-v2 fixtures for Claude and Codex.
3. Characterize current analyzer outputs so compatibility tests can detect accidental changes.
4. Document hook-field differences, especially tool-use IDs, commands, exit status, model reporting, and transcript timing.
5. Identify which effective configuration data is already available through `readConfigSnapshot` and which must be added.

Exit criteria:

- current behavior is covered by fixtures;
- schema differences between harnesses are documented;
- no implementation assumption depends on one harness only.

### Phase 1 — Domain schemas and persistence

1. Add schema validators and normalizers for captures, markers, snapshots, and experiments.
2. Add stable IDs and append-only persistence helpers.
3. Implement content-addressed configuration snapshots.
4. Update backup/export/purge.
5. Keep schema-v2 read compatibility.

Exit criteria:

- existing spools still analyze;
- new records round-trip;
- snapshots deduplicate;
- malformed records degrade safely and produce a data-quality count.

### Phase 2 — CLI markers and experiments

1. Implement shared marker domain functions.
2. Add `telemetry mark`.
3. Add experiment start/end/status.
4. Update command manifest, help, and menus.
5. Add the optional marker skill backed by the CLI.

Exit criteria:

- a user can mark the test-harness change from any Git checkout;
- automatic metadata is correct;
- invalid input is rejected;
- markers are visible in export and backup.

### Phase 3 — Capture v3 and operation classification

1. Add capture/call IDs.
2. Replace session-only duration pairing with call-aware pairing.
3. Add configuration snapshot references.
4. Add pure semantic command classification.
5. Capture exit/failure signatures where harness data permits.
6. Record classification version and unknowns.

Exit criteria:

- full and targeted RoboRepo test commands classify correctly;
- ambiguous commands remain unknown;
- privacy tests confirm raw commands/results are not persisted;
- concurrent call fixtures do not overwrite duration cursors.

### Phase 4 — Phases, intervening work, tasks, and outcomes

1. Implement explicit phase markers.
2. Add explainable phase inference.
3. Track edit/diff/failure-signature transitions.
4. Implement task category and scale inference.
5. Implement outcome markers and conservative inference.
6. Surface coverage/confidence for each derived dimension.

Exit criteria:

- the screenshot scenario is represented as full-suite runs during debugging;
- redundant runs can be distinguished from runs after meaningful changes;
- unknown outcome/phase remains valid.

### Phase 5 — Metrics, cohorts, and findings

1. Add the metric registry.
2. Add normalized cohort filtering.
3. Preserve current spike/tool/group analysis through the new filter pipeline.
4. Add testing metrics.
5. Add marker-relative comparisons.
6. Add robust summaries, exclusion reasons, data-quality gates, and finding contracts.
7. Add package telemetry policy evaluation.

Exit criteria:

- CLI and portal compute identical metrics;
- every comparative finding exposes cohorts and sample size;
- insufficient data produces no false conclusion;
- correlations use exposure wording.

### Phase 6 — Portal global filters and markers

1. Extend URL-backed global filter state.
2. Render model/repository/experiment filters.
3. Add marker overlays and detail modals to the existing chart.
4. Update the data version token and polling behavior.
5. Preserve canvas pan, mode toggles, session click-through, resize, and theme behavior.

Exit criteria:

- all existing panels reflect the same global cohort;
- bookmarked filters restore correctly;
- marker display remains usable when clustered.

### Phase 7 — Action items, testing panel, and explorer

1. Upgrade insight rows to the actionable finding contract.
2. Add testing-efficiency rendering.
3. Build the Analysis explorer.
4. Add filtered supporting session/tool-call drill-down.
5. Extend session detail.
6. Keep deeper-read synthesis fact-bound.

Exit criteria:

- each alert answers what happened, why it matters, evidence quality, and next action;
- “open analysis” reproduces the alert's exact cohort and metric;
- no unsupported causal language appears.

### Phase 8 — Documentation, migration, and hardening

1. Update telemetry reference and lifecycle documentation.
2. Document marker and experiment workflows.
3. Document attribution limitations and privacy behavior.
4. Add schema/version migration notes.
5. Run performance checks against capped large spools.
6. Review all new code paths with jcodemunch changed-symbol/reference queries.

Exit criteria:

- a new user can create a marker, run an experiment, and interpret the result;
- existing installs require no destructive migration;
- portal response time remains acceptable on maximum supported spool sizes.

## Verification strategy

Follow the repository's test-harness rule: use the smallest affected checks during development and reserve the full suite for phase boundaries/final verification.

### Unit tests

Cover pure modules with fixtures:

- capture/marker/snapshot/experiment normalization;
- content-addressed snapshot identity;
- CLI parsing and validation;
- command classification across supported runners;
- ambiguous classification;
- phase inference;
- intervening-edit and failure-signature logic;
- metric registry formulas;
- cohort filters;
- marker-relative windows;
- confidence/data-quality gates;
- package policy evaluation;
- causal-language safeguards.

### Integration tests

Cover:

- Claude and Codex hook payloads;
- call-aware duration pairing;
- schema-v2 plus schema-v3 mixed spools;
- marker CLI persistence;
- experiment lifecycle;
- backup/export/purge completeness;
- telemetry-only installs with partial configuration visibility;
- API validation and consistent filtered responses;
- data version changes from marker-only writes.

### Portal tests

Use real-browser Playwright checks against `roborepo serve` after each structural UI phase:

- existing telemetry page still loads;
- global filters scope every panel;
- URL state round-trips;
- markers render, cluster, and open;
- chart drag/hover/click behavior remains intact;
- testing findings open matching evidence;
- Analysis explorer reproduces an alert;
- dialog keyboard/backdrop behavior remains correct;
- dynamic content is rendered safely with `textContent`/templates;
- theme and narrow-layout behavior remain correct.

### Scenario fixture: full-suite debugging loop

Create a deterministic fixture containing:

1. a build/tooling task;
2. a full test-suite failure;
3. four full-suite calls during debugging;
4. three calls without an intervening edit or changed failure signature;
5. one targeted reproduction;
6. a final successful full-suite run;
7. a test-harness change marker between comparison cohorts.

Expected outputs:

- testing share of tool time;
- full-suite calls per debugging phase;
- redundant rerun count;
- unchanged-failure count;
- finalization run separated from wasteful debugging runs;
- marker-relative comparison;
- correlation-only wording for the test-harness skill revision;
- concrete next action.

### Final verification

At completion:

1. Run all targeted unit and integration checks.
2. Run real-browser portal verification.
3. Run the repository's full verification suite once at the stopping point.
4. Confirm documentation and command manifests match behavior.
5. Use jcodemunch to review changed symbols and affected references.
6. Verify exact changed files and report commands with pass/fail/blocked status.

## Performance constraints

- Keep the hot capture import graph small.
- Do not rescan or serialize the entire effective configuration on every tool call.
- Snapshot once at session start and on detected configuration change.
- Cache normalized repository command knowledge by repository/config fingerprint.
- Keep analysis pure where practical and avoid repeated parsing inside individual panel computations.
- Bound comparison cardinality and API request size.
- Preserve spool caps and add retention rules for orphaned snapshots only after proving they are unreferenced by captures, markers, or experiments.

## Privacy and security

- Continue binding the portal to loopback only.
- Do not store full prompts, shell commands, tool results, transcripts, or absolute paths by default.
- Hash commands, failure signatures, paths, remotes, and configuration content.
- Store only bounded previews already permitted by current behavior.
- Clearly distinguish estimates from provider token accounting.
- Expose deletion/export behavior for every new record type.
- Validate all portal mutation inputs server-side.
- Never shell-interpolate marker titles, tags, or filter values.
- Avoid unbounded cardinality from raw command strings, paths, or arbitrary model output.

## Documentation deliverables

Update or add:

- telemetry service reference;
- CLI reference and command manifest;
- event-marker guide;
- experiment guide;
- telemetry schema/version reference;
- attribution and confidence guide;
- privacy/data-retention documentation;
- package telemetry-policy documentation;
- portal filter and Analysis explorer help text.

Documentation must explicitly state:

- tool-result context estimates are based on result size;
- total session tokens are transcript/provider counters when available;
- package/skill exposure comparisons are correlations;
- missing data remains unknown;
- midpoint regression is exploratory, while marker-relative comparison is intentional;
- a higher-cost model must be evaluated against successful outcomes, not tokens alone.

## Out of scope

- Automatic causal claims about rules, skills, packages, or models.
- Allocating assistant-output tokens among individual prompt fragments.
- Blocking tool calls based on telemetry policies.
- Full raw-command or transcript retention.
- Opaque machine-learning anomaly detection.
- Cloud synchronization or multi-user telemetry aggregation.
- Replacing the local JSONL architecture with an external database.
- Introducing React, Vite, or a portal build step.

## Acceptance criteria

The work is complete when:

1. A user can create a timestamped, metadata-rich marker through the CLI.
2. Markers appear on the telemetry timeline and can drive before/after comparisons.
3. Sessions reference deduplicated effective-configuration snapshots.
4. Model, RoboRepo package exposure, skill exposure, tools, semantic operations, phases, task categories, and outcomes are usable analysis dimensions when known.
5. Full versus targeted test activity is classified conservatively.
6. RoboRepo detects repeated full-suite debugging runs and considers intervening edits/failure changes.
7. Token, time, call, testing, outcome, and reliability metrics share one registry.
8. Global filters remain compact while the Analysis explorer supports deeper refinement.
9. Every alert exposes evidence, cohort, sample size, confidence/data-quality, and a concrete next action.
10. Package/skill findings use correlation language unless invocation is directly observed.
11. CLI and portal results agree for the same cohort.
12. Existing schema-v2 telemetry remains readable.
13. Backup, export, and purge cover all new data.
14. The current frameworkless, dependency-free, local-only portal architecture is preserved.
15. Implementation and final impact review use jcodemunch as required.

## Recommended first real experiment

After implementation, use the screenshot scenario as the first production validation:

1. Record or reconstruct a baseline cohort using the current `test-harness` skill revision.
2. Add the explicit rule that a failed full-suite run must be followed by a targeted reproduction and that another full suite should wait until a stopping point.
3. Create a `change` marker attached to `test-harness` with primary metric `test.full_suite_calls_per_debug_phase` and guardrails for completion and verification success.
4. Collect at least the configured minimum number of comparable build/tooling, refactor, or bug-fix sessions.
5. Compare the same repository/harness/model/task categories where possible.
6. Report whether full-suite debugging runs fell, whether completion remained stable, and what data limitations remain.

This validates the entire chain: configuration snapshot, event marker, semantic test classification, phase detection, outcome guardrails, cohort comparison, actionable alert, and drill-down evidence.

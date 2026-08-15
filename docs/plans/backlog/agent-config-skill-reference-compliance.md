---
id: k7p3m2q
priority: high
next_action: Update technical-writing SKILL.md so write always loads review-loop.md and owns create/edit/revise workflows
blocked_by: []
depends_on: []
related: []
reviewed_commit: 677371c6e95234caa69d532f799cfcb16f4c438e
---

# Make Skill Reference Loading and Validation Reliable

## Summary

RoboRepo's documentation skills currently rely too heavily on agents following chains of references correctly. In repeated document-authoring sessions, important instructions have been skipped even when the user explicitly asked the agent to use the relevant skills. The failures have included incorrect plan filenames, incomplete plan frontmatter, omitted technical-writing Validator behavior, and missed representation or framework-specific guidance.

This plan makes critical skill requirements harder to skip. The main design rule is:

> **References provide depth; `SKILL.md` provides gates.**

Rules that determine whether an artifact is valid must be visible from the skill entry point, required references must be loaded by the mode that needs them, and rules that can be checked deterministically should be enforced in code rather than left entirely to model memory.

The work applies first to `plan-docs` and `technical-writing`, then establishes a reusable pattern for other RoboRepo skills.

## Goals

- [ ] Make required reference loading explicit and difficult to bypass during skill execution.
- [ ] Make `technical-writing write` include the Creator/Validator completion loop instead of requiring a separately inferred review step.
- [ ] Make plan naming, frontmatter, lifecycle, and other deterministic plan rules mechanically enforceable where practical.
- [ ] Ensure plan creation resolves the repository namespace and target filename before drafting begins.
- [ ] Make validator output observable enough that users can tell whether validation actually ran and what it checked.
- [ ] Preserve focused references instead of flattening every detailed instruction into `SKILL.md`.
- [ ] Establish a convention that can be applied to additional skills when similar failures are observed.
- [ ] Add regression coverage proving that required references and validation gates cannot silently disappear from the workflow.

## Non-goals

- Rework the package multi-source distribution design.
- Move all reference content into top-level `SKILL.md` files.
- Require every skill to read every reference on every invocation.
- Build a general-purpose LLM workflow engine.
- Make qualitative technical-writing judgments fully deterministic.
- Change the lifecycle semantics of plan documents.
- Replace Markdown skill instructions with application code where model judgment is still required.

## Current State

### Reference loading is mode-dependent

`technical-writing/SKILL.md` currently defines two named modes: `write` and `review`. There is no separate `edit` or `revise` entry point, and this plan should not add one. `write` is the artifact-producing mode and should cover creating, editing, revising, restructuring, and updating durable documentation. `review` is the read-only evaluation mode for inspecting an existing document and reporting violations without changing it.

Today, `write` requires `doc-shapes.md`, `section-guidance.md`, `representation.md`, and `anti-patterns.md`. The Creator/Validator instructions live in `references/review-loop.md`, but that reference is explicitly required by `review`, not `write`.

```mermaid
flowchart LR
    U[User requests durable documentation] -->|invokes| W[technical-writing write]
    W -->|loads| R[authoring references]
    R -->|guides| D[Creator draft]
    D -->|may skip| V[review-loop Validator]
```

An agent can therefore follow the documented `write` reference list literally and still deliver a document without ever loading the Validator contract.

### Critical plan rules are deep in references

`globals/packages/plan-docs/skills/plan-docs/SKILL.md` correctly requires `references/plan-schema.md` for named modes. The schema contains artifact-validity rules that are easy to miss when they remain only in the deeper reference:

| Rule area | Current contract |
| --- | --- |
| Frontmatter | `id`, `priority`, `next_action`, `blocked_by`, `depends_on`, `related`, and `reviewed_commit` are the supported plan fields |
| Forbidden metadata | lifecycle/status timestamps and similar derived metadata do not belong in frontmatter |
| Lifecycle | lifecycle comes from `docs/plans/<lifecycle>/`, not a `status` field |
| Naming | filename is `<namespace>-<slug>.md`; project namespaces come from `docs/plans/plans-config.json` |
| Identity | new plans use an opaque 6–8 character lowercase base36 ID that survives renames and moves |
| H1 | title is reader-facing prose rather than a mechanically expanded filename |

The entry-point skill says to read the schema, but it does not restate the critical creation gates. The current programmatic validator also does not enforce filename/namespace correctness.

### Programmatic plan validation is incomplete

The plan-docs validator already handles frontmatter parsing, IDs, priorities, required sections, lifecycle readiness, dependencies, and blockers. Its finding catalog does not currently enforce filename/namespace correctness. A structurally valid plan can therefore use an invalid or inconsistent filename and still receive a finding-free validation result.

### Technical-writing validation is procedural rather than enforced

`globals/packages/technical-writing/skills/technical-writing/references/review-loop.md` defines two distinct roles:

| Role | Responsibility |
| --- | --- |
| Creator | Writes and revises the document |
| Validator | Reads applicable rules and reports violations only |

The Validator must not rewrite the document, each pass must be surfaced in chat, and the loop continues until the Validator reports no violations or reaches the documented pass cap. Today, running that loop still depends on the authoring agent remembering to load it.

There is also a concrete scope mismatch: `technical-writing write` requires `references/representation.md`, but `review-loop.md` does not include `representation.md` in its explicit Validator rule list. A document can therefore be authored under a representation rule that the Validator is not clearly required to check.

`globals/packages/technical-writing/skills/technical-writing/agents/openai.yaml` currently contains only a description. It does not encode a separate executable Validator contract, so this plan must not assume the agent metadata already provides role separation.

### Omitted references can materially change implementation plans

The paired skills contain implementation constraints that materially affect a plan when they apply: `technical-writing` requires verb-labeled Mermaid edges and representation choices matched to content; framework-less JavaScript markup uses real HTML `<template>` elements instead of nested DOM builders; shared CLI/portal logic belongs in shared domain code rather than presentation layers; and test changes should begin with the smallest repository-native check that proves the behavior.

Reference loading therefore affects implementation correctness, not only formatting quality.

## Proposed Design

### 1. Treat critical rules as entry-point gates

A skill may keep detailed instructions in references, but its `SKILL.md` must name the conditions that must be true before the task can be called complete.

| Level | Purpose | Example |
| --- | --- | --- |
| Entry-point gate | Prevent invalid completion | “Do not deliver a durable document until the Validator loop passes.” |
| Required reference | Full procedure and examples | `references/review-loop.md` |
| Deterministic validator | Enforce machine-checkable invariants | filename namespace or frontmatter validation |

Do not duplicate an entire reference into `SKILL.md`; repeat only enough of the invariant to make skipping the reference visibly noncompliant.

### 2. Keep two technical-writing entry points with a clear boundary

Keep the mode surface intentionally small:

| Entry point | Owns | Does not own |
| --- | --- | --- |
| `write` | create, edit, revise, restructure, and update durable documentation; then validate it | read-only review with no requested edits |
| `review` | inspect an existing document and report violations without modifying it | document creation or revision |

Do not add a separate `edit` or `revise` mode. Those are normal forms of `write`, and splitting them into more entry points would make mode selection harder without adding a meaningful workflow distinction.

Change the `write` contract so it always reads `review-loop.md` and includes validation before delivery.

```mermaid
flowchart LR
    U[User requests durable documentation] -->|selects| W[Write mode]
    W -->|loads| A[authoring references]
    W -->|loads| L[review-loop.md]
    A -->|guides| C[Creator draft]
    C -->|hands draft to| V[Validator pass]
    L -->|defines| V
    V -->|reports violations| C
    V -->|reports zero violations| O[Deliver document]
```

Required behavior:

- The Creator owns document edits.
- The Validator is read-only and returns findings.
- The Validator checks every applicable technical-writing rule, not an arbitrary subset.
- Every Validator pass is surfaced to the user.
- A failed pass returns to the Creator.
- The revised artifact, not the original draft, is validated on the next pass.
- The document is not presented as complete until the loop reaches zero findings or the documented pass cap is reached.
- `write` covers both new documents and requested edits/revisions to existing documents.
- Do not introduce a separate `edit` or `revise` mode.
- `review` remains available only for read-only evaluation of an existing document without modifying it.

### 3. Resolve plan identity before drafting

For `plan-docs create`, add an explicit pre-draft checkpoint.

```mermaid
flowchart LR
    R[Resolve repository] -->|reads| C[plans-config.json]
    C -->|chooses| N[namespace]
    N -->|forms| F[target filename]
    F -->|pairs with| H[reader-facing H1]
    H -->|allows| D[drafting]
```

Before writing plan body content, the agent must establish the plan identity and minimal frontmatter contract. Creation still begins in `docs/plans/backlog/`; if the user also asked to start the plan, the workflow validates the backlog plan first and then runs the start workflow to move the same stable ID into `docs/plans/active/`.

| Field or decision | Required behavior |
| --- | --- |
| `id` | Generate one opaque 6–8 character lowercase base36 ID; never derive it from the title or filename |
| `priority` | Use only `high`, `medium`, `low`, or `none` |
| `next_action` | Non-empty for a ready backlog plan and for an active plan |
| `blocked_by` | Always an array |
| `depends_on` | Always an array |
| `related` | Always an array |
| `reviewed_commit` | Record only a commit deliberately reviewed against the plan; leave empty when no such review occurred |
| Lifecycle | Derive from the folder; never add a `status` field |
| Namespace | Prefer the more-specific project namespace from `docs/plans/plans-config.json` |
| Filename | `<namespace>-<specific-slug>.md`, with no lifecycle/status/date/version suffix |
| H1 | Reader-facing outcome prose, not a filename transformation |

Do not add `status`, `validated`, `updated_at`, `created_at`, `owner`, `percent_complete`, `estimated_hours`, or `tags` unless the plan schema is intentionally changed first.

### 4. Add deterministic filename and namespace findings to plan-docs

Extend the plan-docs finding catalog and validation pipeline for rules code can prove.

| Finding | Condition |
| --- | --- |
| `INVALID_PLAN_FILENAME` | Filename is not lowercase hyphenated Markdown with namespace + slug |
| `UNKNOWN_PLAN_NAMESPACE` | Prefix is neither a universal namespace nor a configured project namespace |
| `FORBIDDEN_PLAN_FILENAME_SUFFIX` | Filename encodes prohibited lifecycle/status/date/version-style suffixes |

Do not mechanically judge whether an H1 is good prose. Programmatic validation may verify that one H1 exists; technical-writing review owns prose quality.

### 5. Keep one source of truth for deterministic rules

The plan-docs domain should expose a shared naming validator consumed by plan snapshot validation, lifecycle readiness checks, repair prompts, CLI presentation, portal presentation, and tests.

```mermaid
flowchart LR
    P[Plan path] -->|passes to| N[Naming validator]
    C[plans-config.json] -->|configures| N
    N -->|emits| F[Structured findings]
    F -->|feeds| CLI[CLI]
    F -->|feeds| UI[Portal]
    F -->|feeds| RP[Repair prompt]
```

This matches the existing findings architecture, which is already intended to prevent validation wording from drifting across consumers.

### 6. Make qualitative Validator coverage explicit

For a single durable technical document, the Validator should resolve this rule set explicitly:

| Rule source | When required |
| --- | --- |
| Core Writing Philosophy in `SKILL.md` | Always |
| `doc-shapes.md` | Non-plan documents |
| `plan-docs` schema | Plans under `docs/plans` instead of generic doc shapes |
| `section-guidance.md` | Durable document review |
| `representation.md` | Durable document review |
| `anti-patterns.md` | Durable document review |
| `doc-organization.md` | Only when revising a documentation set |
| applicable paired skills | When explicitly requested or materially relevant to the implementation guidance |

The report format remains:

```text
<rule/reference> — <location> — <violation>
```

A successful pass explicitly reports that no violations were found.

### 7. Make paired-skill references part of validation scope

When the user explicitly asks for paired implementation skills, those skills are not merely brainstorming context.

| Skill | Plan impact |
| --- | --- |
| `plan-docs` | schema, lifecycle, filename, namespace, readiness |
| `technical-writing` | organization, representations, reader clarity, review loop |
| `code-style` | module ownership, orchestration/execution boundaries, reuse |
| `javascript-typescript` | ESM/JS conventions and framework-less markup rules when applicable |
| `test-harness` | test selection, observable behavior, regression strategy |

References remain conditional. For example, `javascript-typescript/references/framework-less-markup.md` is required only when implementation touches framework-less DOM structure.

### 8. Make plan creation run both validation layers

A plan is both a managed lifecycle artifact and a durable technical document. `plan-docs create` should therefore orchestrate both validation layers instead of expecting the user to remember a second command.

```mermaid
flowchart LR
    U[User requests a plan] -->|invokes| C[plan-docs create]
    C -->|creates in| B[backlog]
    B -->|runs| P[plan-docs schema and readiness validation]
    P -->|reports findings to| R[Creator revision]
    P -->|reports zero findings to| T[technical-writing Validator]
    T -->|reports violations to| R
    R -->|re-runs| P
    T -->|reports zero violations| D[validated backlog plan]
    D -->|when user requested start| S[plan-docs start]
    S -->|moves stable id to| A[active]
```

The two validators have different ownership:

- `plan-docs` checks deterministic schema, lifecycle, relationship, naming, and repository-consistency rules.
- `technical-writing` checks qualitative document rules such as organization, representation, anti-patterns, and reader clarity.

A clean technical-writing report must not override a plan-docs finding, and a mechanically valid plan must not bypass the qualitative Validator.

### 9. Add reference-loading observability

For workflows RoboRepo itself generates or launches, record or surface selected skill, selected mode, required reference paths, applicable paired skills, and validation result.

Do not capture private model reasoning. If a harness cannot prove a reference was actually read, report the expected reference set rather than falsely claiming execution evidence.

### 10. Strengthen skill authoring conventions

Durable RoboRepo skills should follow one consistent contract:

| Rule | Purpose |
| --- | --- |
| Put concise completion gates in `SKILL.md` | Makes invalid completion visibly noncompliant even before a deep reference is read |
| Put procedures, examples, and edge cases in references | Preserves depth without bloating the entry point |
| List every required reference for each named mode | Removes inference from reference routing |
| Load mandatory completion references from the artifact-producing mode | Prevents a required finishing step from becoming unreachable |
| Do not require a second inferred mode to finish the first | Keeps the user-facing invocation contract simple |
| Mechanically enforce deterministic invariants | Moves filename/frontmatter/schema correctness out of model memory |
| Keep qualitative review in a read-only Validator pass | Separates authoring from grading |
| Add regression coverage for routing and validators | Prevents future skill edits from silently dropping the contract |

## Affected Repository Files

Verified current implementation surfaces at `reviewed_commit`:

| Area | Current path | Planned use |
| --- | --- | --- |
| technical-writing mode routing | `globals/packages/technical-writing/skills/technical-writing/SKILL.md` | make `write` load the review loop and define write/review boundaries |
| technical-writing Validator | `globals/packages/technical-writing/skills/technical-writing/references/review-loop.md` | include the complete applicable rule set, including representation |
| technical-writing agent metadata | `globals/packages/technical-writing/skills/technical-writing/agents/openai.yaml` | investigate whether existing metadata can strengthen role separation without inventing unsupported schema |
| plan-docs entry point | `globals/packages/plan-docs/skills/plan-docs/SKILL.md` | surface creation completion gates |
| plan schema | `globals/packages/plan-docs/skills/plan-docs/references/plan-schema.md` | remain authoritative for frontmatter, naming, namespace, and lifecycle rules |
| create workflow | `globals/packages/plan-docs/skills/plan-docs/references/workflow-create.md` | create in backlog, use minimal frontmatter, validate readiness |
| start workflow | `globals/packages/plan-docs/skills/plan-docs/references/workflow-start.md` | move a validated selected plan from backlog to active while preserving ID |
| validate workflow | `globals/packages/plan-docs/skills/plan-docs/references/workflow-validate.md` | include naming/namespace and repository-consistency checks |
| findings catalog | `modules/plan-docs/findings.mjs` | add structured naming findings |
| plan-doc domain orchestration | `modules/plan-docs/index.mjs` | consume naming validation without embedding all naming rules in this already-large module |
| lifecycle policy | `modules/plan-docs/lifecycle-policy.mjs` | consume naming findings where lifecycle readiness needs them |
| repair prompt | `modules/plan-docs/repair-prompt.mjs` | receive the same structured findings rather than duplicate rule text |
| plan tests | `scripts/test/plan-docs-check.mjs`, `scripts/test/plan-docs-findings-check.mjs`, `scripts/test/plan-docs-repair-check.mjs` | regression coverage for new plan rules |

Prefer a focused new module such as `modules/plan-docs/naming.mjs` for deterministic filename/namespace logic rather than adding another responsibility to `modules/plan-docs/index.mjs`. Confirm the final module boundary against local conventions during implementation.

## Implementation Plan

### Phase 1 — Fix technical-writing completion semantics

- [ ] Define `technical-writing write` as the single artifact-producing mode for create, edit, revise, restructure, and update requests.
- [ ] Do not add separate `edit` or `revise` entry points.
- [ ] Add `references/review-loop.md` to the required reference set for `technical-writing write`.
- [ ] Add an entry-point gate stating that durable write/revise work is not complete until the Creator/Validator loop passes or reaches its documented cap.
- [ ] Define `technical-writing review` as read-only evaluation that reports violations without editing the document.
- [ ] Make successful and failed Validator report behavior explicit in the top-level workflow.

### Phase 2 — Strengthen plan-docs creation gates

- [ ] Add an explicit pre-draft namespace/filename/H1 checkpoint to `plan-docs create`.
- [ ] State at the entry point that `docs/plans/plans-config.json` must be read before creating or renaming a plan when present.
- [ ] Keep detailed naming rules authoritative in `plan-schema.md`.
- [ ] Keep `plan-docs create` backlog-only; when the user also requested start, validate the new backlog plan and then invoke the start workflow to move the same stable ID into `active`.
- [ ] Ensure lifecycle remains folder-derived and is never duplicated into frontmatter.

### Phase 3 — Add programmatic naming validation

- [ ] Add a shared naming-validation unit in the plan-docs domain.
- [ ] Load universal namespaces plus repository project namespaces.
- [ ] Add structured finding definitions for invalid filename shape, unknown namespace, and prohibited suffixes.
- [ ] Feed findings through existing validation, portal/API, and repair-prompt paths.
- [ ] Add deterministic fixtures for repositories with and without `plans-config.json`.

### Phase 4 — Tighten the technical-writing Validator contract

- [ ] Update `review-loop.md` to enumerate the minimum applicable reference set rather than relying only on “read every rule.”
- [ ] Fix the current Validator scope mismatch by explicitly adding `representation.md`.
- [ ] Explicitly include `representation.md` in Validator coverage.
- [ ] Define how paired implementation skills contribute constraints to validation.
- [ ] Keep the Validator read-only.
- [ ] Require each pass to identify reference/rule, document location, and violation.
- [ ] Preserve the 10-pass cap.
- [ ] Inspect `agents/openai.yaml` consumption before changing it; strengthen role metadata only if the existing schema supports that behavior.

### Phase 5 — Integrate plan creation with both validators

- [ ] Update `plan-docs create` instructions so a durable plan runs plan-docs validation and the technical-writing Validator before delivery.
- [ ] Define retry ordering: plan-docs findings or technical-writing violations return to the Creator; the revised draft is rechecked.
- [ ] If the user requested the plan be started, run the start workflow only after the backlog artifact has passed the required creation checks.
- [ ] Preserve the same stable `id` across the backlog-to-active move.
- [ ] Surface the technical-writing Validator report on every pass as required by `review-loop.md`.

### Phase 6 — Add skill-routing regression coverage

- [ ] Add characterization tests for the reference matrix declared by `technical-writing`.
- [ ] Add characterization tests for the reference matrix declared by `plan-docs`.
- [ ] Test that `technical-writing write` includes `review-loop.md`.
- [ ] Test that create/edit/revise requests resolve to `write` rather than requiring separate modes.
- [ ] Test that `technical-writing review` remains read-only and does not imply document mutation.
- [ ] Test that `plan-docs create` requires naming/schema references and repository namespace configuration.
- [ ] Test that plan creation runs deterministic plan validation and the technical-writing Validator contract before an optional start transition.
- [ ] Test naming findings through the plan-docs domain.
- [ ] Prefer externally meaningful workflow/config output over internal helper-call assertions.

### Phase 7 — Add skill authoring guidance and structural audit support

- [ ] Document the “references provide depth; `SKILL.md` provides gates” convention in maintainer guidance.
- [ ] Inspect the current skill/package validation ownership before choosing where a new structural audit belongs.
- [ ] Add a structural check that can detect problems such as a mandatory completion reference unreachable from an artifact-producing mode.
- [ ] Do not assume a dedicated audit subsystem already exists; choose the ownership from verified current validation boundaries.
- [ ] Keep audit findings structural rather than attempting to judge arbitrary prose semantics mechanically.

### Phase 8 — Add lightweight runtime observability

- [ ] Identify workflows where RoboRepo controls the prompt/reference set strongly enough to report expected resources accurately.
- [ ] Surface selected skill, mode, required references, and validation result in an existing diagnostics/reporting surface where appropriate.
- [ ] If this adds framework-less portal markup, follow the existing real-HTML `<template>` + slot-fill convention; do not build nested multi-element structures with JavaScript DOM-builder calls or runtime HTML strings.
- [ ] Do not claim a model read a reference when the harness cannot prove it.
- [ ] Do not capture or persist private model reasoning.

## Validation

### Focused behavior

- [ ] `technical-writing write` owns create/edit/revise/update behavior and requires `review-loop.md`.
- [ ] No separate `edit` or `revise` mode is introduced.
- [ ] `technical-writing review` continues to work independently as a read-only evaluation mode.
- [ ] `plan-docs create` requires namespace resolution before target filename creation.
- [ ] Invalid plan filenames emit structured findings.
- [ ] Unknown project namespaces emit structured findings.
- [ ] Valid existing plans do not gain false-positive naming findings.
- [ ] Legacy plan IDs remain untouched.
- [ ] Plan lifecycle still derives only from the folder.
- [ ] Repair prompts receive the same naming findings exposed by the domain.

### Test design

- Use repository-native test scripts discovered from `package.json`.
- For each behavior change or bug fix, add or identify the smallest regression check first and run it before implementation to prove it catches the old behavior.
- Assert observable reference matrices, findings, generated repair information, or user-visible workflow behavior rather than incidental internal calls.
- Use isolated temporary plan repositories for plan naming/lifecycle fixtures.
- Do not write tests against real user plan state.
- Run the full suite after focused checks because plan validation and skill-routing conventions are shared infrastructure.

### Candidate verification commands

```bash
npm run test:plans
npm run test:plans-findings
npm run test:plans-repair
npm test
```

Do not invent a new lint, formatter, or typecheck command solely for this work.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Entry-point skills become bloated by duplicated references | Repeat only completion gates; keep procedural depth in references |
| Every invocation loads too much context | Keep reference matrices mode-specific and conditional |
| Programmatic validation becomes over-opinionated | Enforce only deterministic naming/schema rules in code |
| Qualitative Validator becomes another authoring pass | Preserve a read-only violations-only contract |
| Paired skills make Validator scope unbounded | Include only explicitly requested or materially applicable paired skills |
| Agents claim references were read when that cannot be proven | Distinguish expected reference set from verified execution evidence |
| Existing plans are broken by stricter naming checks | Characterize current inventory first and treat legacy exceptions deliberately |
| Skill updates drift across harnesses | Keep source skill/reference content canonical and test rendered/routed outputs |

## Open Questions

- Should new filename findings initially be advisory for legacy plans that predate the naming convention, or should compatibility be determined from repository inventory before implementation?
- Should the reference matrix remain encoded only in Markdown instructions, or should RoboRepo eventually expose a small machine-readable skill workflow manifest that can be validated without parsing prose?
- Should structural reference-reachability checks live with existing package/skill validation, or should implementation introduce a dedicated audit module after ownership is inspected?
- Which existing diagnostics surface is the best home for expected skill/reference-set reporting?

None of these questions blocks Phase 1 or Phase 2.

## Repository Review

Repository state for this revision was deliberately reviewed at:

```text
677371c6e95234caa69d532f799cfcb16f4c438e
```

Verified facts used by this plan:

| Fact | Repository evidence |
| --- | --- |
| `technical-writing write` does not require `review-loop.md` | `globals/packages/technical-writing/skills/technical-writing/SKILL.md` |
| the current Validator list omits `representation.md` | `globals/packages/technical-writing/skills/technical-writing/references/review-loop.md` |
| OpenAI skill metadata currently carries only a description | `globals/packages/technical-writing/skills/technical-writing/agents/openai.yaml` |
| plan creation begins in backlog and start moves selected work to active | `globals/packages/plan-docs/skills/plan-docs/references/workflow-create.md`, `globals/packages/plan-docs/skills/plan-docs/references/workflow-start.md` |
| `agent-config` is the project namespace covering skills and harness configuration | `docs/plans/plans-config.json` |
| structured findings feed validation/lifecycle errors/repair prompts from one catalog | `modules/plan-docs/findings.mjs` |
| plan-focused and full-suite verification commands exist | `package.json` |

## Success Criteria

The plan is successful when:

- A normal technical-writing create/edit/revise request resolves to `write` and cannot legitimately finish without the Validator loop.
- Read-only document evaluation remains available through `review` without introducing extra authoring modes.
- Plan creation resolves naming and namespace before drafting.
- Programmatic plan validation catches deterministic filename/namespace violations.
- The technical-writing Validator has an explicit applicable rule set and surfaces every pass.
- Applicable paired skills influence both authoring and review.
- Tests protect the critical reference matrices and naming validators.
- Maintainers have a reusable pattern for future skills: entry-point gates, detailed references, deterministic validators, and qualitative review.

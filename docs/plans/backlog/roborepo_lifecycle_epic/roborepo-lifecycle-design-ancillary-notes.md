# RoboRepo Lifecycle Redesign
## Ancillary Notes and Unresolved Context

This document supplements the main context transfer. It captures details that do not belong cleanly in the core architecture summary but may prevent future conversations from revisiting settled ground or making incorrect assumptions.

---

# Terminology Is Not Fully Settled

The concepts are clearer than their final names.

Current skill names:

- `plan-promote`
- `plan-start`

Do not revert `plan-promote` to `plan-prepare` in future documents.

The user did not fully settle the user-facing names for lifecycle actions. Words discussed included:

- Prepare
- Promote
- Queue
- Mark Ready
- Review for Readiness
- Qualify

The important conclusion was not the final verb. It was that:

- an action can run without causing a state change;
- the successful state transition is a lifecycle event;
- the action may return “not ready,” “blocked,” or “decision required” while leaving the current lifecycle unchanged.

Avoid locking UI terminology prematurely.

---

# Action, Workflow, Result, and Event Must Stay Distinct

A useful conceptual sequence is:

```text
Lifecycle action requested
  → mixed agentic/deterministic workflow runs
  → normalized workflow result is produced
  → lifecycle policy evaluates the result
  → lifecycle event occurs only on successful advancement
```

Example:

```text
Action: promote a Backlog plan
Workflow: plan-promote plus deterministic validation
Result: ready
Event: Backlog → Ready
```

Alternative:

```text
Action: promote a Backlog plan
Workflow: plan-promote plus deterministic validation
Result: user decision required
Event: none
State remains: Backlog
```

Do not use “action,” “workflow,” and “transition” interchangeably.

---

# The Workflow Order Is Not Always Strictly Agent First

The common pattern is mixed and alternating:

```text
agent reasoning
→ deterministic inspection
→ agent interpretation
→ deterministic mutation
→ deterministic verification
→ agent interpretation
```

Some workflows may begin with deterministic fact collection before agent reasoning.

The architecture should support ordered phases, but it should not hardcode one universal sequence for every workflow.

---

# Standalone Skills Are Already Useful Product Surface

`plan-promote`, `plan-start`, and `integration-check` should remain directly invokable even after orchestration exists.

Lifecycle orchestration is an additional consumer of these workflows, not their only reason to exist.

This allows:

- dogfooding before UI integration;
- direct CLI or harness use;
- testing workflow behavior independently;
- incremental implementation without waiting for the complete lifecycle system.

---

# Do Not Build a Generic Workflow Engine Yet

The goal is an adaptable boundary, not a platform.

Near-term scope:

- normalized run IDs;
- statuses;
- inputs and outputs;
- execution context;
- result contracts;
- inspect/resume/cancel/signal semantics where required;
- idempotent deterministic operations;
- test doubles or adapters.

Explicitly deferred:

- workflow DSL;
- distributed workers;
- scheduler;
- event-sourced history;
- general-purpose queue system;
- Temporal or Restate integration;
- a second agent runtime such as LangGraph.

A third-party runtime should be reconsidered only when actual durability requirements justify it.

---

# Runtime and Harness Provider Are Different Abstractions

Do not combine them.

The workflow runtime owns:

- run state;
- phase progression;
- pause/resume;
- cancellation;
- signals;
- normalized results.

The harness provider owns:

- launching Claude, Codex, or another harness;
- provider-specific permission or planning modes;
- session attachment;
- collecting provider output;
- translating provider mechanics into a common task/result contract.

A provider must not redefine workflow semantics.

---

# Native Harness Plan Mode Is Optional

Claude’s native plan mode was discussed because it may reduce permission prompts during analysis.

The conclusion was:

- RoboRepo should own the planning semantics;
- native plan mode is an optional provider capability;
- copied prompts cannot guarantee a native permission mode;
- workflows must remain correct without native plan mode;
- provider launch integration can use native mode later when supported.

Do not make `plan-promote` depend on Claude-specific planning behavior.

---

# Worktree Configuration Direction

The repository already uses:

```text
docs/plans/plans-config.json
```

Do not introduce a conflicting singular `plan-config.json` without a strong reason.

Likely configuration concerns:

- worktree parent/root;
- directory template;
- branch template;
- reuse policy.

The default should be resolved with platform APIs, conceptually:

```js
path.join(os.homedir(), ".worktrees")
```

Important constraints:

- no hardcoded separators;
- no absolute machine path in plan documents;
- runtime paths may appear in runtime output or a local registry;
- reconcile local registry records against `git worktree list --porcelain`;
- deterministic worktree operations should be idempotent and safe to retry.

The exact schema remains subject to later design.

---

# Lifecycle State Expansion Should Initially Be Simple

The proposed implementation order intentionally separates state vocabulary from full automation.

The first lifecycle expansion can add:

- Icebox
- Ready
- Integration
- Review
- Complete label over `completed/`

with:

- folders;
- labels;
- order;
- manifest entries;
- validation profiles;
- manual lifecycle dropdown transitions.

It does not need to immediately implement every workflow trigger or controller.

This lets the future state model be dogfooded before orchestration is complete.

---

# Portal Workflow Triggers Should Remain Hidden Initially

Temporary UI policy:

Keep visible:

- lifecycle dropdown on list/card surfaces;
- lifecycle dropdown on plan detail;
- plan metadata;
- validation findings;
- ordinary non-workflow context/copy tools where still useful.

Hide:

- Start buttons;
- Promote buttons;
- workflow prompt CTAs;
- recommended agent actions;
- lifecycle-event prompt dialogs;
- Start Eligible;
- provider launch actions;
- incomplete progress/result UI.

Do not show disabled placeholders for unfinished workflows unless there is a clear user benefit.

Reveal agent-backed actions only after their end-to-end contracts and result handling are stable.

---

# Existing Backlog Documents Remain Untouched for Now

The current decision is to preserve them until the new baseline documentation exists.

Important existing documents include:

- `docs/plans/backlog/plan-lifecycle-suite-workflow-navigation.md`
- the backlog plan for deterministic `integration-check` actions
- the uploaded revisions of `plan-start-preparation-execution-workflow`

The large lifecycle suite plan is broad and likely outdated in parts, but it remains valuable source material.

The integration-check determinism plan appeared more current and likely remains a useful implementation input.

Do not archive, rewrite, merge, or delete these yet.

The future Delivery Roadmap should inventory and reconcile them.

---

# Uploaded Plan Revisions

Two uploaded files represented revisions of the same plan:

```text
plan-start-preparation-execution-workflow.md
plan-start-preparation-execution-workflow(1).md
```

The more developed revision added:

- explicit deterministic-action principles;
- preflight/apply/inspect command concepts;
- stable JSON results;
- idempotency;
- shared Git/worktree primitives;
- stronger integration-check overlap analysis.

Much of its standalone-skill scope was superseded when `plan-promote` and `plan-start` were implemented.

Its deterministic architecture and code-touchpoint analysis may still be useful when writing the runtime and deterministic-primitives milestone.

---

# Naming Convention for Future Plan Documents

The repository’s Plan Docs convention uses:

```text
docs/plans/plans-config.json
```

to declare project namespaces.

Relevant namespaces already include:

- `plan`
- `plan-lifecycle`
- `harness`
- `session`
- `portal`

Future implementation plans should use existing namespace conventions rather than inventing arbitrary prefixes.

Do not suffix plan filenames with `-plan`.

Do not encode status, priority, or dates in filenames.

Preserve stable plan IDs when files are renamed or moved.

---

# Documentation Set Is Expected to Evolve

The intended permanent documentation set is:

1. Lifecycle Architecture Reference
2. Lifecycle Product Specification
3. Lifecycle Delivery Roadmap
4. Project Documentation Workflow
5. Architecture Decision Log

The current preferred creation order became:

1. Lifecycle Architecture Reference
2. Lifecycle Product Specification
3. Lifecycle Delivery Roadmap
4. Project Documentation Workflow, distilled from the concrete work
5. Decision Log populated as decisions are formalized

However, context preservation takes priority over strict ordering.

The documents should not be placed under `docs/plans/backlog/` merely because they discuss planned behavior. They are intended as long-lived references, though their exact repository locations have not been finalized.

---

# Product Specification Maturity Model

The Product Specification should be:

- normative in content;
- declarative in tone;
- written as though the intended product exists;
- usable as an acceptance test during implementation.

Once implementation is complete, it can become a published user guide with minimal rewriting.

The distinction is one of maturity and placement, not necessarily a full content rewrite.

---

# Decision Log Should Be Lightweight

The Decision Log should not become another long design document.

Each entry should capture only:

- decision;
- context;
- rationale;
- alternatives considered;
- consequences;
- conditions that would justify revisiting it.

Likely early decisions:

- standalone atomic agent workflows;
- mixed agentic/deterministic phases;
- lifecycle state owned outside skills;
- tool-agnostic runtime boundary;
- no third-party workflow platform yet;
- unfinished workflow triggers hidden;
- vertical dogfooding before full orchestration;
- permanent references separated from temporary implementation plans.

---

# Open Design Questions Still Worth Revisiting

These were not fully resolved:

1. Exact user-facing lifecycle action names.
2. Exact normalized workflow result schema.
3. Whether workflow status persistence is needed in the first runtime milestone.
4. Whether deterministic primitives should be exposed as granular commands or grouped under thin action-specific orchestrators.
5. Exact worktree and branch configuration schema.
6. Whether Ready and Integration transitions remain manually selectable during the temporary state-expansion phase.
7. How an agent workflow proves completion strongly enough for lifecycle advancement.
8. How user-decision-required results are represented and resumed.
9. Whether `plan-start` should include implementation and long-running execution, or only initialization before a separately tracked Active run.
10. How `wrap-up`, `integration-check`, and integration-branch mutation are divided.
11. Whether Review remains a separate lifecycle state in the first implementation.
12. Exact locations and filenames for the permanent documentation set.

These are not blockers for preserving the architecture. They should remain explicit rather than being silently decided while writing later implementation plans.

---

# Suggested Opening for the Next Chat

A future chat can begin with:

```text
Use the attached context-transfer documents as the authoritative summary of the prior design session.

The immediate goal is to create the Lifecycle Architecture Reference. Do not rewrite existing backlog plans yet. Preserve unresolved questions explicitly, and distinguish established decisions from proposals.
```

That should be enough to restart the work without re-litigating the full conversation.
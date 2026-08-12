# RoboRepo Lifecycle & Documentation Redesign
## Context Transfer (Working Notes)

**Purpose**

This document is **not** a design document, implementation plan, architecture reference, or product specification.

It is a curated transfer of the conclusions, reasoning, open questions, and current direction from a long design session so a future chat can continue without losing context.

---

# Current Objective

The original goal was to improve the Plan Lifecycle system.

The discussion evolved into something much larger:

- redesigning lifecycle workflows
- separating agent reasoning from deterministic execution
- introducing standalone reusable agent workflows
- introducing a better planning/documentation methodology for large RoboRepo features

The conversation intentionally moved away from immediately writing implementation plans.

Instead, the current priority is preserving architecture and planning context before writing permanent documentation.

---

# Major Architectural Shift

Originally the lifecycle document attempted to serve as:

- implementation plan
- architecture reference
- product guide
- roadmap
- project tracker

The conclusion is that this is no longer sustainable.

Different document types should own different concerns.

---

# Current Documentation Strategy

The next phase is **not** writing implementation plans.

Instead we first create long-lived documentation.

Current target documents:

1. Project Documentation Workflow
2. Lifecycle Product Specification
3. Lifecycle Architecture Reference
4. Lifecycle Delivery Roadmap
5. Architecture Decision Log

Only after these exist should implementation plans be rewritten or decomposed.

Existing backlog plans are intentionally left unchanged for now.

They will later be reconciled into the new documentation structure.

---

# Philosophy

Implementation plans are temporary.

Architecture and product documents are permanent.

Implementation plans should reference architecture rather than attempting to restate it.

---

# Documentation Philosophy

The Product Specification is written as though the feature already exists.

It becomes both:

- the product specification during implementation
- the eventual user guide after implementation

Very little rewriting should be required.

Implementation is measured against the Product Specification.

---

# Generic Documentation Workflow

One major realization from this conversation is that large projects naturally evolve through documentation stages.

Conceptually:

Vision

↓

Product Specification

↓

Architecture Reference

↓

Delivery Roadmap

↓

Implementation Plans

↓

Completed Feature

↓

Published Guide

This workflow should eventually become a reusable RoboRepo planning skill.

---

# Lifecycle Direction

Current target lifecycle:

Icebox

↓

Backlog

↓

Ready

↓

Active

↓

Integration

↓

Review

↓

Complete

Archive remains separate.

---

# Lifecycle Concepts

We distinguished four concepts that had previously been conflated.

Lifecycle State

Current state of a plan.

Examples:

Backlog

Ready

Active

Lifecycle Action

Something initiated by the user.

Examples:

Promote

Start

Wrap Up

Confirm Merge

Lifecycle Event

Successful movement between states.

Example:

Backlog → Ready

Workflow

The mixed agentic/deterministic execution performed by an action.

---

# Agent Workflows

Standalone reusable skills now exist:

- plan-promote
- plan-start

Integration-check already exists and is evolving toward the same model.

Future workflows likely include:

- plan-wrap-up
- plan-submit-review
- plan-confirm-merge

These remain independently invokable.

They should not be tightly coupled to lifecycle.

---

# Mixed Workflow Model

A major architectural decision.

Workflows are neither purely agentic nor purely deterministic.

They alternate.

Typical pattern:

Reason

↓

Inspect

↓

Decide

↓

Mutate

↓

Verify

↓

Interpret

Agent reasoning should own:

- repository analysis
- plan reconciliation
- implementation decisions
- tradeoff evaluation

Deterministic operations should own:

- Git
- worktrees
- validation
- lifecycle mutation
- filesystem operations
- repeatable inspections

---

# Deterministic Principles

Deterministic operations should be:

- idempotent
- resumable
- repeatable
- independently testable

They should become reusable primitives.

Not giant controllers.

---

# Runtime Abstraction

Do not commit to a workflow engine.

Instead define a small runtime abstraction.

Conceptually:

start

inspect

signal

resume

cancel

Current implementation can remain local.

Future implementations may use:

- Restate
- Temporal
- other runtimes

Lifecycle and workflows should never depend directly on one runtime implementation.

---

# Provider Abstraction

Separate concepts.

Workflow Runtime

Owns:

workflow execution

Harness Provider

Owns:

Claude

Codex

future providers

Providers adapt execution.

They do not redefine workflow semantics.

---

# Workflow Results

Agent workflows should eventually return normalized structured results.

Conceptually:

status

findings

decisions

warnings

blockers

recommended lifecycle

next action

Lifecycle transitions should consume structured results.

Not prose.

---

# Decision Philosophy

Automatic decisions:

Make them when:

- obvious
- low risk
- inexpensive to reverse

Ask the user only when meaningful tradeoffs exist.

Material decisions include:

- public APIs
- persistent schemas
- security
- migrations
- product behavior
- irreversible consequences

---

# User Decision Gates

Decision gates should be explicit.

Not ad hoc.

A workflow may pause for a user decision.

After receiving input it should continue.

---

# Lifecycle Ownership

Important invariant.

Skills never mutate lifecycle.

They recommend outcomes.

Lifecycle owns state transitions.

Example:

plan-promote

↓

Ready recommendation

↓

Lifecycle controller decides whether transition occurs.

---

# Execution Context

Rather than every phase rediscovering information, workflows should progressively build shared execution context.

Repository

↓

Plan

↓

Branch

↓

Worktree

↓

Runtime

↓

Session

Everything downstream consumes this context.

---

# Worktree Direction

plan-start currently owns worktree reasoning.

Future direction:

Configuration should define default worktree root.

Likely via plan configuration.

No hardcoded ~/.worktrees.

Runtime resolves actual location.

Plan documents never store absolute machine paths.

---

# UI Strategy

Current recommendation:

Hide all workflow actions.

Only expose:

Lifecycle dropdown.

Reason:

Dogfood workflows independently.

Reveal UI incrementally as actions become production ready.

Portal should eventually expose:

- descriptions
- prompts
- launch actions
- findings
- blocked state
- progress

Only after backend contracts stabilize.

---

# Incremental Delivery Strategy

Instead of implementing the entire lifecycle at once:

1.

Improve deterministic foundations.

2.

Expand lifecycle states.

3.

Incrementally add standalone workflows.

4.

Wire workflows into orchestration.

5.

Expose UI.

Dogfood each stage.

---

# Existing Backlog

Do not rewrite existing stories yet.

Existing documents become inputs.

Current understanding:

plan-lifecycle-suite-workflow-navigation

Will likely become decomposed.

integration-check deterministic actions

Still largely relevant.

plan-promote

Implemented.

plan-start

Implemented.

Reconciliation happens later.

---

# Workflow Runtime Plan

Current thinking:

First implementation should not build a workflow engine.

Instead:

Define interfaces.

Define result contracts.

Define execution context.

Build reusable deterministic primitives.

Remain runtime agnostic.

---

# Third-Party Workflow Engines

Discussion included:

Temporal

Restate

LangGraph

XState

Conclusion:

Do not adopt one now.

Preserve an abstraction that allows future adoption.

Current implementation remains local.

---

# Product Philosophy

Product documentation should describe intended behavior.

Not implementation status.

Eventually that same document becomes published documentation.

---

# Architecture Philosophy

Architecture document should describe:

How the system works.

Not:

How it is implemented.

No milestones.

No implementation phases.

---

# Delivery Roadmap Philosophy

Roadmap owns:

Milestones

Dependencies

Coverage

Implementation order

Inventory of existing plans

References to implementation work

Nothing else.

---

# Decision Log

Create a long-lived Architecture Decision Log.

Short entries.

Each captures:

Decision

Reasoning

Alternatives

Consequences

Future considerations

Examples:

Standalone skills.

Mixed workflows.

Runtime abstraction.

Tool-agnostic execution.

Hide unfinished UI.

Vertical slices.

---

# Reusable Planning Methodology

A major realization.

This work is not lifecycle specific.

The documentation methodology itself should become reusable.

Eventually a RoboRepo skill.

Purpose:

Help large features evolve documentation naturally.

Instead of forcing everything into one implementation plan.

---

# Immediate Next Step

Do NOT begin writing implementation plans.

Instead create these permanent documents:

1.

Lifecycle Architecture Reference

2.

Lifecycle Product Specification

3.

Lifecycle Delivery Roadmap

After those exist:

Write the generic Project Documentation Workflow.

(The workflow document should be distilled from the lifecycle project rather than invented first.)

---

# Important Context Preservation

This conversation intentionally moved away from trying to create six to eight implementation plans.

Instead it established:

- documentation taxonomy
- architecture boundaries
- product boundaries
- delivery philosophy
- incremental strategy
- runtime abstraction
- workflow philosophy

Those are considered the highest-value outcomes of the session and should be preserved as architectural context before implementation planning resumes.

---

# Working Principles

These became recurring principles throughout the discussion.

- Dogfood continuously.
- Deliver vertical slices.
- Build abstractions only after patterns emerge.
- Separate reasoning from deterministic execution.
- Keep runtimes replaceable.
- Keep workflows independently invokable.
- Hide unfinished UX.
- Maintain one canonical target architecture.
- Treat implementation plans as temporary.
- Treat architecture and product documents as permanent.
- Preserve reasoning with an Architecture Decision Log.
- Prefer incremental convergence over speculative completeness.
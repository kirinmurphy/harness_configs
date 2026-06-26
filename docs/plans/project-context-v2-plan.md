# Project Context Plan

> **Status: ACTIVE.** `roborepo project-context inventory [path] [--summary]` shipped and writes
> deterministic generated facts. Remaining work: `init`, `check`, command/skill trigger polish, and
> better integration between generated facts and curated docs.

## Purpose

Project Context is a lightweight handoff system that helps new people understand, discuss, and safely extend an application from a practical product/code perspective.

It is not a replacement for code inspection, repo indexing, tests, schemas, migrations, runtime behavior, or explicit product decisions. Agents still need to inspect the codebase directly before making implementation claims.

The curated docs are human-readable companions to the code. They organize the app's own concepts, reusable parts, and commands so a domain-strong contributor can speak in the project's terminology and ask better questions.

It gives each project:

- A small always-on pointer in agent instructions.
- Lean curated docs for product definitions, user commands, reusable parts, and optional extension paths.
- Generated repo facts from a repeatable CLI scan.
- Architecture fit, divergence, side-effect, and code-quality analysis for implementation plans.
- An on-demand skill that updates docs using the generated facts and the current codebase.

The goal is to help an owner or second developer understand what the app currently does, speak in the same terminology as the codebase, and move product work forward while the agent provides architecture context conversationally.

## Concept Model

Project Context has four surfaces.

```txt
Always-on agent instructions = tiny pointer and stable guardrails.
Project Context skill = judgment, orchestration, and conversational guidance.
roborepo CLI = deterministic repo scan and generated facts.
Lean user docs = human-readable glossary, inventory, commands, and optional extension paths.
```

The surfaces should stay separate:

- Agent instructions are always loaded, so they must stay small.
- Skills load only when relevant, so they can contain workflow logic, rules, references, and scripts that would overwhelm the user-facing docs.
- CLI output is mechanical and repeatable, so it can be generated without asking the model to infer everything from scratch.
- Curated docs are human quick context derived from the code, so they should preserve project-specific structure and language without pretending to be authoritative.

## Touchpoints

Project Context has a few explicit integration points. Each one should have a narrow job.

| Touchpoint | Surface | Job |
| --- | --- | --- |
| `AGENTS.md` or equivalent durable agent instructions | Agent instructions | Tiny pointer: Project Context docs are human orientation, not source of truth. Agents must still inspect code, tests, schemas, migrations, and runtime behavior. |
| `project-context` skill | Agent skill | Orchestrate refreshes, run inventory, preserve curated docs, explain drift, and surface architecture/quality guidance conversationally. |
| `/project-context` | User command / skill trigger | Refresh or repair the handoff as a whole when docs are missing, stale, or inconsistent. |
| `/document` | User command / skill trigger | Explicitly update human-facing docs for recent work, especially `glossary.md` and `inventory.md`. |
| `/plan` | Planning workflow | Explain implementation path, architecture fit, divergence, consequences, and verification before building. |
| `/tighten` | Post-build workflow | Preserve UX while improving implementation quality and checking risky areas. |
| `roborepo project-context inventory [path]` | CLI | Deterministically scan the repo and write generated facts. Shipped. |
| `roborepo project-context init [path]` | CLI | Planned: create starter config and lean docs when missing. |
| `roborepo project-context check [path]` | CLI | Planned: validate generated facts, schema version, configured docs, and staleness. |
| `project-context.config.json` or `package.json` `projectContext` | Config | Define docs location, generated output location, and curated doc names. |
| `README.md` | User doc | User API: what commands exist and what the agent guards. |
| `glossary.md` | User doc | Human-readable product/code vocabulary. |
| `inventory.md` | User doc | Reusable parts, commands, important locations, and build-from surfaces. |
| `generated/repo-scan.json` | Generated fact | Machine-readable inventory for skill and CLI use. |
| `generated/repo-summary.md` | Generated fact | Optional generated summary for quick review. |

The user-facing docs should stay small. If a touchpoint needs dense rules, put those rules in the skill or generated facts and have the agent explain only the relevant part in conversation.

## Owner Workflow

The owner should not need to understand the architecture before shaping the product. The normal loop is:

1. Describe the experience or product change.
2. Use `/plan` for a practical implementation path based on existing patterns, known risks, and explicit divergence analysis.
3. Build the change.
4. Use `/tighten` to clean up implementation quality without changing the intended UX.
5. Use Project Context when docs are missing, stale, or the project needs to be easier for a new person to understand.

The owner drives the product. The agent protects the implementation.

The owner should come away from a plan knowing:

- What current behavior or architecture the change builds on.
- Where the change follows existing patterns.
- Where the change diverges from existing patterns.
- What side effects the change may create.
- Which tradeoffs are product decisions and which are engineering risks.
- What should be verified before trusting the change.

Good owner prompt:

```txt
/plan I want users to save a draft, leave the page, and come back later to finish it.
```

After build:

```txt
/tighten Preserve the UX, but clean up the implementation and check that it follows existing patterns.
```

## Planning Contract

When `/plan` is used in a project with Project Context docs, the plan should include an explicit architecture-fit pass before implementation begins.

Required planning outputs:

- Product goal in the owner's language.
- Project Context docs consulted.
- Closest existing implementation or pattern.
- Proposed implementation path.
- Architecture fit: where the plan follows existing structure.
- Architecture divergence: where the plan introduces a new structure, shortcut, dependency, or behavior.
- Side effects and consequences across data, auth, permissions, UI state, routing, deployment, configuration, tests, and user workflows.
- Code-quality impact: whether the change improves, preserves, or worsens boundaries and maintainability.
- Safer alternative or smaller first step when the proposed change is risky.
- Verification plan.
- Open decisions that should be resolved before build.

The plan should not block product work just because it diverges. It should make divergence visible enough that the owner can choose it knowingly.

Recommended plan section:

```md
## Architecture Fit

- Existing pattern:
- Closest example:
- Follows existing architecture:
- Diverges from existing architecture:
- Consequences:
- Safer alternative:
- Verification:
```

## Tighten Contract

`/tighten` should improve implementation quality without changing the intended product experience.

Recommended loop:

1. Review the current implementation against Project Context docs, generated facts, and nearby code patterns.
2. Fix high- and medium-risk issues that affect correctness, maintainability, security, ownership, or likely future changes.
3. Review again.
4. Repeat until only low-priority issues remain or three passes are complete.
5. Summarize what changed and what remains.

`/tighten` should preserve UX intent unless the owner explicitly asks for product changes. It should not turn every low-risk cleanup into immediate work.

Recommended tighten checks:

- Existing patterns and reusable surfaces.
- Component and module boundaries.
- Auth, authorization, ownership, and admin behavior.
- Data model fit.
- API consistency, validation, and error handling.
- Naming, file placement, and dependency direction.
- Verification coverage for touched behavior.

## Document Contract

`/document` should be the explicit command for updating human-facing Project Context docs after new code, renamed concepts, or new reusable parts are added.

Use `/document` when the user asks to:

- update the glossary
- update the reusable parts inventory
- document a new module, command, workflow, status, role, or product term
- make recent code easier for another developer to understand
- sync handoff docs after a feature was built

Recommended behavior:

1. Inspect the changed code directly.
2. Run `roborepo project-context inventory` when generated facts are missing or stale.
3. Update only the relevant curated docs by default.
4. Preserve existing headings and custom structure.
5. Add glossary entries only for project-specific concepts and product semantics.
6. Add inventory entries only for intentional reuse surfaces, important commands, locations, or build-from parts.
7. Mark uncertain terms or reusable boundaries as TODOs instead of guessing.
8. Report any doc/code drift found during the update.

`/document glossary` should focus on what terms mean.

`/document inventory` should focus on where reusable parts, commands, and important locations live.

`/document` should not turn into a broad architecture essay unless the user explicitly asks for that.

## Always-On Agent Instructions

Each project should include only a small Project Context pointer in `AGENTS.md` or the equivalent durable agent file.

Recommended addition:

```md
## Project Context

When planning, tightening, or orienting implementation work, consult Project Context docs if they exist.

Common locations:

- `docs/project-context/`
- `docs/handoff/`

Use Project Context docs as human-readable orientation: terminology, user commands, reusable parts, and optional extension paths. Do not treat them as source of truth. Inspect the code, tests, schemas, migrations, and runtime behavior before making implementation claims.

Use only the specific docs relevant to the task. Do not load every handoff doc by default.

If the docs are missing, stale, or inconsistent with the code, suggest the `project-context` skill or `roborepo project-context inventory`.
```

Keep stable implementation guardrails in always-on instructions:

- Preserve the owner's product and UX intent.
- Search for the closest existing implementation before adding a new pattern.
- Prefer reuse, extension, and consistency over new architecture.
- Be careful around auth, authorization, user ownership, admin behavior, schema changes, migrations, environment variables, deployment, uploads, and cross-user data access.
- Run the smallest verification command that proves the touched behavior.

Do not place the full documentation workflow in always-on instructions.

## Project Context Skill

Create a shared skill named:

```txt
project-context
```

The skill should activate for prompts such as:

- `/project-context`
- `/document`
- `/document glossary`
- `/document inventory`
- "update project context"
- "refresh project docs"
- "update the glossary"
- "update the reusable parts inventory"
- "generate repo inventory"
- "make this project easier for another developer to understand"

The skill owns judgment and orchestration.

Skill workflow:

1. Discover Project Context config and docs location.
2. Run `roborepo project-context inventory` when available.
3. Fall back to a local script only if the CLI is unavailable.
4. Read generated repo facts.
5. Read the relevant existing curated docs.
6. Update curated docs while preserving custom structure.
7. Mark uncertain claims as TODOs instead of guessing.
8. Report important inconsistencies between code and docs.

Skills can contain `SKILL.md`, references, and scripts. The skill can call the CLI, but the CLI should remain the canonical implementation for repeatable scanning.

## roborepo CLI

Project Context should live in the existing `roborepo` CLI in:

```txt
<repo>
```

`roborepo` already owns agentic repo operations such as code indexing, docs indexing, skill management, MCP setup, and trimmed command running. Project Context inventory belongs in that same surface because it is a repo-local agent-support operation.

Recommended command shape:

```sh
roborepo project-context inventory [path]
roborepo project-context init [path]
roborepo project-context check [path]
```

Initial minimum:

```sh
roborepo project-context inventory [path]
```

Command responsibilities:

- `inventory`: scan the repo and write generated facts.
- `init`: create starter docs/config when missing.
- `check`: detect missing or stale generated facts and missing configured docs.

Avoid making the CLI responsible for final curated prose. The CLI should collect facts; the skill should decide how to update the docs.

## Generated Facts

The inventory command should emit stable generated files.

Default output:

```txt
docs/project-context/generated/repo-scan.json
docs/project-context/generated/repo-summary.md
```

Generated facts should include:

- Package scripts and dependencies.
- Folder map.
- Routes/pages.
- Components and reusable UI surfaces.
- API/data files.
- Services/domain modules.
- Schemas/models.
- Constants, enums, status names, and product labels.
- Tests.
- CI, deployment, and config files.
- Environment variable names only.
- Existing project docs.
- Auth, authorization, ownership, and role-related files.
- State management and cache boundaries.
- Data access and mutation boundaries.
- External integrations.
- Generated code and framework-owned files.
- Risk areas and quality signals.

Recommended JSON shape:

```json
{
  "schemaVersion": 1,
  "project": {},
  "commands": [],
  "dependencies": {},
  "routes": [],
  "components": [],
  "domainModules": [],
  "dataAccess": [],
  "authAndPermissions": [],
  "schemasAndValidation": [],
  "stateManagement": [],
  "externalIntegrations": [],
  "tests": [],
  "docs": [],
  "riskAreas": [],
  "qualitySignals": []
}
```

Generated output should be deterministic:

- Stable ordering.
- No timestamps unless needed for stale checks.
- Stable JSON formatting.
- Clear schema version.
- Small enough to review in diffs.

## Project Docs

Project Context should keep user-facing docs small. Dense implementation guidance belongs in the Project Context skill, generated facts, and durable agent instructions. The docs should expose the user surface: definitions, available commands, reusable project parts, and optional future paths.

For new projects, use a lean default:

```txt
docs/project-context/
  README.md
  glossary.md
  inventory.md
  extension-paths.md  # optional
  generated/
    repo-scan.json
    repo-summary.md   # optional
```

For existing projects, preserve their current documentation location and structure unless migration is explicitly requested.

Curated docs can include an ownership marker:

```md
<!-- curated Project Context doc; preserve custom structure -->
```

Recommended docs:

| Doc | Purpose |
| --- | --- |
| `README.md` | User API for working with the agent: what docs exist, which commands to use, and what the agent guards during planning and tightening. |
| `glossary.md` | Project-specific product and subject-matter definitions. |
| `inventory.md` | Reusable parts, important locations, commands, and surfaces a future agent should build from. |
| `extension-paths.md` | Optional short list of likely future product paths. Skip when it would become speculative roadmap prose. |

Do not create separate user-facing docs for architecture divergence, quality recommendations, build recipes, or risk checkpoints by default. Those should live in the skill and be surfaced conversationally inside `/plan`, `/tighten`, and Project Context refreshes.

## README

The README should be the user API for the handoff.

Include:

- What is here.
- How to use `/plan`.
- How to use `/tighten`.
- When to ask the agent to refresh Project Context.
- What the agent quietly guards: existing patterns, auth, data ownership, API behavior, reusable parts, validation, and verification.

Keep it short. The README should teach the developer how to interact with the system, not explain the whole architecture.

## Glossary

The glossary should explain what project-specific terms mean.

Do include:

- Product concepts.
- Domain objects.
- Workflow names.
- User roles.
- Status names.
- Feature/module names.
- Business rules.
- Internal labels exposed to users.

Do not include generic stack terms unless the project gives them special meaning.

Avoid generic entries such as:

```txt
API
component
route
database
migration
service
environment variable
```

Recommended shape:

```md
# Subject Matter Glossary

What terms mean. For reusable parts, commands, and locations, see `inventory.md`.

## <Product module or workflow>

One sentence explaining what this module does. Include a short code path only when it clarifies the section boundary.

| Term | Meaning |
| ---- | ------- |

## <Standalone reusable module>

One sentence explaining why this module is separate.

| Term | Meaning |
| ---- | ------- |
```

Glossary sections should be organized by the product module or workflow a reader would navigate, not by abstract noun type.

Good section patterns:

- Website elements.
- Projection engine.
- Payment streams and events.
- Setup flow.
- Cross-cutting product state.

Keep standalone reusable modules separate even when another module consumes them.

The glossary should separate "what terms mean" from "where code lives."

Short rule:

```txt
Glossary = concept map by module, not dictionary by type.
```

## Inventory

The inventory doc should identify the smallest units someone could intentionally reuse or inspect. It replaces separate project map, reusable surfaces, build cookbook, and location docs in the default user-facing set.

Good entries:

- Product workflow surface.
- Domain service.
- Data API.
- Workflow building block.
- UI widget or input.
- App support surface.
- Validation schema.
- Auth pattern.
- Data model pattern.
- Config or deploy pattern.
- Important command.
- Important folder or source area.

Avoid documenting every internal helper.

Recommended fields:

```txt
Piece
Location
Use it for
When not to reuse
Risk if changed
Related examples
```

Recommended sections:

- Product Workflow Surfaces.
- Domain Services.
- Data APIs.
- Workflow Building Blocks.
- UI Widgets And Inputs.
- App Support Surfaces.
- Not Separate Surfaces Yet.
- Folder Map.
- Commands.

The "Not Separate Surfaces Yet" section is important. It prevents agents from prematurely extracting helpers that are still tightly coupled to one workflow.

Short rule:

```txt
Inventory = where to build from. Glossary = what product words mean.
```

## Risk Checkpoints

Risk checkpoints are places where small changes can have large product or architectural consequences. They are not restrictions. They are skill guidance for extra care during `/plan` and `/tighten`.

Default checkpoints:

- Authentication: controls who can enter the app and which identity the app trusts.
- Authorization, ownership, and admin behavior: controls who can see or change data.
- Database schema and migrations: shape what the product can remember and how features connect.
- API behavior and mutations: affect how UI, business logic, and data changes interact.
- Environment variables and deployment config: control secrets, service connections, and runtime behavior.
- File uploads and storage: affect data ownership, persistence, access control, and cleanup.
- External integrations: can introduce reliability, permission, billing, or data-sync risk.

The skill should tell the owner what may break, what existing pattern to inspect, and what verification should run when a plan touches a checkpoint.

## Quality Recommendations

Project Context should produce code-quality recommendations after inventory and targeted analysis. These recommendations should be skill output, not a default standalone user doc.

Recommended categories:

- Low-risk cleanup.
- Extract only when touched.
- Needs product confirmation.
- Needs architecture decision.
- Do not refactor during feature work.

Recommended signals:

- Business logic embedded in UI components.
- Repeated logic across routes, components, services, or actions.
- Large files with mixed responsibilities.
- Unclear ownership boundaries between UI, data access, domain logic, and side effects.
- Missing shared validation or schema enforcement.
- Auth, permissions, or ownership checks spread across inconsistent locations.
- Hard-coded product labels or status values that should be centralized.
- Missing tests around high-value workflows.
- Dead or stale routes, components, docs, scripts, or config.
- Premature abstractions that obscure simple product behavior.

Each recommendation should include:

- Current evidence.
- Why it matters.
- Suggested direction.
- Risk level.
- Best timing.
- Verification needed.

Recommendations should educate the owner without turning every issue into immediate work. A feature plan should only include quality work when it reduces risk for the requested change or prevents obvious future confusion.

## Build Recipes

Build recipes should live in the skill by default. The skill should use them to guide `/plan` and `/tighten` responses without requiring the developer to read a dense cookbook.

Examples:

- Add a new page or route.
- Add a new form.
- Add a new API endpoint or mutation.
- Add a new domain service.
- Add a new reusable component.
- Add a new validation schema.
- Add a new environment variable.
- Run focused tests.
- Run full project checks.

Each recipe should include:

- When to use it.
- Existing patterns to copy.
- Files usually involved.
- Architecture-fit questions to answer before editing.
- Verification command.
- Risks or common mistakes.

## Extension Paths

Extension paths are optional. They should explain likely future product paths only when those paths are concrete enough to help a developer choose what to build next.

Each path should include:

- Product goal.
- Existing parts to build on.
- Best-fit use cases.
- Risks or dependencies.
- Suggested first step.

This doc should stay practical. It is not a roadmap unless the owner wants it to be one.

## Future Ship Workflow

`/ship` should remain a future workflow until a project has a real deployment process.

Do not treat deployment checks as authoritative until the project has:

- A live hosting target.
- Production environment variables.
- A database migration process.
- A deploy command.
- Smoke test expectations.
- A rollback plan.

When those exist, `/ship` can become a deployment-readiness workflow that checks release risk, not a generic quality pass.

## Source Of Truth

Project Context docs are human-readable companions to the code, not the source of truth.

When docs disagree with code, tests, schemas, migrations, runtime behavior, or explicit product decisions, those sources win. The correct workflow is to inspect the authoritative source, confirm the real behavior, and then update the docs if they drifted.

The docs should be treated like an organized extension of the codebase for humans: useful quick context, shared vocabulary, and pointers to reusable parts. They should not become a parallel architecture spec that agents blindly follow.

## Config Discovery

Project Context should use a deterministic discovery order.

Recommended order:

```txt
1. project-context.config.json
2. package.json "projectContext" field
3. docs/project-context/
4. existing documented location from AGENTS.md
5. docs/handoff/
6. create docs/project-context/ when initialization is requested
```

Example config:

```json
{
  "docsDir": "docs/project-context",
  "generatedDir": "docs/project-context/generated",
  "docs": {
    "readme": "README.md",
    "glossary": "glossary.md",
    "inventory": "inventory.md",
    "extensionPaths": "extension-paths.md"
  }
}
```

## Staleness And Check Mode

`roborepo project-context check` should be a small deterministic validation command.

It should check:

- Generated scan files exist.
- Generated scan files have the current schema version.
- The repo facts hash still matches the current repo shape.
- Configured curated docs exist.
- Generated files are not manually edited if ownership markers are present.

It should not attempt to prove every prose claim is true. That remains skill work.

## Audience Split

Project Context should split user-facing docs from agent-facing instructions.

Owner-facing content should explain:

- How to interact with the agent.
- What terms mean.
- Which reusable parts and commands exist.
- Which future paths are worth considering.

Agent-facing instructions should explain:

- Where files live.
- Which patterns to reuse.
- Which areas are risky.
- Which commands verify behavior.
- Which docs or generated facts are relevant to the task.
- How to explain architecture fit, divergence, side effects, and quality recommendations conversationally.

The agent should provide architecture context to the developer inside the conversation, at the moment it matters. Do not make the developer read dense architecture exposition before they can use the system.

## Exclusions

Project Context should explicitly avoid documenting noise.

Default exclusions:

- `node_modules`.
- Build output and framework caches.
- Lockfile internals.
- Generated framework files.
- Secret values.
- Generic stack vocabulary.
- Every internal helper function.
- Large vendored assets.

Environment handling rule:

```txt
Record environment variable names only. Never record values.
```

## Curated Doc Merge Behavior

The Project Context skill should preserve human structure by default.

Rules:

- Preserve existing headings.
- Preserve custom sections.
- Make small edits instead of rewriting whole docs.
- Append TODOs for uncertain claims.
- Report deleted, renamed, or ambiguous concepts separately.
- Prefer adding a short "needs confirmation" note over guessing.
- Ask before migrating existing docs to `docs/project-context`.

Full doc rewrites should be explicit, not the default behavior.

## Implementation Checklist

1. Add `roborepo project-context inventory`.
2. Emit generated JSON and markdown summary.
3. Add `project-context` shared skill under `globals/agents/skills/project-context`.
4. Link the skill for Claude with the harness skill-link script.
5. Add Project Context docs and references to the skill.
6. Add lean user docs: `README.md`, `glossary.md`, `inventory.md`, and optional `extension-paths.md`.
7. Add `/plan` architecture-fit guidance to the relevant planning workflow.
8. Add `/document` guidance for focused glossary and inventory updates.
9. Add the lean Project Context pointer to generated global rules.
10. Add `roborepo project-context init`.
11. Add `roborepo project-context check`.
12. Test the workflow in a real project with existing docs.
13. Refine generated schema and merge rules based on the first project pass.

## Open Decisions

- Should `/document` support only focused glossary/inventory updates, or also broader handoff refreshes when the user does not specify a target doc?
- Should generated inventory include jcodemunch/jdocmunch identifiers, or stay independent of MCP indexing?
- Should `roborepo project-context inventory` write markdown summaries by default, or only JSON unless `--summary` is passed?
- Should `roborepo project-context check` be added immediately or after the first inventory command works?
- Should existing projects be left in their current docs directory indefinitely, or should there be an optional migration command?
- Should quality recommendations live only in skill output, or should the CLI also emit machine-readable quality signal candidates?
- Should `/plan` always require an architecture-fit section when Project Context docs exist, or only when the change touches known risk areas?
- Should behavior summaries be generated as part of `inventory.md`, or should the skill provide behavior context only during conversation?

## Success Criteria

- Always-on agent context stays small.
- A new repo can run one CLI command to generate repo facts.
- A skill can update docs without overwriting custom structure.
- Glossaries stay project-specific and avoid generic stack terms.
- `inventory.md` identifies intentional reuse points, not every symbol.
- Existing project docs can be preserved while adopting the Project Context workflow.
- `/plan` surfaces architectural divergence, side effects, and consequences before implementation.
- Code-quality recommendations are grouped by risk and timing, not presented as undifferentiated refactor work.
- A domain-strong contributor can understand the user-facing concepts and ask the agent for architecture consequences without reading dense architecture docs first.
- An agent can find the closest existing implementation before proposing new structure.

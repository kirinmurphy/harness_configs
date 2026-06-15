---
name: project-context
description: Use ONLY when the user explicitly asks to build or refresh a project's human-facing handoff docs (a "Project Context" set — glossary, inventory, README under docs/project-context/ or docs/handoff/) — via the `/inventory` command or a clear instruction like "run inventory", "refresh project context", "update the glossary", or "make this project easier for another developer to understand". The skill orchestrates the deterministic `roborepo project-context inventory` scan, then updates curated docs while preserving their custom structure. Do not auto-invoke for ordinary code edits, quick notes, PR descriptions, or generic architecture essays; do not trigger on the mere presence of docs; and never treat Project Context docs as source of truth — always verify against code, tests, schemas, migrations, and runtime behavior.
---

# Project Context

Project Context is a lightweight handoff system: lean human-readable docs that organize an
app's own concepts, reusable parts, and commands so a domain-strong contributor can speak in
the project's terminology and extend it safely. The docs are companions to the code, never a
replacement for inspecting it.

This skill owns the judgment and orchestration. The deterministic repo scan lives in the CLI
(`roborepo project-context inventory`); the always-on pointer lives in generated agent rules.
Keep those surfaces separate: the CLI collects facts, the rules point, this skill decides how
to turn facts into curated prose.

## Source Of Truth

Project Context docs are human orientation, not authority. When docs disagree with code,
tests, schemas, migrations, runtime behavior, or explicit product decisions, those win.
Inspect the authoritative source, confirm real behavior, then update the docs if they drifted.
Never let the docs become a parallel spec an agent follows blindly.

## When To Activate

Explicit invocation only — never on accidental keyword overlap:

- `/inventory` or "run inventory" — scan the repo and refresh the generated facts + curated docs.
- "refresh project context", "update the glossary", "update the inventory" — focused curated-doc update.
- "make this project easier for another developer to understand".

Related work is handled by sibling surfaces, not this skill: code-quality cleanup lives in the
`tighten` skill; flagging how a proposed change collides with existing functionality is the
always-on Impact Awareness convention.

## Workflow

1. **Discover** the docs location using this deterministic order:
   1. `project-context.config.json`
   2. `package.json` `"projectContext"` field
   3. `docs/project-context/`
   4. an existing documented location in `AGENTS.md`
   5. `docs/handoff/`
   6. create `docs/project-context/` only when initialization is explicitly requested.
2. **Scan** with `roborepo project-context inventory [path]` to write generated facts. Add
   `--summary` when a quick human-readable digest helps. Fall back to manual inspection only
   if the CLI is unavailable.
3. **Read** the generated facts (`generated/repo-scan.json`) and the relevant existing curated
   docs. Do not load every doc by default — load only what the task touches.
4. **Verify** any claim against the real code before writing it. The scan's buckets are
   heuristic; confirm before asserting.
5. **Update** curated docs with small edits, preserving headings and custom structure.
6. **Mark uncertainty** as a TODO or "needs confirmation" note rather than guessing.
7. **Report** doc/code drift you found, separately from the edits you made.

## Curated Doc Merge Rules

- Preserve existing headings and custom sections.
- Make small edits instead of rewriting whole docs. Full rewrites are explicit, never default.
- Append TODOs for uncertain claims; report deleted/renamed/ambiguous concepts separately.
- Ask before migrating existing docs into `docs/project-context/`.
- Glossary = what project-specific terms mean, organized by product module/workflow. Exclude
  generic stack vocabulary (API, component, route, migration, service, env var) unless the
  project gives the term special meaning.
- Inventory = where to build from: intentional reuse surfaces, important commands, locations,
  and a "Not Separate Surfaces Yet" section that prevents premature extraction. Do not document
  every internal helper.
- Record environment variable **names** only. Never record values.

## Lean Doc Set

For new projects, scaffold only what the project needs:

```txt
docs/project-context/
  README.md            # user API: what docs exist, which commands, what the agent guards
  glossary.md          # project-specific product/subject-matter terms, by module
  inventory.md         # reusable parts, commands, important locations, build-from surfaces
  extension-paths.md   # optional; skip when it would be speculative roadmap prose
  generated/
    repo-scan.json     # written by the CLI
    repo-summary.md    # optional; only with --summary
```

For existing projects, preserve their current docs location and structure unless migration is
explicitly requested.

## Risk Checkpoints

Take extra care, and tell the owner what may break, what pattern to inspect, and what to
verify, when a change touches: authentication; authorization/ownership/admin; database schema
and migrations; API behavior and mutations; environment variables and deployment config; file
uploads and storage; external integrations.

## Exclusions

Never document: `node_modules`, build output and framework caches, lockfile internals,
generated framework files, secret values, generic stack vocabulary, every internal helper, or
large vendored assets.

## Project Context

- If a repo has Project Context docs (`docs/project-context/`, `docs/handoff/`, or a location set in `project-context.config.json` / `package.json` `projectContext`), use the ones relevant to the task as human orientation: terminology, user commands, reusable parts, extension paths.
- Do not treat these docs as source of truth. Inspect the code, tests, schemas, migrations, and runtime behavior before making implementation claims. When docs disagree with those, the code wins.
- Do not load every handoff doc by default; use only the docs the task touches.
- If the docs are missing, stale, or inconsistent with the code, suggest the `project-context` skill or `roborepo project-context inventory`.
- If a repo has no such docs, ignore this section.

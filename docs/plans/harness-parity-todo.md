# Harness Parity Todo

## Todo

1. Design true layered root-config inheritance.
   - Priority: high.
   - Current model separates read-mostly symlinks from root config export: mutable root config stays local even under `managed`; local divergent files mean adopted/user-owned.
   - Desired model: harness repo provides baseline config, user global config can inherit/add/override it, and local repo context can overlay project-specific instructions/config where harnesses support it.
   - Research whether Claude/Codex support native include/import/layering for `~/.claude/settings.json` and `~/.codex/config.toml`; if not, design generated/merged config with clear source ownership and drift checks.
   - Define how this interacts with `managed`, `adopt`, future update command, secrets/local machine config, and repo-local `CLAUDE.md`/`AGENTS.md`.

2. ~~Implement per-repo skill installer.~~ **DONE** — exposed as `roborepo skill symlink-local`
   (`scripts/cli/skills.mjs` + `scripts/cli/skill-lib.mjs::linkLocalSkills`); links repo-local
   `.agents/skills/` into Claude and Codex homes without losing global skill parity.

3. Decide placement for global coding conventions.
   - Candidate rule topics:
     - pure utilities use `function`
     - named exports preferred
     - helpers at file bottom
     - no procedural comments
     - constants over loose enum/status strings
     - no emoji in UI; use icons where appropriate
   - Open question: compact global rules only, expanded skill references, or both.

4. Redesign managed/adopt/update installer model.
   - Clarify top-level choices: `managed` as repo-hosted symlink logic for read-mostly assets plus local root-config export; `adopt` as copy/replicate/merge into user-owned global config.
   - Treat merge review output as post-action guidance, not a selectable install branch.
   - Define archive/not-adopted folder layout, idempotency rules for repeated adopt runs, and whether repo updates use `adopt` again or a separate update command.
   - Revisit whether a layered model is possible: harness repo baseline, global config overlay, local repo overlay.

## Open Decisions

- Whether stack-specific context should be expressed as skills only, rules only, or rules that trigger skills.
- How much local repo config should override global behavior automatically versus by explicit user opt-in.

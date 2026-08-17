---
name: roborepo-development
description: >
  INTERNAL to this repo. Use when developing or maintaining roborepo itself: installer/update/
  repair/uninstall plumbing, package/apply/workspace state, symlink and skill-linking machinery,
  rules/permissions generation, CLI modules, portal/telemetry, tests, and local machine
  lifecycle behavior. This is the mechanic's manual for the tool implementation. Triggers:
  "how does this repo work", "roborepo development", "harness config architecture",
  "install scripts", "add an install step", "package mode", "workspace roots", "the symlink
  model", working on scripts/, bin/, manifests/platform/, or local/skills/. SKIP for ordinary
  shared skill/rule content authoring — use roborepo-support for that instead. This skill is
  repo-local only; never global and never exported to client repos.
---

# Roborepo Development (internal)

Mechanic's manual for developing roborepo itself. Distinct from `roborepo-support`
(operating shared/exportable skill, rule, hook, MCP, and parity content). This skill is
firewalled to this repo — it loads only when an agent works inside this repo.

**This file does NOT restate the docs.** The docs are the source of truth; this skill is a map
to them plus the judgment that isn't written down. Read the doc, then apply the gotchas below.

## Package development

When creating, changing, installing, removing, or reviewing a RoboRepo package (anything under
`globals/packages/<id>/`, or the `roborepo package *` CLI family), load
`references/package-development.md` before editing. Don't restate it here — it owns manifest
schema, resource-type validation depth, apply/reconcile behavior, and the completion checklist.

## Which doc answers which question

| Question | Doc |
|----------|-----|
| Symlink map, sync flow, two skill layers, client utilities | `docs/user/reference/architecture.md` |
| The current `roborepo` CLI surface | `docs/user/reference/roborepo-cli.md`, `manifests/platform/cli/command-definitions/**`, `manifests/platform/cli/removed.json` |
| Detailed CLI internals and install/PATH notes | `docs/user/reference/roborepo.md` |
| Conflict / collision behavior on install | `docs/user/reference/config-collision-handling.md` |
| Rules generation + layering | `docs/internal/rules-parity-and-layering.md` |
| Skill/command mechanisms and trigger fixtures | `docs/internal/skills-and-commands.md`, `docs/user/reference/roborepo-skills.md` |
| Hook behavior (Claude / Codex) | `docs/user/reference/{claude,codex}-hooks.md` |
| NPM release workflow and maintainer doc placement | `docs/internal/npm-release.md` |
| Install UX + daily commands | `docs/user/guides/setup-and-daily-use.md`, `docs/user/guides/install-workflows.md` |
| Skills, two layers, client utilities (user-facing) | `README.md` |

## Repo dir convention (the one thing to internalize first)

- `globals/claude/` + `globals/codex/` + `globals/agents/` = SOURCE symlinked/linked into the user's
  GLOBAL `~/.claude`/`~/.codex` at install time.
- `.claude/` + `.codex/` (dotdirs) = THIS repo's own PROJECT-SCOPE skill config, NOT global.
- `globals/packages/<package>/skills/<name>/` = canonical package-owned shared/advisory layer
  (global + exportable). At install time, skills are materialized into
  `~/.roborepo/skills/<name>` and each harness's native dir links to that cache entry. System skills
  that are not package-owned can still live under `globals/agents/skills/<name>/`. No intermediate
  `globals/claude/skills/` directory exists. `local/skills/` = internal layer (this repo only, via
  `.claude/skills` + `.codex/skills` project-scope dotdirs). The firewall between them is structural
  — see below.
- Codex scans `.codex/skills` for project-scope skills.
- Shared skills use package-owned skill resources or system `globals/agents/skills/` as canonical
  source; repo-local skills use `local/skills/` as canonical source and symlink into project-scope
  harness folders.
- Mutable global config files should not be direct symlinks to repo source; use a generated or
  exported active file so runtime trust, hook approval, and machine-local state stay outside the
  shared baseline.

Everything else (the two symlink levels, the layer table) lives in
`docs/user/reference/architecture.md`. Read it there.

## Operational judgment (not in the docs)

- **Adding any skill:** prefer `roborepo skill new`. Shared skill → a package under
  `globals/packages/`, then run `roborepo skill sync-global` to refresh the machine-local cache and
  harness views. Shared command surfaces are rendered from package `slash-command` resources; run
  `roborepo skill render-commands --check` and `roborepo skill triggers --check` when descriptions
  or command exposure change. Internal/
  repo-only skill → `local/skills/`, then run `scripts/build/link-skills.sh` for this repo's
  project-scope links. Never hand-write `ln`.
- **The firewall is code, not convention.** `link-skills.sh` runs one pass per layer;
  `roborepo` reads package/system shared skill sources. There is no code path from `local/skills/`
  to global config or to a client export. Don't add one.
- **Reuse the link/conflict primitives.** Bash: `scripts/install/install-lib.sh` (`link_item`,
  `link_item_clean`, collision prompts) and `scripts/build/skill-lib.sh` (`list_source_skills`). Node:
  `scripts/cli/skill-lib.mjs` (`listSourceSkills`, `ensureSymlink`, `linkLocalSkills`, `writeZip`).
  Don't re-derive the "what is a skill" rule or hand-roll `ln`/`symlink` logic.
- **Generated outputs are not editable.** `globals/claude/CLAUDE.md` and `globals/codex/AGENTS.md` are rendered
  from `globals/rules/{shared,claude,codex}/` plus enabled package fragments by
  `scripts/build/render-rules.sh`. Agent permission outputs are rendered from
  `manifests/inventory/agent-permissions.json` by `scripts/build/render-agent-permissions.mjs`.
  Edit sources, re-render, then check. `doctor.sh` flags drift.
- **`generated/` files are install baselines, not just fixtures.** `generated/<provider>/` is both the
  tracked artifact tests diff against AND `rootConfigBaseline` (`scripts/cli/paths.mjs`), which
  install/apply merges into the user's live `~/.claude`/`~/.codex` (`scripts/cli/presets.mjs`).
  Claude's merge UNIONS permission arrays, so anything in the tracked file is additively copied into
  every real home and cannot be removed by a later render. Never change a `generated/` file to make a
  test deterministic: a placeholder that reads as obviously fake in the repo (`/Users/you`) ships
  verbatim to users. Fix the test instead — point it at a temp render, or pass explicit render
  options — and keep the tracked artifact equal to what a real install should produce.
- **Adding global commands:** there is now ONE global command (`roborepo`); prefer adding a
  `roborepo` subcommand over a new `bin/` entry. If you ever DO add a `bin/` command, wire it in
  three places — `install-global-commands.sh` (preflight + `link_command`), `doctor.sh` (file +
  link check), `verify-install.sh` (link check) — or it's half-installed.
- **Script conventions:** idempotent; `--dry-run`; verifiers take `--check`. Collisions warn,
  preserve the local copy, print an agent merge prompt — never clobber.
- **Pre-launch compatibility:** until roborepo has launched and real users depend on public
  behavior, do not add backwards-compatibility shims, deprecated aliases, or old command paths
  when changing features. Prefer one clear current interface. Start supporting deprecated
  commands/features only after launch, when compatibility is an explicit product requirement.
- **`--quiet`/`-q` on the checkers.** `doctor.sh`, `verify-install.sh`, `test-roborepo.sh`, and
  `link-skills.sh` all accept `--quiet`: suppress the per-check `ok:`/`+ linked` lines, still
  print every failure plus a one-line `… (N checks)` / `N passed, M failed` summary, exit code
  unchanged. Use the bare script + `--quiet` for a readable, permissionable check — never pipe a
  verifier through `grep`/`head` to trim output. `doctor.sh` also folds `link-skills.sh --check`,
  so it is the single repo-health entrypoint (`--installed` adds global ~/.claude·~/.codex live
  link checks including per-skill skill links); `test-roborepo.sh` stays the separate test suite.
- **Cross-platform floor:** Node cores use only `node:` built-ins (no shelling to
  `zip`/`unzip`/`ln`), so the same code runs on macOS/Linux/Windows. Keep it that way.
- **Skill discovery paths.** Project scope: `.codex/skills` (Codex) and `.claude/skills` (Claude).
  Global scope: `~/.codex/skills/<name>` (Codex) and `~/.claude/skills/<name>` (Claude) — roborepo
  links per-skill symlinks at install time (`link_global_skills` in install-lib.sh). Symlinked skill
  folders are followed. No `.agents/skills` anywhere.

## The `roborepo` CLI (the single consumer front door)

`roborepo` is the ONE command a consumer runs. `scripts/cli/main.mjs` is a thin composition root:
load catalog, resolve command, run adapter. User-facing command metadata lives in schema v2 catalog
files under `manifests/platform/cli/command-definitions/**`; retired command guidance lives in
`manifests/platform/cli/removed.json`. Prefer fixing catalog definitions or docs over command
execution code unless behavior is actually wrong. Subcommand impls live under `scripts/cli/`;
`paths.mjs` defines app/workspace/state roots and package mode, while `skill-lib.mjs` holds shared
Node primitives (zip, prompts, symlink helpers). Bash shim is `bin/roborepo`. No-arg = interactive
menu (arrow keys + numbered fallback via `selectMenu` in `cli/skill-lib.mjs`).
Subcommands, grouped by category:

- `skill new` / `skill adopt` / `skill export-to-project` / `skill link-project` / `skill inspect` /
  `skill audit` / `skill triggers` / `skill render-commands` / `skill native` — shared skill,
  slash-command, ownership, and invocation-policy tools. They operate on the shared/client-local
  layer — never `local/skills/`.
- `index code|docs [path]`, `index code [path] --watch`, `run <cmd>` (`cli/index.mjs`) — package-owned
  jcodemunch/jdocmunch wrappers + the trimmed-output runner. `[path]` optional, defaults to cwd,
  resolved to absolute. `index code --watch` writes the pidfile `/tmp/jcmwatch-<md5(absdir)>.pid` that the
  Claude SessionStart hook reads — keep that in sync with `globals/claude/settings.json` if you
  change it.
- `mcp add <name-or-url>` / `mcp apply` (`cli/mcp.mjs`) — register/apply MCP server config with
  Claude and Codex. Presets live in `manifests/inventory/mcp-presets.json`; portable intent lives
  in `manifests/inventory/mcp-servers.json`.
- `package enable <package-id>` / `package disable <package-id>` / `package manage` / `presets` — package and preset
  feature toggles. Package mode separates immutable app files, portable workspace resources, and
  machine-local state; do not collapse those roots.
- `package create|list|inspect|validate|enable|disable|reconcile|adopt-live` (`cli/packages.mjs`)
  — full package lifecycle surface. See `references/package-development.md` for details on each subcommand.
  `enable`/`disable` already apply live immediately — no `roborepo update` needed afterward.
- `setup` / `apply` / `workspace` / `version` — package-mode setup and root inspection tools.
- `web` / `telemetry ...` — local portal and telemetry capture/reporting.
- `update`/`repair`/`uninstall`/`doctor`/`rules`/`permissions` — lifecycle verbs that
  dispatch to the existing scripts. `update` re-runs `scripts/install/main.sh`; in package mode it
  aliases to `apply`.

Client skill behavior details:
- `skill export-to-project` / `skill link-project` / `skill native` — the
  dual-harness skill tools (export bundles + copies into `.claude/skills` + `.codex/skills`;
  project linking is `.codex/skills` → `.claude/skills`, with prune; native prints the harness
  plugin/skill escape hatch). Read only the shared /
  client-local layer — never `local/skills/`.

Adding a new `roborepo` subcommand: add or extend the command definition under
`manifests/platform/cli/command-definitions/**`, point it at the existing execution adapter where
possible, and only write module code under `scripts/cli/` when the behavior is new. Add replaced or
removed public commands to `manifests/platform/cli/removed.json` with direct replacement guidance.
Run `node scripts/test/cli-command-catalog-check.mjs` after catalog edits and
`node scripts/test/cli-surface-integration-check.mjs` after resolver, adapter, help, menu, or
retired-command behavior changes. Only ONE global command exists (`roborepo`), so the old
per-command 3-place wiring is gone — `install-global-commands.sh`, `doctor.sh`,
`verify-install.sh` each reference only `roborepo`. MAINTAINER scripts (`render-rules.sh`,
`link-skills.sh`, `test-*.sh`) stay OUT of `roborepo`.

**Tests:** `scripts/test/cli-command-catalog-check.mjs` validates schema v2 command catalog
definitions and removed-command mappings. `scripts/test/cli-surface-integration-check.mjs` exercises
help, namespace fallbacks, retired command guidance, concise/verbose doctor output, and detached
portal routing. `scripts/test/test-roborepo.sh` smoke-tests the subcommands (skill link-project/prune/
uninstall/conflict, export-to-project/override/firewall/self-pollution guard, sync-global, inspect,
native, trigger checks, run, `mcp add/apply`, lifecycle dispatch, menu fallback, package/workspace
paths) against throwaway temp repos. Run it after behavior changes under `scripts/cli/`. `doctor.sh`
also asserts `skill-lib.sh` and `cli/skill-lib.mjs` agree on the skill list (parity guard). Use
`scripts/test/test-install-collisions.sh --quiet` after installer, root-config, link, or
collision-flow edits.

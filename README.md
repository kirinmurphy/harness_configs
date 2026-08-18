# RoboRepo

Claude Code & Codex global harness configuration with CLI support.

The repo

- provides a CLI to update both Claude and Codex configurations simultaneously
- provides built-in global rules, skills, and features that can be enabled individually

Design goals:

- keep Claude and Codex configuration aligned (where desired)
- reduce token overuse
- reproduce same harness configs across machines
- keep user-owned local config safe during updates

## Start Here

Supports macOS and Linux;  
Windows support is there, but not really tested.

[Install CLI](docs/user/guides/first-time-setup.md)

## Using the roborepo CLI

After install, you will have a `roborepo` command line tool.

Use the CLI to update items and configuration in your global setup so they work across every harness roborepo manages.

| Command                          | What it does                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `roborepo`                       | Open the interactive menu — browse and run any command without memorizing flags.                     |
| `roborepo init`                  | Set up a new installation for first use. Safe to re-run; it will not replay your choices.            |
| `roborepo library`               | Choose which behaviors (skills, commands, packages) are active. Same workflow as `roborepo package manage`. |
| `roborepo update`                | Re-apply harness config on this machine to pick up new or changed global config.                     |
| `roborepo mcp add <name-or-url>` | Register an MCP server with both Claude and Codex in one step.                                       |
| `roborepo index code [path]`     | Index a repo's source with the enabled package-owned indexer (`roborepo package enable jcodemunch`). |
| `roborepo skill inspect <name>`  | Inspect a skill's source, ownership, native metadata, collision state, and harness install state.    |
| `roborepo skill triggers --check` | Check skill trigger fixtures so medium-risk skills do not drift into broad auto-load behavior.       |
| `roborepo skill native [--full]` | Show native Claude/Codex plugin entrypoints; `--full` prints native help output inline.              |
| `roborepo web`                   | Open the local web portal at `http://127.0.0.1:4317/config`; keeps it running in the background.     |
| `roborepo web` + `/plans`        | Browse local `docs/plans/**/*.md` files and copy plan context or `/plan-docs` workflow prompts.     |
| `roborepo localhoster [--json] [--open]` | List active localhost HTTP apps, save route shortcuts, report capability limits, or open `/localhoster`. |
| `roborepo telemetry enable` / `disable` | Turn token-usage capture on or off. `telemetry status` shows capture state; `telemetry purge --all --backup` resets capture, backing up first. |
| `roborepo doctor`                | Health-check the install and report what is linked, missing, or drifted.                             |
| `roborepo uninstall`             | Remove RoboRepo-managed configuration and machine state. Preserves your workspace; does not remove the npm package. |

[View all roborepo commands](docs/user/reference/roborepo-cli.md)
[View the skills interface](docs/user/reference/roborepo-skills.md)

## Global Behavior

Installing the `roborepo` core applies a minimal baseline, then `roborepo init` walks you through choosing which behaviors to enable — skills, commands, code conventions, chat-time output, and token-optimization packages. The chooser mirrors the `/config` sections, one section per step (`←`/`→` between sections, `Space` to toggle, `Enter` to advance). Only the baseline is applied automatically; everything else is opt-in, and telemetry stays off unless you turn it on. Rerun the chooser any time with `roborepo library`. Noninteractive runs skip the wizard and apply the baseline headlessly.

If you installed from npm, `roborepo init` is the one command to run next:

```sh
npm install -g codethings-roborepo-alpha
roborepo init
```

Running `roborepo` on an installation that has not been initialized takes you into `init` automatically. Everything else — `roborepo doctor`, `roborepo version`, `--help` — stays available before initialization, so a broken install is still diagnosable.

> **Just want token telemetry?** You can install only the local telemetry capture + portal — without the rest of the global config — with `roborepo telemetry install` (or `./bin/roborepo telemetry install` from a fresh clone). It turns capture on immediately, so you can measure your token usage before adopting the full suite; upgrade later by re-running the normal install. Use `roborepo web` to open the portal.

- [Token Optimization / Efficiency](#token-optimization--efficiency)
- [Automatic Skill Helpers](#automatic-skill-helpers)
- [Commands](#commands)
- [Chat-Time Output](#chat-time-output)
- [Hooks](#hooks)
- [Harness Specifics](#harness-specifics)
  - [Codex](#codex)
  - [Claude](#claude)

### Token Optimization / Efficiency

|                                                         |                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [jcodemunch-mcp](docs/user/reference/jcodemunch.md) | Code indexer that lets agents find relevant source through symbol search and targeted context.    |
| [jdocmunch-mcp](docs/user/reference/jdocmunch.md)   | Documentation indexer that lets agents query headings and sections instead of reading whole docs. |
| Caveman plugin                                          | Makes default agent output terse to reduce token usage.                                           |
| Minimal verification                                    | Agents run the narrowest useful check and report a `pass/fail` receipt.                           |
| Local Telemetry                                         | Enable, monitor and analyze your token usage across harnesses.                                    |

### Automatic Skill Helpers

|                              |                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| code-style                   | General cross-language coding conventions: naming, file organization, helper placement, comments, exports, readability.                 |
| javascript-typescript        | TypeScript/JavaScript utility code: ESM, lint/type errors, exports/imports, helpers, type safety, JS/TS style.                          |
| react                        | React, Next.js, Remix, and Vite React work touching JSX/TSX, components, hooks, client state, effects, routing UI, and React tests.     |
| test-harness                 | Choosing, running, and explaining tests; debugging CI failures; deciding scoped vs. full checks.                                        |
| supabase-integration-testing | Remote/real Supabase integration tests: RLS policies, RPC calls, migrations, service-role setup, anon access, unmocked DB/API behavior. |
| roborepo-support             | Working on this repo itself: shared skills/cache, global rules, hooks, settings, and Claude/Codex parity.                               |

### Commands

Use these when you want to intentionally start a named workflow.

|                       |                                                                                     |     |
| --------------------- | ----------------------------------------------------------------------------------- | --- |
| `/case-study`         | Write a long-form architecture case study about a real design decision.             |
| `/frontend-design`    | Apply Claude's frontend design workflow to build or review a substantial UI change. |
| `/plan-docs`          | Create, manage, review, and continue repository plan documents.                     |
| `/tighten`            | Clean up code against this project's own patterns with specific, anchored callouts. |
| `/wrap-up`            | End a work session cleanly: self-review added code, sync docs, commit, then produce a handoff note for the next chat. |
| `/technical-writing` | General technical writing guidance for reader-facing docs: doc shapes, section-writing guidance, anti-patterns, and a prose review loop |
| `/plan-promote` | Use when reviewing and preparing an existing repository implementation plan before development begins. Inspect the current repository, reconcile stale assumptions, improve the existing plan in place, fix obvious issues, identify genuine tradeoffs, ask the user only about material decisions, validate readiness, and stop before implementation. Do not use for creating a new plan from scratch, writing feature code, creating worktrees, changing lifecycle state, or resuming active implementation. |
| `/plan-start` | Use when beginning implementation from an existing prepared repository plan. Inspect the current plan and repository, create or safely reuse an isolated worktree, implement every in-scope unblocked objective, make clear or reversible decisions autonomously, continue around blockers, verify the work, synchronize the plan, and report the result. Do not use for initial plan preparation, lifecycle orchestration, portal actions, integration-branch closeout, or implementation without an existing plan. |

**Plain-Language Triggers**: Some named workflows can also be started in ordinary chat: "capture this", "write a case study about this", "make this a durable technical plan", or "tighten this."

### Chat-Time Output

Lighter-weight behaviors that only generate messages in the conversation — no files written, no workflow started. Each is an independently toggleable package (on by default), surfaced in the config panel's **Chat-Time Output** section and merged into both the Claude and Codex rules files.

|                                                                     |                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [Convention capture](docs/user/reference/convention-capture.md) | Agents surface newly confirmed conventions as inline recommendations during the chat.                              |
| Impact awareness                                                    | When you propose a change, agents flag (`> 🧭 Impact:`) how it collides with or duplicates existing functionality. |
| Skill visibility                                                    | Agents report which skills shaped a response (`> 🧩 Skills loaded:`) so behavior changes are traceable.            |

![Chat Time Output](./docs/images/chat_notes.png)

### Hooks

Hooks are shell commands the harness runs on its own when an event fires — a session
starts, or a tool is about to run. They steer the agent without the agent having to
remember to do anything. The defaults fall into two jobs:

|                |                                                                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session nudges | On session start, tell the agent what's available — caveman mode, jcodemunch/jdocmunch index state.                                                                                          |
| Tool guards    | Before a tool runs, redirect or tidy it — block `Grep`/`Glob` (and source-file `grep`/`cat`/`find` in Bash) toward jcodemunch, trim noisy Bash output, flag writes into managed config dirs. |
| Telemetry      | When enabled, capture metadata-only session/tool events for later analysis. Turn it on later with `roborepo telemetry enable`.                                                               |

Most of this is Claude-side, where the hook system is richer; Codex runs a single
session-start nudge and leans on its rules file for the rest. Full breakdown:
[Claude Hooks](docs/user/reference/claude-hooks.md), [Codex Hooks](docs/user/reference/codex-hooks.md).

### Harness Specifics

#### Codex

- **Plugins:** GitHub
- **[Hooks](docs/user/reference/codex-hooks.md) (unique):** caveman activation runs as a session hook here; jcodemunch enforcement lives in the rules file, not in tool hooks
- **Rules:** generated command policy and always-on rules for tests, builds, local checks, and harness behavior
- **Model/features:** `gpt-5.5`, medium reasoning, hooks, JavaScript REPL, idle-sleep prevention

#### Claude

- **[Hooks](docs/user/reference/claude-hooks.md) (unique):** caveman comes from the `caveman` plugin instead of a hook; tool-level guards (block `Grep`/`Glob`, trim Bash output, guard writes into managed dirs) exist only here
- **Behavior flags:** thinking/away-summary stay quiet; dangerous-mode prompt skipped

## Maintaining the Harnesses

Harness source lives under `globals/`, generated installation candidates under `generated/`, and the
data that drives the build/install scripts under `manifests/`:

- `globals/packages/<id>/` — complete authored implementation of one configurable, user-selectable
  behavior (rules, hooks, skills, MCP config, permissions, commands) across both harnesses
- `globals/system/` — mandatory, always-installed authored source with no enable/disable state:
  `globals/system/rules/`, `globals/system/skills/roborepo-support`, `globals/system/hooks/<harness>/`
- `globals/harnesses/` — native per-harness templates (managed markers, starter config) with no
  optional-package behavior baked in
- `generated/claude/`, `generated/codex/` — derived, installation-ready system candidates (settings,
  rules render, hooks baseline); never edited directly, regenerated from system source + templates
- `generated/packages/<id>/<harness>/commands/` — per-package generated slash-command wrappers,
  composed into the live harness commands dir only when that package is enabled
- `manifests/inventory/` — shared inventory that remains central: MCP presets, package categories,
  trigger fixtures, and agent permission behavior buckets
- `manifests/platform/` — install/verify/render plumbing: the `.tsv` path tables, content checks,
  the CLI usage catalog, and merge prompts
- `manifests/platform/presets.json` — preset bundle source of truth for onboarding/apply/remove

Every element is authored once and fanned out to both harnesses by the build/link step. New here?
Start with [How the Harnesses Work, and How We Build Parity](docs/internal/harnesses-explained.md)
for the build/parity model; see **Under The Hood** below for the full doc set.

## Reference

### User Docs

- [First-Time Setup](docs/user/guides/first-time-setup.md)
- [Setup and Daily Use](docs/user/guides/setup-and-daily-use.md)
- [Install Workflow Choices](docs/user/guides/install-workflows.md)
- [Supported Harnesses](docs/user/guides/harnesses/supported-harnesses.md)
- [Harness Provider Interface](docs/user/guides/harnesses/harness-provider-interface.md)
- [Plan Docs Walkthrough](docs/user/guides/plan/lifecycle/plan-docs.md)
- [Integration Check Walkthrough](docs/user/guides/plan/lifecycle/integration-check.md)
- [roborepo CLI Commands](docs/user/reference/roborepo-cli.md)
- [roborepo CLI Reference](docs/user/reference/roborepo.md)
- [Package Docs Index](docs/user/README.md)

### Under The Hood

- [How the Harnesses Work, and How We Build Parity](docs/internal/harnesses-explained.md)
- [Maintainer Docs Map](docs/internal/docs-map.md)
- [Harness Anatomy and Parity](docs/internal/harness-anatomy.md)
- [How It Works](docs/user/reference/architecture.md)
- [Config Collision Handling](docs/user/reference/config-collision-handling.md)
- [Rules Parity and Layering](docs/internal/rules-parity-and-layering.md)
- [Skills And Slash Commands](docs/internal/skills-and-commands.md)
- [Plans Portal Technical Reference](docs/user/reference/plans-portal.md)
- [Claude Hooks](docs/user/reference/claude-hooks.md)
- [Codex Hooks](docs/user/reference/codex-hooks.md)

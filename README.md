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

[Install CLI](docs/guides/first-time-setup.md)

## Using the roborepo CLI

After install, you will have a `roborepo` command line tool.

Use the CLI to update items and configuration in your global setup so they work across both harnesses.

| Command                          | What it does                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `roborepo`                       | Open the interactive menu — browse and run any command without memorizing flags.                     |
| `roborepo onboard`               | Run the onboarding wizard to choose which behaviors (skills, commands, packages) are active.         |
| `roborepo update`                | Re-apply harness config on this machine to pick up new or changed global config.                     |
| `roborepo mcp add <name-or-url>` | Register an MCP server with both Claude and Codex in one step.                                       |
| `roborepo index code [path]`     | Index a repo's source with the enabled package-owned indexer (`roborepo enable jcodemunch`). |
| `roborepo skill inspect <name>`  | Inspect a skill's source, ownership, native metadata, collision state, and harness install state.    |
| `roborepo skill triggers --check` | Check skill trigger fixtures so medium-risk skills do not drift into broad auto-load behavior.       |
| `roborepo skill native [--full]` | Show native Claude/Codex plugin entrypoints; `--full` prints native help output inline.              |
| `roborepo serve`                 | Open the local web portal at `http://127.0.0.1:4317/config`; use `--detach` to keep it running in the background. |
| `roborepo telemetry enable` / `disable` | Turn token-usage capture on or off. `telemetry status` shows capture state; `telemetry purge --all --backup` resets capture, backing up first. |
| `roborepo doctor`                | Health-check the install and report what is linked, missing, or drifted.                             |

[View all roborepo commands](docs/reference/services/roborepo-cli.md)
[View the skills interface](docs/reference/services/roborepo-skills.md)

## Global Behavior

Installing the `roborepo` core applies a minimal baseline, then launches an onboarding wizard so you choose which behaviors to enable — skills, commands, code conventions, chat-time output, and token-optimization packages. The wizard mirrors the `/config` sections, one section per step (`←`/`→` between sections, `Space` to toggle, `Enter` to advance). Only the baseline is applied automatically; everything else is opt-in, and telemetry stays off unless you turn it on. Rerun the wizard any time with `roborepo onboard`. Noninteractive installs skip the wizard and apply the baseline headlessly.

> **Just want token telemetry?** You can install only the local telemetry capture + portal — without the rest of the global config — with `roborepo telemetry install` (or `./bin/roborepo telemetry install` from a fresh clone). It turns capture on immediately, so you can measure your token usage before adopting the full suite; upgrade later by re-running the normal install. Use `roborepo serve` or `roborepo web` to open the portal.

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
| [jcodemunch-mcp](docs/reference/services/jcodemunch.md) | Code indexer that lets agents find relevant source through symbol search and targeted context.    |
| [jdocmunch-mcp](docs/reference/services/jdocmunch.md)   | Documentation indexer that lets agents query headings and sections instead of reading whole docs. |
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
| `/technical-planning` | Create or revise a durable technical planning document.                             |
| `/inventory`          | Scan this repo and refresh its Project Context handoff docs (glossary, inventory).  |
| `/tighten`            | Clean up code against this project's own patterns with specific, anchored callouts. |
| `/wrap-up`            | End a work session cleanly: self-review added code, sync docs, commit, then produce a handoff prompt for the next chat. |

**Plain-Language Triggers**: Some named workflows can also be started in ordinary chat: "capture this", "write a case study about this", "make this a durable technical plan", "run inventory", or "tighten this."

### Chat-Time Output

Lighter-weight behaviors that only generate messages in the conversation — no files written, no workflow started. Each is an independently toggleable package (on by default), surfaced in the config panel's **Chat-Time Output** section and merged into both the Claude and Codex rules files.

|                                                                     |                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [Convention capture](docs/reference/services/convention-capture.md) | Agents surface newly confirmed conventions as inline recommendations during the chat.                              |
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
[Claude Hooks](docs/reference/services/claude-hooks.md), [Codex Hooks](docs/reference/services/codex-hooks.md).

### Harness Specifics

#### Codex

- **Plugins:** GitHub
- **[Hooks](docs/reference/services/codex-hooks.md) (unique):** caveman activation runs as a session hook here; jcodemunch enforcement lives in the rules file, not in tool hooks
- **Rules:** generated command policy and always-on rules for tests, builds, local checks, and harness behavior
- **Model/features:** `gpt-5.5`, medium reasoning, hooks, JavaScript REPL, idle-sleep prevention

#### Claude

- **[Hooks](docs/reference/services/claude-hooks.md) (unique):** caveman comes from the `caveman` plugin instead of a hook; tool-level guards (block `Grep`/`Glob`, trim Bash output, guard writes into managed dirs) exist only here
- **Behavior flags:** thinking/away-summary stay quiet; dangerous-mode prompt skipped

## Maintaining the Harnesses

Harness source lives under `globals/`, with the data that drives the build/install scripts under
`manifests/`:

- `globals/agents/skills/` — shared skill source, global and exportable
- `globals/claude/` — Claude global rules, hooks, commands, settings baseline, and skill links
- `globals/codex/` — Codex global rules, hooks, settings baseline, and managed markers
- `manifests/inventory/` — the supplied catalog you add items to: MCP presets, slash commands,
  skill-invocation policy, and agent permission behavior buckets
- `manifests/platform/` — install/verify/render plumbing: the `.tsv` path tables, content checks,
  the CLI usage catalog, and merge prompts
- `manifests/platform/presets.json` — preset bundle source of truth for onboarding/apply/remove

Every element is authored once and fanned out to both harnesses by the build/link step. New here?
Start with [How the Harnesses Work, and How We Build Parity](docs/reference/internal/harnesses-explained.md)
for the build/parity model; see **Under The Hood** below for the full doc set.

## Reference

### User Docs

- [First-Time Setup](docs/guides/first-time-setup.md)
- [Setup and Daily Use](docs/guides/setup-and-daily-use.md)
- [Install Workflow Choices](docs/guides/install-workflows.md)
- [roborepo CLI Commands](docs/reference/services/roborepo-cli.md)
- [roborepo CLI Reference](docs/reference/services/roborepo.md)
- [Documentation Index](docs/README.md)

### Under The Hood

- [How the Harnesses Work, and How We Build Parity](docs/reference/internal/harnesses-explained.md)
- [Harness Anatomy and Parity](docs/reference/internal/harness-anatomy.md)
- [How It Works](docs/reference/services/architecture.md)
- [Config Collision Handling](docs/reference/internal/config-collision-handling.md)
- [Rules Parity and Layering](docs/reference/internal/rules-parity-and-layering.md)
- [Skills And Slash Commands](docs/reference/internal/skills-and-commands.md)
- [Claude Hooks](docs/reference/services/claude-hooks.md)
- [Codex Hooks](docs/reference/services/codex-hooks.md)

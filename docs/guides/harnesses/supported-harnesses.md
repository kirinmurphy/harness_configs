# Supported Harnesses

Read this to understand what a *harness* is in roborepo, which ones are supported today, and what
each one actually receives when roborepo manages it.

If you are adding support for a new harness, read
[Harness Provider Interface](harness-provider-interface.md) instead — this guide covers the product
behavior, not the extension mechanism.

## What a Harness Is

A harness is a coding-agent CLI that reads its configuration from a directory in your home folder —
Claude Code reading `~/.claude`, Codex reading `~/.codex`, Gemini CLI reading `~/.gemini`.

Each of these tools stores broadly the same kinds of things: rules the agent should follow, skills
it can load, slash commands you can invoke, permission policy for what it may do without asking,
and MCP server registrations. Each one stores them in a *different file, format, and shape*.

roborepo keeps one version-controlled source of truth for that configuration and renders it into
whatever native form each harness expects. You edit rules once; Claude gets `~/.claude/CLAUDE.md`,
Codex gets `~/.codex/AGENTS.md`, Gemini gets `~/.gemini/GEMINI.md`.

The word "harness" is roborepo's term for the tool. "Provider" is the code inside roborepo that
knows how to talk to one — see the interface guide for that distinction.

## Currently Supported Harnesses

| Harness | id | Config home | Root config format |
| --- | --- | --- | --- |
| Claude Code | `claude` | `~/.claude` (Windows: `%APPDATA%\Claude`) | JSON (`settings.json`) |
| Codex | `codex` | `~/.codex` | TOML (`config.toml`) |
| Gemini CLI | `gemini` | `~/.gemini` | JSON (`settings.json`) |

You do not need all three. roborepo manages whichever ones it finds and ignores the rest.

## What Each Harness Receives

Support is not all-or-nothing. Each harness declares which capabilities it can accept, and roborepo
delivers exactly those. A blank cell means the harness has no native equivalent, not that support is
missing or broken.

| Capability | What it delivers | Claude | Codex | Gemini |
| --- | --- | :---: | :---: | :---: |
| `root-config` | The harness's main settings file | ✅ | ✅ | ✅ |
| `rules` | Generated global rules the agent reads every session | ✅ | ✅ | ✅ |
| `permissions` | Allow/ask/deny policy for tools and commands | ✅ | ✅ | ✅ |
| `skills` | Shared skill folders, linked into the harness | ✅ | ✅ | ✅ |
| `slash-commands` | `/command` wrappers | ✅ | ✅ | ✅ |
| `hooks` | Scripts that run on agent lifecycle events | ✅ | ✅ | ✅ |
| `mcp` | MCP server registrations | ✅ | ✅ | ✅ |
| `package-config` | Package-owned config fragments (e.g. the usage status line) | ✅ | ✅ | — |
| `telemetry-capture` | Session cost/tool-call capture | ✅ | ✅ | — |
| `telemetry-rate-limits` | Rate-limit windows parsed from session data | — | ✅ | — |
| `telemetry-transcripts` | Reading past session transcripts | ✅ | ✅ | — |
| `session-launch` | Starting a session from roborepo | ✅ | ✅ | — |

The blank cells are the honest shape of the product today. Gemini CLI receives every configuration
capability but no telemetry, because it does not expose the session data telemetry needs. Only Codex
reports rate-limit windows.

This matters when reading `roborepo doctor` output: a harness that lacks a capability produces no
checks for it, and *no checks* looks the same as *all checks passing*. Compare a harness against the
capability table above, not against another harness's check count.

## How a Harness Gets Connected

roborepo discovers harnesses; you do not register them by hand.

Discovery is deliberately narrow. For each known provider, roborepo checks only the locations that
provider's own manifest declares — its executable name on `PATH`, its home directory, its config
file. It never scans your filesystem broadly. The evidence it finds becomes a confidence level:

| Evidence found | Confidence |
| --- | --- |
| Executable on `PATH` **and** a home dir or config file | `confirmed` |
| Executable only, or config file only | `probable` |
| Home directory only | `possible` |
| Nothing | `absent` |

Each provider declares the minimum confidence it will accept. Meeting that bar makes the harness
eligible; roborepo then manages it on the next `roborepo update`.

Two consequences worth knowing:

- **Installing a new agent CLI is enough.** Install Gemini CLI, run `roborepo update`, and it
  starts receiving rules, skills, and commands. No config edit.
- **Discovery cannot invent a harness.** Only providers roborepo ships can be discovered. A provider
  is executable code, so a workspace cannot point roborepo at an arbitrary module and have it run.

## Commands

```bash
roborepo harness list              # every known harness and whether it is enabled
roborepo harness detected          # discovery results, machine-readable
roborepo harness inspect <id>      # one harness's manifest, capabilities, and state
roborepo harness enable <id>       # manage this harness
roborepo harness disable <id>      # stop managing it, without uninstalling roborepo
roborepo harness refresh           # re-run discovery
roborepo harness withdraw <id>     # strip roborepo-managed artifacts from that harness
```

`disable` and `withdraw` differ: `disable` stops future delivery and leaves existing files alone;
`withdraw` actively removes what roborepo put there. Run `withdraw --dry-run` first — it prints
exactly what it would remove and touches nothing.

An explicit `disable` survives `refresh`. Re-running discovery will not silently re-enable a harness
you turned off.

## Platform Support

macOS and Linux are the primary platforms and share the same install path. Windows has its own
PowerShell installer (`scripts/install/install-windows.ps1`) covering all three harnesses.

One Windows difference is worth knowing: Claude Code stores its config under `%APPDATA%\Claude`
rather than a `~/.claude`-style path. Codex and Gemini use `~/.codex` and `~/.gemini` on every
platform.

## Where to Go Next

- [First-Time Setup](../first-time-setup.md) — install roborepo and put it on your `PATH`
- [Setup and Daily Use](../setup-and-daily-use.md) — day-to-day workflows
- [Harness Provider Interface](harness-provider-interface.md) — add support for a new harness

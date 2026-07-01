# roborepo Skills Interface

`roborepo skill` is the parity-managed skills interface. Use it when a skill or command should be
shared through roborepo source, installed into both harnesses where supported, or exported into a
project.

Use native Claude/Codex commands when the action is harness-specific, such as plugin marketplace
management, plugin enable/disable state, updates, validation, or one-session plugin loading.

## Command Reference

| Command | What it does |
| --- | --- |
| `roborepo skill new` | Scaffolds a shared automatic helper, skill-backed slash command, or standalone slash command. |
| `roborepo skill adopt <name>` | Moves an unmanaged native skill from `~/.codex/skills` or `~/.claude/skills` into shared roborepo source. |
| `roborepo skill sync-global` | Refreshes `~/.roborepo/skills` and the installed harness skill views from shared skill source. |
| `roborepo skill export-to-project` | Copies shared skills into the current project and leaves a shareable zip bundle. |
| `roborepo skill link-project` | Links project-owned `.codex/skills/<name>` into `.claude/skills/<name>` when Claude project config exists. |
| `roborepo skill render-commands` | Renders generated slash command files from the command inventory. |
| `roborepo skill native [--full]` | Prints a concise native Claude/Codex plugin summary; `--full` prints native help output inline. |

## Managed Source And Install Shape

Shared skills are authored at `globals/agents/skills/<name>/`. The global install materializes each
enabled shared skill into `~/.roborepo/skills/<name>` with a `.roborepo-managed` marker, then links
installed harness views to that cache entry:

```text
~/.claude/skills/<name> -> ~/.roborepo/skills/<name>
~/.codex/skills/<name>  -> ~/.roborepo/skills/<name>
```

Project skills use the project as the boundary. Codex reads `.codex/skills/<name>` directly, and
`roborepo skill link-project` links Claude's project skills to that source when `.claude` exists.
This never touches global `~/.claude` or `~/.codex`.

## Native Escape Hatch

`roborepo skill native` is a guide, not a wrapper. It prints the static roborepo decision rule plus
a short curated summary of the native surfaces. Run `roborepo skill native --full` when you need the
installed CLIs' exact current help:

```sh
claude plugin --help
codex plugin --help
codex plugin marketplace --help
```

The default output is intentionally short and stable. `--full` queries the native CLIs live and
prints fallback examples for any unavailable section. The docs intentionally avoid freezing the full
native command catalog because Claude and Codex own those interfaces.

Use native commands for harness-specific marketplace state and plugin lifecycle. If a native skill
should become shared and version-controlled, run:

```sh
roborepo skill adopt <name>
```

## Naming Rules

- `global` means installed machine state: `~/.roborepo/skills`, `~/.claude/skills`, and
  `~/.codex/skills`.
- `project` means the current repo or worktree.
- The CLI namespace is singular: `roborepo skill`.

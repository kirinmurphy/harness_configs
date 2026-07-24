# jcodemunch Implementation

jcodemunch-mcp is a local code intelligence MCP server. It indexes a repo into a SQLite database and exposes symbol search, outline, reference lookup, and context bundling — so the model navigates code structurally instead of reading raw files.

## Why

Without it, the model reads whole files or runs grep, burning tokens on irrelevant code. jcodemunch answers "where is X defined" or "what calls Y" with a targeted excerpt. The hooks below make this the default path, not an opt-in.

## Components

### MCP Server

Configured in each harness's MCP settings. Claude and Codex both use `uvx jcodemunch-mcp` for the MCP server. The `jcodemunch` package also owns the `roborepo index code` command component.

**Key tools the model uses:**
- `resolve_repo` — registers the repo and returns its ID; called at session start
- `search_symbols` — find function/class/type definitions by name
- `get_file_outline` — structure of a file without reading it fully
- `find_references` — all usages of a symbol
- `get_context_bundle` — focused excerpt around a symbol or line range

### `roborepo index code`

Package-owned one-shot indexer. Enable the `jcodemunch` package first. Accepts an optional file or
directory (defaults to the current dir, relative or absolute); runs `jcodemunch-mcp index` (or
`index-file`) with `--no-ai-summaries` for speed. Use after cloning a new repo or after a large
branch change.

```
roborepo package enable jcodemunch
roborepo index code path/to/dir
roborepo index code path/to/file.ts
```

### `roborepo index code --watch`

Continuous watch mode. This is package-owned by `jcodemunch` and dispatches through the package's
command component. Run once per project in a terminal; keeps the index current as files change.

```
roborepo index code --watch               # watch the current dir
roborepo index code path/to/dir --watch
```

When the watch script is running, manual reindex calls inside the harness are unnecessary — the index is already fresh.

### Claude hooks (`globals/packages/jcodemunch/hooks-claude.json`, `globals/packages/jcodemunch/hooks/block-source-exploration.mjs`)

Three hooks enforce jcodemunch usage in Claude. All are package-owned and composed in only when `jcodemunch` is enabled:

**SessionStart** — injects a system message reminding the model that jcodemunch is available and that Grep/Read are not the primary exploration tools.

**PreToolUse: Grep|Glob** — hard blocks both tools with `"continue": false`. The stop reason tells the model to retry via jcodemunch instead. This is a redirect, not an error — the model should immediately use `search_symbols` or `search_text`.

**PreToolUse: Read** — soft nudge. Allows the Read call but injects a reminder to prefer jcodemunch for exploration. Read is still permitted for targeted reads (editing workflows, non-code files, known paths).

### Generated global rules

Generated global rules codify the behavioral contract for Claude and Codex:
- prefer jcodemunch tools over brute-force reads
- call `resolve_repo "."` at session start
- index before deeper analysis if needed
- refresh index after edits or branch changes
- if Glob/Grep is blocked mid-task, treat it as a redirect and retry with jcodemunch

These rules live in `globals/system/rules/shared/` fragments and render into `generated/claude/CLAUDE.md` and `generated/codex/AGENTS.md`. They work alongside hooks: hooks enforce at the tool level, rules shape intent earlier in the reasoning chain.

## Watch detection

`roborepo index code --watch` writes a pidfile to `/tmp/jcmwatch-<md5-of-dir>.pid` on start and removes it on exit. The pidfile stores both the pid and the process start time. The SessionStart hook reads both values and verifies they match the live process — guarding against pid recycling after a crash. If the pidfile is missing, stale, or the start time doesn't match, the hook warns that the code watcher is not running and suggests `roborepo index code` if the index may be stale. (The pidfile name keeps the `jcmwatch-` prefix for compatibility with the existing hook; the md5 is computed over the absolute watched dir, matching `globals/packages/jcodemunch/hooks-claude.json`.)

Cross-platform: the directory hash uses `md5sum` on Linux and `md5` on macOS (auto-detected). Process start time uses `ps -o lstart=` with a fallback to `ps -o start=` for Linux compatibility.

## Notes

Codex `PreToolUse` hook support is not confirmed stable. jcodemunch enforcement in Codex relies on generated rules in `AGENTS.md` rather than tool-level hooks.

# jdocmunch Implementation

jdocmunch-mcp is a documentation intelligence MCP server. It indexes doc files into section-level chunks and exposes search, TOC, and targeted retrieval — so the model reads specific sections instead of full files.

## Why

Without it, the model reads entire `.md`/`.rst` files to find relevant content, burning tokens on everything except the one section it needs. jdocmunch answers "what does this doc say about X" with a targeted section excerpt. ~97% token savings vs naive file reads.

Complements jcodemunch: jcodemunch handles code, jdocmunch handles docs.

## Key Difference from jcodemunch: No Watch Mode

jcodemunch has a continuous watch daemon (`roborepo watch code`). jdocmunch does not — the index updates passively via `mtime`-based cache invalidation when tool calls are made. For new or deleted files, re-run `roborepo index docs`.

## Components

### MCP Server

Configured in each harness's MCP settings. Claude and Codex both use `uvx jdocmunch-mcp` (no install needed).

**Key tools the model uses:**
- `list_repos` — show what doc sets are indexed; call at session start
- `search_sections` — weighted search returning section summaries (not full content)
- `get_toc` — flat section listing for a doc set
- `get_toc_tree` — hierarchical section tree
- `get_section` — full content of one section by ID
- `get_sections` — batch section retrieval
- `get_section_context` — section plus ancestor headings and child summaries
- `index_local` — index a local docs folder
- `delete_index` — remove an index

### `roborepo index docs`

Package-owned one-shot indexer. Enable the `jdocmunch` package first. Takes an optional directory
path (default: current dir, relative or absolute). The enabled package owns the command recipe; the
current `jdocmunch` package runs `jdocmunch-mcp index-local --path`. After a successful index,
writes a `.jdm-indexed` marker file to the target directory so hooks can detect per-repo index state
without calling the MCP server.

```
roborepo enable jdocmunch
roborepo index docs docs/   # index a specific docs folder
roborepo index docs         # indexes the current dir
```

### Claude hooks (`globals/claude/settings.json`)

**SessionStart** — checks for `docs/.jdm-indexed` in the current repo. If `docs/` exists but marker is absent, injects a reminder to run `roborepo index docs docs/`. If marker is present, confirms docs are indexed and ready.

**PreToolUse: Read** — soft nudge extended to mention jdocmunch for documentation files alongside jcodemunch for code.

### Codex hooks (`globals/codex/hooks.json`)

**SessionStart** — same per-repo marker check as Claude. Prints status to session output.

### Generated global rules

Generated `globals/claude/CLAUDE.md` and `globals/codex/AGENTS.md` include a Doc Exploration section:
- prefer `search_sections`, `get_toc`, `get_section` over reading full doc files
- call `list_repos` at session start to see what's indexed
- use `index_local` to index a new docs folder
- mtime detection handles edits passively; `index_local` needed only for new/deleted files

## Index Storage

Index stored globally at `~/.doc-index/` — not per-repo. Once indexed, a doc set is queryable from any session regardless of current working directory.

## Per-repo marker file

`roborepo index docs` writes `.jdm-indexed` to the indexed directory after a successful run. Hooks check for this file to detect whether a repo's docs have been indexed — avoids MCP calls at session start. The marker is excluded from git via `~/.gitignore_global` (configured by `scripts/install/install-gitignore-globals.sh`, called automatically from `scripts/install/main.sh`).

## Notes

- No pidfile mechanism — no watch process to detect
- No CLI `delete-index` command; remove `~/.doc-index/<name>/` manually if needed
- `GITHUB_TOKEN` needed only for `index_repo` against private repos

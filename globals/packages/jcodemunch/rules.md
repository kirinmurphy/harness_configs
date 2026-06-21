## Code Exploration

- Use jcodemunch-mcp for code lookup whenever available.
- Prefer symbol search, outlines, references, and targeted context bundles over reading full files.
- Do not use Bash for grep/find/cat/head/tail-style source exploration when jcodemunch can answer it.
- Use native read/search tools only for non-code files or targeted editing reads.
- At session start, resolve_repo `.`.
- If the repo is not indexed, index_folder `.`.
- After meaningful file edits, re-index changed files before further analysis.

## jcodemunch Hooks

- Hooks block `Grep` and `Glob` — treat that as a redirect, not failure.
- Respond to a block by retrying with `search_symbols`, `get_file_outline`, `find_references`, or `get_context_bundle`.

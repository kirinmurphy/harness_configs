## Doc Exploration

- Use jdocmunch-mcp for documentation lookup whenever available.
- Prefer search_sections, get_toc, get_section over reading full `.md` and `.rst` files.
- At session start, call list_repos to see what docs are already indexed.
- To index local docs, call index_local with the docs folder path.
- After editing doc files, index updates passively via mtime detection.
- For new or deleted doc files, call index_local again.

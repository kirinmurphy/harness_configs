## Context Cost

- Before broad searches, estimate result size and search the narrowest likely source first.
- Do not recursively search home, global caches, session logs, telemetry spools, or generated history unless the user explicitly asks for that scope.
- For config provenance questions, inspect active process args and known config files before searching logs.
- For process debugging, start with exact filters such as pidfile, port, script name, or `pgrep -fl <pattern>`; use full `ps -axww` only after narrow filters fail, and cap output.
- When a broad search is necessary, exclude high-volume dirs and cap output with targeted patterns.
- Prefer command summaries and bounded tails over full diffs, full test logs, or repeated process dumps.

## Context Cost

- Before broad searches, estimate result size and search the narrowest likely source first.
- Do not recursively search home, global caches, session logs, telemetry spools, or generated history unless the user explicitly asks for that scope.
- For config provenance questions, inspect active process args and known config files before searching logs.
- When a broad search is necessary, exclude high-volume dirs and cap output with targeted patterns.

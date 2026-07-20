## Verification

- Default to smallest check that proves touched behavior.
- Before testing, discover repo-native commands from package.json, pyproject.toml, Makefile, justfile, taskfile, CI config, or docs. Do not invent commands when a repo advertises its own.
- Only run checks implemented in the current repository.
- Prefer formatting, lint, type, and test checks scoped to touched files when supported.
- Prefer targeted smoke tests for edited scripts over full repo checks.
- Run full repo checks only for shared app code, build/tooling config, dependency changes, generated types, auth/payments/data migrations, CI scripts, broad refactors, cross-cutting types/config, CI risk, or explicit user request.
- If a full check seems useful but likely slow, state why before running it.
- Avoid watch, verbose, and debug modes unless explicitly requested.
- Keep command output small; use `roborepo run <command> ...` when a command may print a large log.
- Final response should include `Verified: <command> -> <pass|fail|blocked>` when verification was run or attempted.

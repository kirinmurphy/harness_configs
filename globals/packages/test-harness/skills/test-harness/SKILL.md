---
name: test-harness
description: Use when choosing, adding, running, or explaining tests; debugging CI failures; validating code edits; or deciding whether scoped checks or full checks are appropriate.
---

# Test Harness

Keep verification small, native to the repo, and explicit.

## Workflow

1. Discover commands from repo files before guessing: `package.json`, `pyproject.toml`, `Makefile`, `justfile`, `taskfile`, CI config, or docs.
2. Choose the smallest check that proves touched behavior.
3. Prefer scoped format/lint/type/test commands when available.
4. Run full checks only for shared app code, build/tooling config, dependency changes, generated types, auth/payments/data migrations, CI scripts, broad refactors, cross-cutting types/config, CI risk, or explicit user request.
5. If output may be large, use `roborepo run <command> ...` or redirect to `/tmp` and show only useful failure/pass lines.
6. Final response includes `Verified: <command> -> <pass|fail|blocked>`.

## Test Design

- Test user-visible behavior and externally meaningful outcomes, not internal state, props, private methods, or incidental function calls.
- Prefer semantic selectors in UI tests: role/name first, then label text, then visible text. Use test IDs only when semantic queries cannot identify the element cleanly. Avoid CSS selectors, tag selectors, and class names.
- For bug fixes and behavior changes, write or identify a failing test first, run it to prove it catches the issue, then make the fix pass.
- Use Playwright or another real-browser E2E tool when unit tests mock away the behavior under review, such as routing, reload/download/file chooser behavior, store-to-UI-to-persist flows, or cross-step navigation.
- For existing behavior covered by E2E tests, add regression tests that prove the old breakage path fails before the fix and passes after it.
- Assertions on mock calls are acceptable only when the call is the observable contract, such as an outbound API call with no user-visible effect.

## Blocked Verification

Use `blocked` only when the command cannot run because of missing dependencies, network/sandbox restrictions, unavailable services, or unclear repo setup. Include the exact command attempted.

## Delivery Honesty

- Before reporting a code or UI change complete, verify the exact file content and paths actually changed.
- If a requested change was not applied, state that explicitly instead of implying completion.

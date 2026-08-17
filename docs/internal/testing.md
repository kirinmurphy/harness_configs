# Testing RoboRepo

## Purpose

This is the maintainer runbook for choosing and running RoboRepo tests. The repository has several
test layers because it manages three different things at once: source checkout behavior, packaged
npm behavior, and machine-local harness state.

Use the smallest layer that proves the change. Before publishing, run the full publish matrix.

## Test Layers

| Layer | Command | Covers | Notes |
| --- | --- | --- | --- |
| Repo health | `bash scripts/doctor.sh --quiet` | generated-file drift, manifest data, links, script health | `roborepo doctor --installed` adds live installed-path checks. |
| Main smoke suite | `npm test` | fast repository behavior and simulated package mode | Alias for `scripts/test/test-roborepo.sh --quiet`. |
| Install/uninstall collisions | `bash scripts/test/test-install-collisions.sh` | conflict policy, managed-copy reclaim, uninstall cleanliness against real fixture homes | Not covered by `npm test`. The only layer that proves uninstall leaves no remnants. |
| Package artifact smoke | `npm run test:package-install` | real `npm pack`, isolated global install, package-mode lifecycle, appRoot immutability | Requires a clean worktree only when retaining an artifact with `--output-dir`. |
| Release preflight | `npm run publish:npm -- --dry-run` | npm auth, registry availability, release checks | Does not write a version or publish. |
| Targeted Node checks | `node scripts/test/<name>.mjs` | one behavior surface | Preferred while debugging a specific regression. |
| Portal smoke | `roborepo web --no-open --port <port>` plus `curl`/browser checks | local portal routes and API snapshots | Start under direct control and stop with Ctrl-C. Do not use detached mode for test runs. |

## Publish Matrix

Before an npm publish decision, run these commands from a clean `main` checkout with Node 20 or
newer:

```sh
node -v
roborepo doctor --installed
npm test
bash scripts/test/test-install-collisions.sh
npm run pack:dry-run
npm run test:package-install
npm run --silent test:publish-npm
bash -n scripts/release/publish-npm.sh
git diff --check
```

For high-risk integration reviews, also run the relevant direct tests instead of relying only on
`npm test`. The post-merge review before the beta package cut used this focused set:

```sh
node scripts/test/dry-run-purity-check.mjs
node scripts/test/managed-uninstall-check.mjs
node scripts/test/cli-surface-integration-check.mjs
node scripts/test/repo-write-scope-check.mjs
node scripts/test/permissions-render-live-characterization-check.mjs
node scripts/test/config-synthetic-provider-check.mjs
node scripts/test/harness-cohort-presentation-check.mjs
node scripts/test/config-source-harness-check.mjs
node scripts/test/retention-policy-check.mjs
node scripts/test/telemetry-store-bounds-check.mjs
node scripts/test/capture-dense-bash-check.mjs
node scripts/test/maintenance-stores-check.mjs
node scripts/test/package-catalog-check.mjs
node scripts/test/package-lifecycle-check.mjs
node scripts/test/package-default-enabled-check.mjs
node scripts/test/initialization-lifecycle-check.mjs
node scripts/test/package-catalog-harness-check.mjs
node scripts/test/package-harness-config-characterization-check.mjs
node scripts/test/harness-package-config-roundtrip-check.mjs
node scripts/test/root-config-merge-characterization-check.mjs
node scripts/test/root-config-state-check.mjs
node scripts/test/harness-hooks-write-remove-characterization-check.mjs
node scripts/test/harness-mcp-remove-characterization-check.mjs
node scripts/test/mcp-package-lifecycle-characterization-check.mjs
node scripts/test/repositories-check.mjs
node scripts/test/localhoster-check.mjs
node scripts/test/usage-domain-check.mjs
```

Do not run broad `npm run test:*` sweeps as one foreground command. They are harder to diagnose and
can exceed terminal timeouts. Run direct checks in small batches and record pass/fail lines.

## Portal Smoke

Use `roborepo web`, not `node scripts/cli/main.mjs web`, unless the test is specifically about the
composition root. The CLI command is the supported surface.

```sh
roborepo web --no-open --port 58473
curl -fsS http://127.0.0.1:58473/config
curl -fsS http://127.0.0.1:58473/api/config
curl -fsS http://127.0.0.1:58473/api/maintenance/uninstall/preview
```

Stop the server with Ctrl-C after the smoke. The uninstall preview route is safe; it returns the
planned cleanup and `workspacePreserved`. Do not call `POST /api/maintenance/uninstall` during
publish verification.

When browser automation is available, use it for DOM-level checks: page load, console errors,
network failures, and the visible Uninstall panel. Without browser automation, `/config`,
`/api/config`, and the uninstall preview are acceptable browser-equivalent smoke checks, but record
that no real browser was used.

## Sandbox Notes

Codex sandboxes can block checks that are valid on the host machine:

| Symptom | Action |
| --- | --- |
| `npm pack` reports it could not write `~/.npm/_logs` | Rerun `npm run test:package-install` once outside the sandbox. |
| localhost bind or fetch returns `EPERM` | Rerun the `roborepo web` or `curl` smoke outside the sandbox. |
| `roborepo harness refresh` cannot write `~/.roborepo/harnesses/state.json` | Rerun it outside the sandbox when validating real machine state. |

Do not work around these by changing test paths or using a different command surface. Record the
first sandbox failure and the escalated rerun result.

## Known Non-Publish Failures

These are tracked separately and should not be reported as new publish regressions without fresh
evidence:

| Check | Current classification |
| --- | --- |
| `node scripts/test/usage-statusline-check.mjs` | pre-existing renderer/test text drift: test expects `Context: 70% used`; renderer emits `Context: 70%` |
| `node scripts/test/agent-run-coverage-check.mjs` | `roborepo init`, `library`, and `uninstall` are unclassified in the permission manifest. Nothing is broken — unclassified namespaces fall through to a prompt, the safe default — but the bucket decision is still owed. Being resolved on the in-flight permissions branch; do not classify them here in parallel. |

`node scripts/test/hook-composition-check.mjs` is part of the passing main suite and should not be
classified as a known failure.

`node scripts/test/usage-domain-check.mjs` covers the usage threshold/domain behavior and should
still pass when statusline text formatting is not the subject under review.

## Platform Coverage

CI runs the main suite on macOS and Linux, plus a Windows PowerShell parser/parity check for the
installer. A local macOS publish review does not prove Linux or Windows lifecycle behavior unless
those CI jobs or equivalent local environments are run.

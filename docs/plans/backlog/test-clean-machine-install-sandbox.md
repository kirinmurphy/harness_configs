---
id: qk4mz7t2
priority: high
next_action: Watch the first strict CI run, then add deeper permission assertions to the shared permissions sandbox
blocked_by: []
depends_on: []
related:
  - ia1q1z9
  - 46up8y7a
reviewed_commit: b9d38bd
---

# Prove Clean-Machine Install Behavior

## Summary

A redirected `HOME` is useful, but it is not a clean machine. It still inherits the host's real
`PATH`, harness binaries, Docker state, and package-manager behavior. The clean-machine sandbox
turns install verification into a repeatable test: pack the current repository, install that tarball
in a container, initialize RoboRepo with no harnesses present, run `doctor`, run managed uninstall,
then remove the npm package and prove the `roborepo` binary is gone.

This plan now overlaps directly with [[agent-config-repo-scoped-write-permissions]]. The permissions
branch added home-relative credential denies, and `test:package-install` caught a deterministic
package-mode drift before any browser or live harness test did. The Docker sandbox is the next
layer: it exercises the same package artifact under a cleaner `HOME` and `PATH`, with a colliding
npm prefix case.

## Goals

- Prove a packed tarball installs and initializes on a machine with no harness binaries on `PATH`.
- Prove package-mode `doctor` passes in that clean-machine shape.
- Prove managed uninstall preserves the workspace and leaves npm-owned application removal to npm.
- Prove npm uninstall removes the `roborepo` binary, including when npm's prefix collides with
  `~/.local`.
- Run the clean-machine check in CI as a distinct install leg.
- Leave local development usable when Docker is unavailable.

## Non-goals

- Browser or portal UI verification.
- Real macOS hardware replacement. The sandbox complements the existing macOS CI leg; it does not
  claim every platform-specific installer behavior is covered.
- Changing current uninstall ownership. The current CLI explicitly removes managed configuration
  and tells the user to remove the application with `npm uninstall -g codethings-roborepo-alpha`.

## Current State

`scripts/test/clean-machine-install-sandbox.mjs` now exists and is wired as
`npm run test:clean-machine-install-sandbox`. It:

- packs the current repository with the same helper used by `package-install-smoke.mjs`;
- runs `node:22-bookworm-slim` with `--network=none`;
- asserts `claude`, `codex`, and `gemini` are absent from `PATH`;
- installs the tarball with an isolated npm prefix and cache;
- runs `roborepo version`, `roborepo init`, `roborepo doctor --quiet`, and
  `roborepo uninstall --yes`;
- confirms the workspace still exists after managed uninstall;
- runs `npm uninstall -g --prefix <prefix> codethings-roborepo-alpha`;
- fails if `command -v roborepo` still resolves afterward;
- repeats the same sequence with a prefix under the case's clean `HOME/.local`.

Local behavior is intentionally non-blocking: when the Docker daemon is unavailable, the test prints
a skip message and exits 0. CI sets `ROBOREPO_CLEAN_MACHINE_STRICT=1` on the Ubuntu leg, so Docker
or sandbox failures are hard failures there.

The container body has now passed locally against Docker Desktop. That run caught two practical
issues before CI:

- Docker Desktop can hang before container creation when a bind mount points at macOS'
  per-user `/var/folders/...` temp directory. The runner now places pack artifacts under `/tmp` by
  default, with `ROBOREPO_CLEAN_MACHINE_TMPDIR` as an override.
- `roborepo uninstall --yes` reported the npm-owned `~/.local/bin/roborepo` symlink as a managed
  remnant when the npm prefix intentionally collided with clean `HOME/.local`. The remnant check now
  exempts the package-managed binary; `npm uninstall` remains the owner of application removal.

The Docker direction is now documented in `docs/internal/docker-test-sandboxes.md`: use one image as
a disposable machine template, run fresh containers per scenario, install once per scenario, and run
many assertions inside that installed state. The clean-install runner stays narrow. Permissions
projection and fake harness assertions now live in their own sandbox, sharing packing/container
helpers rather than turning this script into a catch-all.

`scripts/test/lib/docker-sandbox.mjs` now owns the common Docker mechanics: strict/local skip
behavior, base image selection, `/tmp` artifact root, pack-once setup, `docker run --network=none`,
timeout, and failure reporting.

## Implementation Plan

- [x] Add a packed-tarball clean-machine sandbox runner.
- [x] Add the standard-prefix install/init/doctor/uninstall/npm-uninstall case.
- [x] Add the colliding-prefix case under clean `HOME/.local`.
- [x] Make the runner skip locally when Docker is unavailable.
- [x] Register `test:clean-machine-install-sandbox` in `package.json`.
- [x] Wire the runner into CI as an Ubuntu-only strict step.
- [x] Extract reusable Docker sandbox helpers for pack-once/run-container setup.
- [x] Add a permissions sandbox with fake harnesses and direct config assertions.
- [ ] Observe the first strict CI run and fix any container-only assumptions.
- [ ] Add deeper permission assertions to the permissions sandbox, keeping one install per scenario.
- [ ] Add harness-count stubs for stages 0 through N after the permissions sandbox has a helper
      layer to reuse.
- [ ] Decide whether workspace restore / `roborepo workspace import` belongs in this runner or in
      a separate package-mode fixture.

## Validation

Already verified locally:

```text
node --check scripts/test/clean-machine-install-sandbox.mjs -> pass
npm run test:clean-machine-install-sandbox -> pass with Docker Desktop
```

CI still needs to prove the same container body in the Ubuntu runner:

```text
ROBOREPO_CLEAN_MACHINE_STRICT=1 npm run test:clean-machine-install-sandbox
```

## Remaining Work

- Watch the Ubuntu CI result for the first strict run.
- Add more permission assertions inside `test:clean-machine-permissions-sandbox` before creating
  another full install/uninstall scenario.

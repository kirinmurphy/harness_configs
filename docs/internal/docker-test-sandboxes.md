# Docker Test Sandboxes

Docker tests in this repository are for machine-shape behavior: install, uninstall, package-mode
state, harness discovery, generated config projection, filesystem ownership, and other checks where
a redirected `HOME` is not isolated enough.

They are not a replacement for focused Node or shell tests. Use the smallest native test when the
behavior can be proven in-process. Use Docker when the behavior depends on a clean `PATH`, clean
home directory, package manager prefix, Linux filesystem semantics, or absence/presence of harness
binaries.

## Execution Model

Use one Docker image as a disposable machine template, then run a fresh container per scenario or
case. Do not maintain long-lived test VMs and do not try to clean a running container back to a
baseline between scenarios.

The scalable unit is:

1. Pack or prepare the repository artifact once on the host.
2. Start a container from the shared image.
3. Give each case its own `HOME`, state root, workspace root, npm prefix, npm cache, and `PATH`.
4. Run the scenario.
5. Assert externally meaningful results.
6. Throw the container away.

This keeps failures attributable. If a scenario mutates shell profiles, npm bins, generated harness
config, or machine-local state, that mutation dies with the container.

## Image Policy

Default to the current Node LTS slim image used by the clean-machine runner:

```text
node:22-bookworm-slim
```

The runner may allow an override for debugging or future matrix work, but tests should not rely on
host-installed tools beyond Docker itself. Keep `--network=none` for scenarios that install from a
locally packed tarball or otherwise should not fetch from the network.

On macOS Docker Desktop, bind mounts from the per-user `/var/folders/...` temp tree can hang before
container creation. Put Docker-bound artifacts under `/tmp` unless a test has a reason to override
that root.

## Scenario Types

Use separate scripts when failure meaning differs.

| Scenario type | Proves | Example command |
| --- | --- | --- |
| Clean install | Packed package installs, initializes, doctors, uninstalls, then npm removes app files | `npm run test:clean-machine-install-sandbox` |
| Permissions projection | Fake harness presence receives the expected rendered config and no over-broad permissions | `npm run test:clean-machine-permissions-sandbox` |
| Lifecycle ownership | Install/uninstall preserves user-owned state and removes only roborepo-owned state | dedicated lifecycle sandbox |
| Platform assumptions | Linux path, shell, case-sensitivity, or coreutils assumptions are valid | dedicated portability sandbox |

Do not put every assertion into the clean-install sandbox. It should stay narrow so package install
breakage is obvious. Add a new sandbox when the setup or failure mode is meaningfully different.

## Harness Stubs

For permissions and projection tests, prefer fake harness executables over real agent CLIs. A fake
harness should be enough to trigger roborepo's detection path and should write predictable config
under the scenario's clean `HOME`.

Permissions sandbox cases should assert the generated or applied files directly:

- Claude settings keep credential denies home-relative, such as `Read(~/.ssh/**)`.
- No tracked or projected permission rule contains a contributor's absolute home path.
- Repo scope is represented by hook wiring, not by `~/projects/**`.
- Codex keeps the coarse sandbox expression instead of receiving unsupported path-scope rules.
- Gemini does not flatten `repo-scope` into an unscoped allow.

Hook behavior can be tested by invoking hook scripts directly with JSON payloads inside the
container. That is still deterministic and does not require a real interactive harness session.

## Local And CI Behavior

Local Docker tests may skip when Docker is unavailable unless the script is in strict mode. CI must
run important Docker sandboxes in strict mode so Docker or container failures are hard failures.

Use clear phase output and a timeout around `docker run`. A sandbox that hangs silently is not a
useful verifier.

# Next Session Prompt — Root Config Drift Detection Follow-Up

Paste this into a new chat.

---

## Prompt

> Continue work on root-config drift detection in roborepo. Read
> `docs/plans/root-config-layered-inheritance.md` for full context — the core mechanism (hash
> sidecar, drift-aware collision handling across the JS/bash/PowerShell install paths, `roborepo
> config root inspect`) shipped and was code-reviewed in the prior session. All 7 findings from
> that review are fixed and tested.
>
> Remaining implementation steps from that doc (5–7):
>
> 1. Teach `roborepo uninstall` to remove only root-config active files that still match the
>    sidecar hash, leaving user-drifted files in place (mirrors the existing rendered-rules
>    uninstall behavior — see `removeRenderedRulesRow`/`restorePreInstallBackup` in
>    `scripts/cli/presets.mjs` for the pattern to follow).
> 2. Add portal visibility for drift state (in sync / drifted / staged-update-pending) — the CLI
>    already has this via `roborepo config root inspect`; the `/config` web portal does not yet
>    surface it.
> 3. Document the Codex native profile option (`~/.codex/<name>.config.toml`, `--profile <name>`)
>    as the recommended path for a Codex user who wants a permanent personal config slice —
>    this is a docs-only task, no code change, since Codex already owns this mechanism natively.
>
> Also worth a look, found during the prior session's review but out of scope for it:
>
> - `scripts/install/install-windows.ps1` has two near-duplicate functions,
>   `Export-UserConfig` and `Resolve-UserConfigCollision`, doing almost the same root_config
>   collision logic. Only `Export-UserConfig` is actually called (from `Invoke-ManifestRows`);
>   `Resolve-UserConfigCollision` appears to be dead code or a leftover from a prior refactor.
>   Worth confirming it's truly unused and removing it, or understanding why both exist.
>
> Ask me before starting which of these to prioritize, or whether to instead switch to
> `docs/plans/package-registry-live-state-reconciliation.md` (a separate, unrelated backlog item —
> fixing the config portal's ambiguous enabled/disabled/partial package states — that was
> flagged earlier as the recommended next pick in `docs/plans/harness-parity-todo.md` and has not
> been started).

---

## Context for whoever picks this up

- The hash-sidecar mechanism, its three install-path implementations, and all bug fixes are
  described in `docs/plans/root-config-layered-inheritance.md` and
  `docs/reference/internal/config-collision-handling.md`.
- Two architecture case-study articles were written about this work and live at
  `~/projects/activedev/architecture_blog/content/posts/roborepo/detecting-drift-instead-of-merging-config.md`
  and `.../staging-both-versions-instead-of-choosing-for-the-user.md` — useful background reading,
  not required.
- Test coverage: `scripts/test/test-install-collisions.sh` (bash, includes drift regression tests),
  `scripts/test/root-config-state-check.mjs` (Node unit test), both wired into
  `scripts/test/test-roborepo.sh`.
- One pre-existing, unrelated test failure exists in the sandbox environment used for this work:
  `noninteractive collision explains failure` in `test-install-collisions.sh` fails due to
  `/dev/tty: Device not configured` — confirmed present on unmodified `main`, not caused by this
  work. Not necessarily present in other environments (e.g. a real terminal).

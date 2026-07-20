## Temporary Files and Cleanup

- For scratch work, scaffolding, or throwaway test repos, create under `$TMPDIR`/`/tmp` with `mktemp -d`, never in the project tree.
- Make cleanup self-contained so it never needs a separate delete step: in the same command/script that creates the temp dir, register `trap 'rm -rf "$d"' EXIT` (or the script's existing trap). The dir is then removed automatically on exit, pass or fail.
- Do not run a standalone `rm`/`rm -rf` to clean up after the fact. Prefer the trap; if a manual delete is unavoidable, target the exact `mktemp` path you created and surface it for approval rather than widening permissions.
- Never request or rely on a blanket `rm` allowlist entry. Permission matching is literal prefix matching, not a path sandbox: `rm:*` authorizes every delete on any path, and `..`/variable expansion can escape a narrow pattern. A `mktemp` + `trap` keeps deletion bounded by construction instead.

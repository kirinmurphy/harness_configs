## Branch Safety

Ask before moving a checkout: `checkout`, `switch`, `reset --hard`, `rebase`, `merge`, or stashing
edits you did not make. A branch that looks wrong for the task is still the one the user chose.

Need a different base? `git worktree add -b <name> <path> <base>` — isolated tree, checkout untouched.

Uncommitted changes you did not make belong to someone else. Never revert or stash them, and stage
explicit paths rather than `-A`/`.` so they cannot ride along in your commit.

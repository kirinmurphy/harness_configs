#!/usr/bin/env bash
set -euo pipefail

# Run the repository test suite under CI-shaped conditions: an empty HOME with no harness content,
# and a PATH carrying no harness executables.
#
# Why this exists: the suite passed 393/393 on the development Mac and failed on the GitHub runner.
# The tests that failed read ambient machine state -- a real ~/.claude, a `claude` on PATH -- instead
# of planting their own fixture. That class of defect is invisible locally by construction, because
# the developer's machine always satisfies the ambient condition. This wrapper reproduces the
# runner's conditions without waiting for a push.
#
# Usage: bash scripts/test/hermetic-suite.sh [--quiet|-q]
#
# A test that fails here but passes in a normal run is reading the real HOME or PATH. Fix the test
# by planting its own fixture (see the fake-binary technique in config-synthetic-provider-check.mjs),
# not by relaxing its assertion.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

fake_home="$(mktemp -d "${TMPDIR:-/tmp}/roborepo-hermetic-home.XXXXXX")"
cleanup() {
  local status=$?
  chmod -R u+rwx "${fake_home}" 2>/dev/null || true
  rm -rf "${fake_home}" 2>/dev/null || true
  exit "${status}"
}
trap cleanup EXIT

# Keep node and the core utilities reachable, but drop anything a harness install put on PATH.
# `command -v node` is resolved before PATH is narrowed so a version-managed node still works.
node_bin="$(dirname "$(command -v node)")"
hermetic_path="${node_bin}:/usr/bin:/bin:/usr/sbin:/sbin"

echo "hermetic run: HOME=${fake_home}"
echo "hermetic run: PATH=${hermetic_path}"
for harness in claude codex gemini; do
  if PATH="${hermetic_path}" command -v "${harness}" >/dev/null 2>&1; then
    echo "warning: ${harness} is still visible on the narrowed PATH" >&2
  fi
done
echo

env -i \
  HOME="${fake_home}" \
  PATH="${hermetic_path}" \
  TMPDIR="${TMPDIR:-/tmp}" \
  TERM="${TERM:-dumb}" \
  CI=1 \
  bash "${repo_root}/scripts/test/test-roborepo.sh" "$@"

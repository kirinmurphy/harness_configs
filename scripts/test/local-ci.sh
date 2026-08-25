#!/usr/bin/env bash
set -euo pipefail

# Local CI parity gate. Keep this in lockstep with .github/workflows/ci.yml so a maintainer can
# find release-blocking failures before pushing.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"

run() {
  echo ""
  echo "==> $*"
  "$@"
}

run bash scripts/doctor.sh --quiet
run bash scripts/test/test-roborepo.sh --quiet
run bash scripts/test/test-install-collisions.sh

run npm run --silent test:packages
run npm run --silent test:package-lifecycle
run npm run --silent test:package-default-enabled
run npm run --silent test:initialization-lifecycle
run npm run --silent test:harness-cohort
run npm run --silent test:managed-uninstall
run npm run --silent test:plan-promote-start

run npm run --silent test:package-install

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  run npm run --silent test:clean-machine
else
  echo ""
  echo "skip: clean-machine container suite (docker unavailable)"
fi

pwsh_bin="$(command -v pwsh 2>/dev/null || command -v pwsh-preview 2>/dev/null || true)"
if [[ -n "${pwsh_bin}" ]]; then
  run "${pwsh_bin}" -File scripts/test/windows-installer-check.ps1
else
  echo ""
  echo "skip: windows installer parity (pwsh unavailable)"
fi

echo ""
echo "local CI checks passed"

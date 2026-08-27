#!/usr/bin/env bash
set -euo pipefail

# The CI gate. .github/workflows/ci.yml invokes this same script via `npm run check`, so a run on
# a contributor's machine and a run in GitHub Actions are the same command, not two gates to keep
# in sync — a local pass means a CI pass.

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
run npm run --silent test:core-hook-wiring
run npm run --silent test:permission-rule-home-path

run npm run --silent test:package-install

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  run env ROBOREPO_CLEAN_MACHINE_STRICT=1 npm run --silent test:clean-machine
  run env ROBOREPO_CLEAN_MACHINE_STRICT=1 npm run --silent test:clean-machine-install-sandbox
  run env ROBOREPO_CLEAN_MACHINE_STRICT=1 npm run --silent test:clean-machine-permissions-sandbox
  run env ROBOREPO_CLEAN_MACHINE_STRICT=1 npm run --silent test:clean-machine-onboarding-sandbox
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
echo "CI checks passed"

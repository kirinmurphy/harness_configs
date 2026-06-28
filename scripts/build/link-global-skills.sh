#!/usr/bin/env bash
# Materialize globals/agents/skills/* into the machine-local skill cache and link each present
# harness's native skills dir to that cache.
# Called by skill-new.mjs after a new global skill is created.
# Also safe to run manually: idempotent, skips native-installed skills.
#
# Exits 0 silently if the install infrastructure (install-lib.sh, manifests-data.sh) is not
# present in the repo root — this happens in test harnesses that copy only the CLI scripts.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dry_run=0
on_conflict=""

[[ -f "${repo_root}/scripts/install/install-lib.sh" ]] || exit 0
[[ -f "${repo_root}/scripts/lib/manifests-data.sh" ]] || exit 0

# shellcheck source=scripts/build/skill-lib.sh
source "${repo_root}/scripts/build/skill-lib.sh"
# shellcheck source=scripts/install/install-lib.sh
source "${repo_root}/scripts/install/install-lib.sh"
# shellcheck source=scripts/lib/manifests-data.sh
source "${repo_root}/scripts/lib/manifests-data.sh"

harness_present claude && link_global_skills "${HOME}/.claude"
harness_present codex  && link_global_skills "${HOME}/.codex"

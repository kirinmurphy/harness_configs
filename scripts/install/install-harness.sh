#!/usr/bin/env bash
set -euo pipefail

# Single generic per-harness install entrypoint, replacing install-claude.sh/install-codex.sh
# (docs/plans/active/discoverable-harness-provider-architecture-plan.md Phase 4). The two prior
# scripts were byte-identical except for the harness id literal — this loads that id from argv
# and resolves everything else (home path, display name, presence check) through the registry-
# backed harness_detected_rows(), so a new provider needs no new script.

harness_id="${1:-}"
if [[ -z "${harness_id}" ]]; then
  echo "usage: $0 <harness-id> [--dry-run] [--on-conflict overwrite|keep|abort]" >&2
  exit 2
fi
shift

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backup_root="${ROBOREPO_BACKUP_ROOT:-${HOME}/.roborepo-backups/$(date +%Y%m%d-%H%M%S)}"
dry_run=0
on_conflict="${ROBOREPO_ON_CONFLICT:-}"
export ROBOREPO_INSTALL_TIMESTAMP="${ROBOREPO_INSTALL_TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1; shift ;;
    --on-conflict) on_conflict="$2"; shift 2 ;;
    --on-conflict=*) on_conflict="${1#*=}"; shift ;;
    *) echo "usage: $0 <harness-id> [--dry-run] [--on-conflict overwrite|keep|abort]" >&2; exit 2 ;;
  esac
done
export ROBOREPO_ON_CONFLICT="${on_conflict}"

# shellcheck source=scripts/install/install-lib.sh
source "${repo_root}/scripts/install/install-lib.sh"
# shellcheck source=scripts/lib/manifests-data.sh
source "${repo_root}/scripts/lib/manifests-data.sh"  # provides manifest_rows, harness_present
# shellcheck source=scripts/build/skill-lib.sh
source "${repo_root}/scripts/build/skill-lib.sh"  # provides list_source_skills (for link_global_skills)

harness_present "${harness_id}" || {
  echo "skip: harness '${harness_id}' does not appear to be installed" >&2
  exit 0
}

# Resolve this harness's home dir from the one matching detected row.
home_dir=""
while IFS=$'\t' read -r id home _present _name _root_config_path; do
  [[ "${id}" == "${harness_id}" ]] || continue
  home_dir="${home}"
done < <(harness_detected_rows)

# Capture the user's genuine pre-roborepo config once, before the manifest loop mutates anything.
snapshot_pre_roborepo_original

# Managed rows come from manifests/platform/manifest.tsv, filtered to this harness's column.
while IFS=$'\t' read -r _h kind src_rel home_abs _flags; do
  case "${kind}" in
    root_config)    export_user_config "${harness_id}" "${src_rel}" "${home_abs}" ;;
    managed_copy)   install_copy_item "${src_rel}" "${home_abs}" "${harness_id}" ;;
    cleanup)        remove_repo_link "${home_abs}" ;;
    rendered_rules) ;;  # handled by the render step below
  esac
done < <(manifest_rows "${harness_id}")

# Render this harness's home rules file from base rule fragments + enabled-packages registry.
if command -v node >/dev/null 2>&1; then
  if [[ "${dry_run}" -eq 1 ]]; then
    node "${repo_root}/scripts/cli/rules-render.mjs" --dry-run "${harness_id}"
  else
    node "${repo_root}/scripts/cli/rules-render.mjs" "${harness_id}"
  fi
fi

# Base install materializes the shared skill cache for roborepo-support and links this harness's view.
# Other shared skills are installed by onboarding/package toggles, so a minimal install stays small.
link_global_skills "${home_dir}" roborepo-support

# Guard: this script installs harness config only. The roborepo CLI (and `roborepo index code`)
# require a full install via scripts/install/main.sh which wires the binary into PATH.
if [[ "${dry_run}" -eq 0 && ! -e "${HOME}/.local/bin/roborepo" ]]; then
  echo "warn: roborepo CLI not found at ~/.local/bin/roborepo" >&2
  echo "      Run scripts/install/main.sh for a complete install including the roborepo command." >&2
fi

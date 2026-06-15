#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backup_root="${ROBOREPO_BACKUP_ROOT:-${HOME}/.roborepo-backups/$(date +%Y%m%d-%H%M%S)}"
dry_run=0
install_mode="${ROBOREPO_INSTALL_MODE:-managed}"
on_conflict="${ROBOREPO_ON_CONFLICT:-}"
export ROBOREPO_INSTALL_TIMESTAMP="${ROBOREPO_INSTALL_TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1; shift ;;
    --mode) install_mode="$2"; shift 2 ;;
    --mode=*) install_mode="${1#*=}"; shift ;;
    --on-conflict) on_conflict="$2"; shift 2 ;;
    --on-conflict=*) on_conflict="${1#*=}"; shift ;;
    *) echo "usage: $0 [--dry-run] [--mode managed|adopt] [--on-conflict overwrite|keep|abort]" >&2; exit 2 ;;
  esac
done
export ROBOREPO_INSTALL_MODE="${install_mode}"
export ROBOREPO_ON_CONFLICT="${on_conflict}"

# shellcheck source=scripts/install/install-lib.sh
source "${repo_root}/scripts/install/install-lib.sh"
# shellcheck source=scripts/lib/manifests-data.sh
source "${repo_root}/scripts/lib/manifests-data.sh"  # provides manifest_rows

if [[ ! -d "${HOME}/.claude" ]]; then
  echo "skip: ~/.claude not found — Claude Code does not appear to be installed" >&2
  exit 0
fi

while IFS=$'\t' read -r _h kind src_rel home_abs _flags; do
  case "${kind}" in
    root_config) export_user_config "claude" "${src_rel}" "${home_abs}" ;;
    link)
      if [[ "${install_mode}" == "adopt" ]]; then
        install_copy_item "${src_rel}" "${home_abs}"
      else
        install_link_item "${src_rel}" "${home_abs}"
      fi
      ;;
    cleanup) remove_repo_link "${home_abs}" ;;
  esac
done < <(manifest_rows claude)

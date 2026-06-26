#!/usr/bin/env bash
set -euo pipefail

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
    *) echo "usage: $0 [--dry-run] [--on-conflict overwrite|keep|abort]" >&2; exit 2 ;;
  esac
done
export ROBOREPO_ON_CONFLICT="${on_conflict}"

# shellcheck source=scripts/install/install-lib.sh
source "${repo_root}/scripts/install/install-lib.sh"
# shellcheck source=scripts/lib/manifests-data.sh
source "${repo_root}/scripts/lib/manifests-data.sh"  # provides manifest_rows
# shellcheck source=scripts/build/skill-lib.sh
source "${repo_root}/scripts/build/skill-lib.sh"  # provides list_source_skills (for link_global_skills)

if [[ ! -d "${HOME}/.claude" ]]; then
  echo "skip: ~/.claude not found — Claude Code does not appear to be installed" >&2
  exit 0
fi

# Capture the user's genuine pre-roborepo config once, before the manifest loop mutates anything.
snapshot_pre_roborepo_original

while IFS=$'\t' read -r _h kind src_rel home_abs _flags; do
  case "${kind}" in
    root_config)    export_user_config "claude" "${src_rel}" "${home_abs}" ;;
    managed_copy)   install_copy_item "${src_rel}" "${home_abs}" "claude" ;;
    cleanup) remove_repo_link "${home_abs}" ;;
  esac
done < <(manifest_rows claude)

# Per-skill copies: each globals/agents/skills/<name> -> ~/.claude/skills/<name> (managed copy).
# Skills roborepo does not own (no .roborepo-managed marker) are left untouched.
# Stale managed copies (skill removed from repo source) are pruned.
link_global_skills "${HOME}/.claude"

# Guard: this script installs harness config only. The roborepo CLI (and `roborepo index code`)
# require a full install via scripts/install/main.sh which wires the binary into PATH.
if [[ "${dry_run}" -eq 0 && ! -e "${HOME}/.local/bin/roborepo" ]]; then
  echo "warn: roborepo CLI not found at ~/.local/bin/roborepo" >&2
  echo "      Run scripts/install/main.sh for a complete install including the roborepo command." >&2
fi

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

# Codex is "installed" if either its config home (~/.codex) or its skills home (~/.agents)
# exists. AGENTS.md / config.toml / rules live under ~/.codex; skills live under ~/.agents
# (Codex scans .agents/skills exclusively). ~/.codex/skills is NOT managed: it is Codex's own
# writable skill dir (its .system skill-installer reads/writes $CODEX_HOME/skills). Any old
# repo-symlink there is pruned via the codex `cleanup` row so installs don't land in the repo.
harness_present codex || {
  echo "skip: neither ~/.codex nor ~/.agents found — Codex does not appear to be installed" >&2
  exit 0
}

# Managed rows come from manifests/platform/manifest.tsv: codex harness (AGENTS.md, hooks.json, rules,
# config.toml, plus cleanup of the retired ~/.codex/skills link) and agents harness (the
# canonical ~/.agents/skills link -> globals/agents/skills).
codex_rows() { manifest_rows codex; manifest_rows agents; }

while IFS=$'\t' read -r _h kind src_rel home_abs _flags; do
  case "${kind}" in
    root_config) export_user_config "codex" "${src_rel}" "${home_abs}" ;;
    link)
      if [[ "${install_mode}" == "adopt" ]]; then
        install_copy_item "${src_rel}" "${home_abs}"
      else
        install_link_item "${src_rel}" "${home_abs}"
      fi
      ;;
    cleanup) remove_repo_link "${home_abs}" ;;
  esac
done < <(codex_rows)

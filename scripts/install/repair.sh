#!/usr/bin/env bash
set -euo pipefail

# roborepo repair — fix an install after the checkout was moved or renamed.
#
# Symptom this fixes: every managed link under ~/.claude and ~/.codex (including per-skill links
# under skills/) and the ~/.local/bin/roborepo command point at the checkout's old absolute path,
# so they dangle and `roborepo` drops off PATH. (See docs/plans/portable-install-relocation.md.)
#
# What it does: for each managed link in manifests/platform/manifest.tsv, reclaim a stale link (one that
# is dangling, or targets the recorded prior checkout) and recreate it against the CURRENT
# checkout; then re-link per-skill global skills, re-link the bin command, and rewrite the
# recorded root. Relink only — mutable root config (settings.json / config.toml) is
# user-owned and left untouched.
#
# Idempotent: a no-op when every link already points at the current checkout.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backup_root="${ROBOREPO_BACKUP_ROOT:-${HOME}/.roborepo-backups/$(date +%Y%m%d-%H%M%S)}"
export ROBOREPO_BACKUP_ROOT="${backup_root}"
export ROBOREPO_INSTALL_TIMESTAMP="${ROBOREPO_INSTALL_TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"
dry_run=0

case "${1:-}" in
  --dry-run) dry_run=1 ;;
  "") ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

# shellcheck source=scripts/install/install-lib.sh
source "${repo_root}/scripts/install/install-lib.sh"   # provides install_link_item, link_global_skills
# shellcheck source=scripts/build/skill-lib.sh
source "${repo_root}/scripts/build/skill-lib.sh"       # provides list_source_skills (for link_global_skills)
# shellcheck source=scripts/lib/manifests-data.sh
source "${repo_root}/scripts/lib/manifests-data.sh"    # provides manifest_rows
# shellcheck source=scripts/install/state-lib.sh
source "${repo_root}/scripts/install/state-lib.sh"     # provides read_install_repo / write_install_state

install_mode="$(read_install_mode 2>/dev/null || echo managed)"
recorded_repo="$(read_install_repo 2>/dev/null || true)"

if [[ "${install_mode}" != "managed" ]]; then
  echo "repair: install mode is '${install_mode}', not 'managed' — repair only relinks managed installs." >&2
  echo "        Re-run 'roborepo update' to re-apply your adopted config." >&2
  exit 1
fi

# Drop a stale link so install_link_item can recreate it cleanly. install_link_item already
# relinks targets under the current repo_root; this only needs to clear links that point at the
# recorded prior checkout or that dangle (prior-checkout path that no longer exists).
reclaim_stale_link() {
  local home_path="$1"
  [[ -L "${home_path}" ]] || return 0

  local current
  current="$(readlink "${home_path}")"
  case "${current}" in
    "${repo_root}"/*) return 0 ;;  # already ours; install_link_item will relink/no-op
  esac

  local stale=0
  if [[ -n "${recorded_repo}" ]]; then
    case "${current}" in
      "${recorded_repo}"/*) stale=1 ;;
    esac
  fi
  [[ ! -e "${home_path}" ]] && stale=1   # dangling

  [[ "${stale}" -eq 1 ]] || return 0
  if [[ "${dry_run}" -eq 1 ]]; then
    echo "reclaim: ${home_path} (was ${current})"
    return 0
  fi
  rm "${home_path}"
  echo "reclaim: ${home_path} (was ${current})"
}

# Managed rows from the manifest, for whichever harnesses are present.
repair_harness() {
  while IFS=$'\t' read -r _h kind src_rel home_abs _flags; do
    case "${kind}" in
      link)
        reclaim_stale_link "${home_abs}"
        install_link_item "${src_rel}" "${home_abs}"
        ;;
      managed_copy)
        install_copy_item "${src_rel}" "${home_abs}"
        ;;
    esac
  done < <(manifest_rows "$1")
}

# Per-skill links: reclaim dangling managed symlinks, then re-link via enumerate-step.
# Always runs link_global_skills regardless of whether skills_home exists — repair creates it.
repair_skill_links() {
  local skills_home="$1"
  if [[ -d "${skills_home}" ]]; then
    local link current
    for link in "${skills_home}"/*; do
      [[ -L "${link}" ]] || continue
      current="$(readlink "${link}")"
      case "${current}" in
        "${repo_root}"/globals/agents/skills/*) continue ;;  # already current
      esac
      local stale=0
      [[ -n "${recorded_repo}" ]] && case "${current}" in "${recorded_repo}"/globals/agents/skills/*) stale=1 ;; esac
      [[ ! -e "${link}" ]] && stale=1
      [[ "${stale}" -eq 1 ]] || continue
      if [[ "${dry_run}" -eq 1 ]]; then
        echo "reclaim (skill): ${link} (was ${current})"
      else
        rm "${link}"
        echo "reclaim (skill): ${link} (was ${current})"
      fi
    done
  fi
  link_global_skills "${skills_home%/skills}"
}

[[ -d "${HOME}/.claude" ]] && repair_harness claude
[[ -d "${HOME}/.codex" ]]  && repair_harness codex

repair_skill_links "${HOME}/.claude/skills"
repair_skill_links "${HOME}/.codex/skills"

# Bin command: install-global-commands.sh now self-heals a dangling link. Pass --dry-run
# only when set; avoid expanding an empty array under `set -u` (unbound on bash 3.2 / macOS).
if [[ "${dry_run}" -eq 1 ]]; then
  "${repo_root}/scripts/install/install-global-commands.sh" --dry-run
else
  "${repo_root}/scripts/install/install-global-commands.sh"
fi

# Re-record the current checkout as the active install.
write_install_state "${install_mode}"

echo "Repair complete. Run 'roborepo doctor --installed' to confirm."

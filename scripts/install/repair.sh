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
source "${repo_root}/scripts/install/install-lib.sh"   # provides install_copy_item, link_global_skills
# shellcheck source=scripts/build/skill-lib.sh
source "${repo_root}/scripts/build/skill-lib.sh"       # provides list_source_skills (for link_global_skills)
# shellcheck source=scripts/lib/manifests-data.sh
source "${repo_root}/scripts/lib/manifests-data.sh"    # provides manifest_rows
# shellcheck source=scripts/install/state-lib.sh
source "${repo_root}/scripts/install/state-lib.sh"     # provides read_install_repo / write_install_state

on_conflict="$(read_install_on_conflict 2>/dev/null || true)"
recorded_repo="$(read_install_repo 2>/dev/null || true)"

# Re-materialize managed_copy rows from the manifest for the given harness.
repair_harness() {
  while IFS=$'\t' read -r _h kind src_rel home_abs _flags; do
    [[ "${kind}" == "managed_copy" ]] || continue
    install_copy_item "${src_rel}" "${home_abs}"
  done < <(manifest_rows "$1")
}

# Per-skill copies: repair only re-materializes the base support skill. Optional skills are
# controlled by onboarding/package toggles.
repair_skill_links() {
  link_global_skills "${1%/skills}" roborepo-support
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
write_install_state "${on_conflict}"

echo "Repair complete. Run 'roborepo doctor --installed' to confirm."

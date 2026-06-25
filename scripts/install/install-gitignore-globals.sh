#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/install/install-lib.sh
source "${repo_root}/scripts/install/install-lib.sh"  # RR_* colors + say()

dry_run=0

case "${1:-}" in
  --dry-run) dry_run=1 ;;
  "") ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

gitignore_global="${HOME}/.gitignore_global"
excludesfile_line="[core]"

entries=(
  ".jdm-indexed"
)

if [[ "${dry_run}" -eq 0 ]]; then
  touch "${gitignore_global}"
fi

added=0
for entry in "${entries[@]}"; do
  if [[ -f "${gitignore_global}" ]] && grep -Fqx "${entry}" "${gitignore_global}"; then
    say ok "${gitignore_global} already contains ${entry}"
  else
    if [[ "${dry_run}" -eq 0 ]]; then
      printf '%s\n' "${entry}" >> "${gitignore_global}"
      say added "${entry} -> ${gitignore_global}"
    else
      say "would add" "${entry} -> ${gitignore_global}"
    fi
    added=1
  fi
done

current_excludesfile="$(git config --global core.excludesfile 2>/dev/null || true)"
if [[ "${current_excludesfile}" == "${gitignore_global}" ]]; then
  say ok "git core.excludesfile already set to ${gitignore_global}"
else
  if [[ "${dry_run}" -eq 0 ]]; then
    git config --global core.excludesfile "${gitignore_global}"
    say set "git core.excludesfile -> ${gitignore_global}"
  else
    say "would set" "git core.excludesfile -> ${gitignore_global}"
  fi
fi

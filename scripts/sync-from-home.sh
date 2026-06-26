#!/usr/bin/env bash
set -euo pipefail

repo_root="${ROBOREPO_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
include_user_config=0

case "${1:-}" in
  --include-root-config|--include-user-config) include_user_config=1 ;;
  "") ;;
  *) echo "usage: $0 [--include-root-config]" >&2; exit 2 ;;
esac

# shellcheck source=scripts/lib/manifests-data.sh
source "${repo_root}/scripts/lib/manifests-data.sh"  # provides manifest_rows, manifest_has_flag

print_agent_sync_prompt() {
  local home_path="$1"
  local repo_rel="$2"
  local dst="${repo_root}/${repo_rel}"

  echo ""
  echo "Merge review prompt:"
  echo "-----"
  sed \
    -e "s#{{HOME_PATH}}#${home_path}#g" \
    -e "s#{{DST}}#${dst}#g" \
    "${repo_root}/manifests/platform/prompts/sync-merge.md"
  echo "-----"
  echo ""
}

show_diff() {
  local home_path="$1"
  local dst="$2"

  if [[ -e "${dst}" ]]; then
    # --no-pager: this runs on a real tty (interactive sync, and the expect-driven
    # tests spawn a pty), where git would otherwise page the diff through less and
    # block waiting for a keypress the Selection prompt never gets past.
    git --no-pager diff --no-index -- "${dst}" "${home_path}" || true
  else
    echo "new repo path: ${dst}"
    if [[ -f "${home_path}" ]]; then
      sed -n '1,120p' "${home_path}"
    else
      find "${home_path}" -maxdepth 2 -type f | sed "s#^#  #"
    fi
  fi
}

paths_match() {
  local home_path="$1"
  local dst="$2"

  [[ -e "${dst}" ]] || return 1
  diff -qr "${dst}" "${home_path}" >/dev/null 2>&1
}

overwrite_from_home() {
  local home_path="$1"
  local dst="$2"
  local parent
  local tmp
  local backup_dir
  local moved_existing=0

  parent="$(dirname "${dst}")"
  mkdir -p "${parent}"
  tmp="$(mktemp -d "${parent}/.sync-from-home.tmp.XXXXXX")"
  backup_dir="$(mktemp -d "${parent}/.sync-from-home.backup.XXXXXX")"

  if ! cp -Rp "${home_path}" "${tmp}/item"; then
    rm -rf "${tmp}"
    rm -rf "${backup_dir}"
    echo "error: failed to copy ${home_path}; repo path left unchanged: ${dst}" >&2
    return 1
  fi

  if [[ -e "${dst}" || -L "${dst}" ]]; then
    if ! mv "${dst}" "${backup_dir}/item"; then
      rm -rf "${tmp}"
      rm -rf "${backup_dir}"
      echo "error: failed to stage existing repo path; repo path left unchanged: ${dst}" >&2
      return 1
    fi
    moved_existing=1
  fi

  if ! mv "${tmp}/item" "${dst}"; then
    if [[ "${moved_existing}" -eq 1 ]]; then
      mv "${backup_dir}/item" "${dst}" || true
    fi
    rm -rf "${tmp}"
    rm -rf "${backup_dir}"
    echo "error: failed to replace ${dst}; original repo path was restored" >&2
    return 1
  fi

  rm -rf "${tmp}"
  rm -rf "${backup_dir}"
}

sync_item() {
  local home_path="$1"
  local repo_rel="$2"
  local kind="${3:-standard}"
  local dst="${repo_root}/${repo_rel}"
  local choice

  if [[ ! -e "${home_path}" && ! -L "${home_path}" ]]; then
    echo "skip missing: ${home_path}"
    return 0
  fi

  if [[ "${kind}" == "user_config" ]]; then
    if [[ -L "${home_path}" && "$(readlink "${home_path}")" == "${dst}" ]]; then
      echo "ok managed config: ${home_path} -> ${repo_rel}"
      return 0
    fi

    if [[ "${include_user_config}" -ne 1 ]]; then
      echo "skip user-owned config: ${home_path}"
      echo "  use --include-root-config only when intentionally promoting local root config into the repo baseline"
      return 0
    fi
  fi

  if paths_match "${home_path}" "${dst}"; then
    echo "ok unchanged: ${home_path} -> ${repo_rel}"
    return 0
  fi

  if [[ ! -t 0 ]]; then
    echo "error: ${home_path} differs from ${dst} and stdin is not interactive." >&2
    echo "Run interactively to review the diff, or merge manually." >&2
    return 1
  fi

  while true; do
    echo ""
    echo "Home config differs from repo:"
    echo "  home: ${home_path}"
    echo "  repo: ${dst}"
    echo ""
    show_diff "${home_path}" "${dst}"
    echo ""
    echo "Choose:"
    echo "  1) keep repo      skip this item"
    echo "  2) overwrite repo copy home item into repo"
    echo "  3) merge prompt   print merge prompt and skip this item"
    echo "  q) quit"
    read -r -p "Selection [1/2/3/q]: " choice

    case "${choice}" in
      1|keep)
        echo "skip: kept repo ${repo_rel}"
        return 0
        ;;
      2|overwrite)
        overwrite_from_home "${home_path}" "${dst}"
        echo "sync: ${home_path} -> ${repo_rel}"
        return 0
        ;;
      3|agent|prompt)
        print_agent_sync_prompt "${home_path}" "${repo_rel}"
        echo "skip: ${repo_rel} left unchanged"
        return 0
        ;;
      q|Q|quit|exit)
        echo "abort: sync canceled by user" >&2
        exit 1
        ;;
      *)
        echo "Invalid selection."
        ;;
    esac
  done
}

# Read the manifest on FD 3, not stdin: sync_item prompts the user interactively with `read`,
# so the loop body's stdin must stay the terminal. Feeding the loop via `< <(manifest_rows)`
# would hijack stdin with the process-substitution pipe and break every interactive prompt.
while IFS=$'\t' read -r _harness kind src_rel home_abs _flags <&3; do
  manifest_has_flag "${_flags}" nosync && continue
  case "${kind}" in
    managed_copy) sync_item "${home_abs}" "${src_rel}" ;;
    link)         sync_item "${home_abs}" "${src_rel}" ;;
    root_config)  sync_item "${home_abs}" "${src_rel}" "user_config" ;;
  esac
done 3< <(manifest_rows)

echo "skip shared skills: maintained in repo/globals/agents/skills and copied into harnesses by install/package toggles"

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bin_dir="${HOME}/.local/bin"
path_line='export PATH="${HOME}/.local/bin:${PATH}"'
backup_root="${ROBOREPO_BACKUP_ROOT:-${HOME}/.roborepo-backups/$(date +%Y%m%d-%H%M%S)}"
dry_run=0

case "${1:-}" in
  --dry-run) dry_run=1 ;;
  "") ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    echo "Windows shell detected. This installer manages POSIX shells only." >&2
    echo "Use WSL, Git Bash, or add this repo's bin directory to PATH manually:" >&2
    echo "  ${repo_root}/bin" >&2
    exit 1
    ;;
esac

choose_profile() {
  if [[ -n "${ROBOREPO_SHELL_PROFILE:-}" ]]; then
    echo "${ROBOREPO_SHELL_PROFILE}"
    return 0
  fi

  case "${SHELL:-}" in
    */zsh)
      echo "${HOME}/.zshrc"
      ;;
    */bash)
      # macOS Terminal launches LOGIN shells, which read ~/.bash_profile (not ~/.bashrc).
      # Linux interactive shells read ~/.bashrc. Pick the file the user's shell actually sources
      # on a new terminal, preferring an existing one, so the PATH line is not written somewhere
      # that never gets loaded.
      if [[ "$(uname -s)" == "Darwin" ]]; then
        if [[ -f "${HOME}/.bash_profile" ]]; then
          echo "${HOME}/.bash_profile"
        elif [[ -f "${HOME}/.bashrc" ]]; then
          echo "${HOME}/.bashrc"
        else
          echo "${HOME}/.bash_profile"
        fi
      else
        if [[ -f "${HOME}/.bashrc" ]]; then
          echo "${HOME}/.bashrc"
        elif [[ -f "${HOME}/.bash_profile" ]]; then
          echo "${HOME}/.bash_profile"
        else
          echo "${HOME}/.bashrc"
        fi
      fi
      ;;
    *)
      # Unknown / non-POSIX shell (e.g. fish). Use ~/.profile if it exists (most shells read
      # it on login), otherwise DON'T guess — writing ~/.zshrc that the shell never reads would
      # silently fail. Return empty + non-zero so the caller prints manual instructions instead.
      if [[ -f "${HOME}/.profile" ]]; then
        echo "${HOME}/.profile"
      else
        return 1
      fi
      ;;
  esac
}

print_command_conflict_prompt() {
  local name="$1"
  local target="$2"
  local source_path="$3"

  echo "conflict: ${target} already exists and is not managed by this repo." >&2
  echo "  command: ${name}" >&2
  echo "  repo source: ${source_path}" >&2
  echo "Merge review prompt:" >&2
  echo "  Default stance: preserve the existing local command as source of truth." >&2
  echo "  Required first step: compute your own complete comparison of both paths. Do not rely on this prompt as an exhaustive conflict summary." >&2
  echo "  Add repo command behavior only if it does not conflict with the local command. Flag conflicts instead of guessing." >&2
}

check_command_target() {
  local name="$1"
  local target="${bin_dir}/${name}"
  local source_path="${repo_root}/bin/${name}"
  local current

  if [[ ! -e "${target}" && ! -L "${target}" ]]; then
    return 0
  fi

  current="$(readlink "${target}" 2>/dev/null || true)"
  if [[ "${current}" == "${source_path}" ]]; then
    return 0
  fi

  # A dangling symlink (link present, target missing) is a stale link from a prior
  # checkout path — e.g. after the repo was renamed/moved. It is never a live user
  # command, so it is safe to reclaim. link_command replaces it below; do not block.
  if [[ -L "${target}" && ! -e "${target}" ]]; then
    return 0
  fi

  print_command_conflict_prompt "${name}" "${target}" "${source_path}"
  return 1
}

preflight_commands() {
  local conflict=0

  check_command_target "roborepo" || conflict=1

  if [[ "${conflict}" -eq 1 ]]; then
    echo "Install has global command conflicts. No command links were changed." >&2
    echo "Use the merge prompt above, or move/merge these commands before re-running." >&2
    exit 1
  fi
}

preflight_commands

if [[ "${dry_run}" -eq 1 ]]; then
  [[ -d "${bin_dir}" ]] || echo "would mkdir: ${bin_dir}"
else
  mkdir -p "${bin_dir}"
fi

link_command() {
  local name="$1"
  local target="${bin_dir}/${name}"
  local source_path="${repo_root}/bin/${name}"

  if [[ -e "${target}" || -L "${target}" ]]; then
    local current
    current="$(readlink "${target}" 2>/dev/null || true)"
    if [[ "${current}" == "${source_path}" ]]; then
      echo "ok: ${target}"
      return
    fi
    # Reclaim a dangling link (stale prior-checkout path) by replacing it. Any other
    # mismatch is a real conflict (live file or link to something that still exists).
    if [[ -L "${target}" && ! -e "${target}" ]]; then
      if [[ "${dry_run}" -eq 1 ]]; then
        echo "relink: ${target} -> ${source_path} (was dangling)"
        return
      fi
      ln -sfn "${source_path}" "${target}"
      echo "relink: ${target} -> ${source_path} (was dangling)"
      return
    fi
    print_command_conflict_prompt "${name}" "${target}" "${source_path}"
    exit 1
  fi

  if [[ "${dry_run}" -eq 1 ]]; then
    echo "link: ${target} -> ${source_path}"
    return
  fi
  ln -s "${source_path}" "${target}"
  echo "link: ${target} -> ${source_path}"
}

link_command "roborepo"

profile_path="$(choose_profile || true)"
if [[ -z "${profile_path}" ]]; then
  # Unknown shell with no ~/.profile — do not guess a file the shell won't read. Tell the
  # user exactly what to add. roborepo is already symlinked into ${bin_dir} at this point.
  echo "note: could not determine a shell profile for SHELL='${SHELL:-unknown}'."
  echo "      Add ${bin_dir} to your shell's PATH manually. For most shells:"
  echo "        ${path_line}"
  echo "      (fish: fish_add_path ${bin_dir})"
  echo "      Then open a new shell and run 'roborepo doctor' to confirm."
  exit 0
fi
if [[ "${dry_run}" -eq 1 ]]; then
  [[ -e "${profile_path}" ]] || echo "would touch: ${profile_path}"
else
  touch "${profile_path}"
fi

if [[ -e "${profile_path}" ]] && grep -Fqx "${path_line}" "${profile_path}"; then
  echo "ok: ${profile_path} already includes ${bin_dir}"
else
  if [[ "${dry_run}" -eq 1 ]]; then
    echo "path: ${path_line}"
    exit 0
  fi
  mkdir -p "${backup_root}$(dirname "${profile_path}")"
  cp -p "${profile_path}" "${backup_root}${profile_path}"
  printf '\n# Harness config global commands\n%s\n' "${path_line}" >> "${profile_path}"
  echo "backup: ${profile_path} -> ${backup_root}${profile_path}"
  echo "path: ${path_line}"
fi

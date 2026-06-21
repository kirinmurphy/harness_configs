#!/usr/bin/env bash
# Shared helpers for install scripts. Source this file, do not execute directly.

unique_backup_path() {
  local home_path="$1"
  local backup_path="${backup_root}${home_path}"

  if [[ ! -e "${backup_path}" && ! -L "${backup_path}" ]]; then
    echo "${backup_path}"
    return 0
  fi

  local i=1
  while [[ -e "${backup_path}.${i}" || -L "${backup_path}.${i}" ]]; do
    i=$((i + 1))
  done
  echo "${backup_path}.${i}"
}

timestamped_path() {
  local path="$1"
  local tag="$2"
  local ts="${ROBOREPO_INSTALL_TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"
  local dir base name ext

  dir="$(dirname "${path}")"
  base="$(basename "${path}")"
  if [[ -d "${path}" && ! -L "${path}" ]]; then
    echo "${dir}/${base}_${tag}_${ts}"
    return 0
  fi

  case "${base}" in
    *.*)
      name="${base%.*}"
      ext=".${base##*.}"
      echo "${dir}/${name}_${tag}_${ts}${ext}"
      ;;
    *)
      echo "${dir}/${base}_${tag}_${ts}"
      ;;
  esac
}

copy_tree() {
  local src="$1"
  local dest="$2"

  if [[ -d "${src}" && ! -L "${src}" ]]; then
    mkdir -p "$(dirname "${dest}")"
    cp -R "${src}" "${dest}"
  else
    mkdir -p "$(dirname "${dest}")"
    cp -p "${src}" "${dest}"
  fi
}

stdin_is_interactive() {
  [[ -t 0 || "${ROBOREPO_ASSUME_INTERACTIVE:-0}" == "1" ]]
}

paths_equivalent_for_copy() {
  local src="$1"
  local dest="$2"

  [[ -e "${dest}" || -L "${dest}" ]] || return 1
  if [[ -f "${src}" && -f "${dest}" && ! -L "${dest}" ]]; then
    cmp -s "${src}" "${dest}"
    return $?
  fi
  return 1
}

path_has_meaningful_content() {
  local path="$1"

  [[ -e "${path}" || -L "${path}" ]] || return 1
  if [[ -L "${path}" ]]; then
    return 0
  fi
  if [[ -f "${path}" ]]; then
    [[ -s "${path}" ]]
    return $?
  fi
  if [[ -d "${path}" ]]; then
    [[ -n "$(find "${path}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]
    return $?
  fi
  return 0
}

choose_path_conflict_action() {
  local repo_rel="$1"
  local home_path="$2"
  local src="${repo_root}/${repo_rel}"
  local choice

  if [[ -n "${ROBOREPO_ON_CONFLICT:-}" ]]; then
    CONFIG_COLLISION_ACTION="${ROBOREPO_ON_CONFLICT}"
    return 0
  fi

  if [[ "${dry_run}" -eq 1 ]]; then
    echo "collision: ${home_path}"
    echo "dry-run: would ask overwrite or keep originals"
    return 0
  fi

  if ! stdin_is_interactive; then
    echo "error: ${home_path} exists and stdin is not interactive." >&2
    echo "Run interactively, pass --on-conflict overwrite|keep, or use --dry-run to inspect collisions." >&2
    return 1
  fi

  while true; do
    echo ""
    echo "Existing harness target:"
    echo "  local:   ${home_path}"
    echo "  harness: ${src}"
    echo ""
    echo "Choose:"
    echo "  1) overwrite     backup local as *_original_TIMESTAMP; install repo item"
    echo "  2) keep originals leave local active; stage repo item as *_update_TIMESTAMP"
    echo "  q) quit"
    printf "Selection [1/2/q]: "
    if ! read -r choice; then
      CONFIG_COLLISION_ACTION="abort"
      return 0
    fi

    case "${choice}" in
      1|overwrite)
        CONFIG_COLLISION_ACTION="overwrite"
        return 0
        ;;
      2|keep|original|originals)
        CONFIG_COLLISION_ACTION="keep"
        return 0
        ;;
      q|Q|quit|exit)
        CONFIG_COLLISION_ACTION="abort"
        return 0
        ;;
      *)
        echo "Invalid selection."
        ;;
    esac
  done
}

stage_update_item() {
  local repo_rel="$1"
  local home_path="$2"
  local src="${repo_root}/${repo_rel}"
  local update_path
  update_path="$(timestamped_path "${home_path}" update)"

  if [[ "${dry_run}" -eq 0 ]]; then
    copy_tree "${src}" "${update_path}"
  fi
  echo "stage: ${update_path} <- ${src}"
}

install_copy_item() {
  local repo_rel="$1"
  local home_path="$2"
  local harness="${3:-}"
  local src="${repo_root}/${repo_rel}"

  if [[ ! -e "${src}" ]]; then
    echo "missing source: ${src}" >&2
    return 1
  fi

  if [[ -n "${harness}" && -e "${home_path}" && ! -L "${home_path}" ]]; then
    local pre_install_backup="${HOME}/.roborepo/backups/pre-install/${harness}/$(basename "${home_path}")"
    if [[ ! -e "${pre_install_backup}" ]]; then
      if [[ "${dry_run}" -eq 0 ]]; then
        mkdir -p "$(dirname "${pre_install_backup}")"
        cp -a "${home_path}" "${pre_install_backup}"
      fi
      echo "pre-install backup: ${home_path} -> ${pre_install_backup}"
    fi
  fi

  if [[ ! -e "${home_path}" && ! -L "${home_path}" ]]; then
    if [[ "${dry_run}" -eq 0 ]]; then
      copy_tree "${src}" "${home_path}"
    fi
    echo "copy: ${home_path} <- ${src}"
    return 0
  fi

  if paths_equivalent_for_copy "${src}" "${home_path}"; then
    echo "ok: ${home_path}"
    return 0
  fi

  if [[ "${install_mode}" == "managed" ]]; then
    if path_has_meaningful_content "${home_path}"; then
      local original_path
      original_path="$(timestamped_path "${home_path}" original)"
      if [[ "${dry_run}" -eq 0 ]]; then
        mkdir -p "$(dirname "${original_path}")"
        mv "${home_path}" "${original_path}"
        copy_tree "${src}" "${home_path}"
      fi
      echo "backup: ${home_path} -> ${original_path}"
      echo "copy: ${home_path} <- ${src}"
      print_install_conflict_prompt "${repo_rel}" "${home_path}"
      return 0
    fi
    if [[ "${dry_run}" -eq 0 ]]; then
      copy_tree "${src}" "${home_path}"
    fi
    echo "copy: ${home_path} <- ${src}"
    return 0
  fi

  CONFIG_COLLISION_ACTION=""
  choose_path_conflict_action "${repo_rel}" "${home_path}"
  if [[ "${dry_run}" -eq 1 && -n "${harness}" ]]; then
    describe_user_config "${harness}" "${home_path}"
  fi
  case "${CONFIG_COLLISION_ACTION}" in
    overwrite)
      local original_path
      original_path="$(timestamped_path "${home_path}" original)"
      if [[ "${dry_run}" -eq 0 ]]; then
        mkdir -p "$(dirname "${original_path}")"
        mv "${home_path}" "${original_path}"
        copy_tree "${src}" "${home_path}"
      fi
      echo "backup: ${home_path} -> ${original_path}"
      echo "copy: ${home_path} <- ${src}"
      print_install_conflict_prompt "${repo_rel}" "${home_path}"
      ;;
    keep)
      stage_update_item "${repo_rel}" "${home_path}"
      print_install_conflict_prompt "${repo_rel}" "${home_path}"
      ;;
    abort)
      echo "abort: install canceled by user" >&2
      exit 1
      ;;
  esac
}

install_link_item() {
  local repo_rel="$1"
  local home_path="$2"
  local src="${repo_root}/${repo_rel}"

  if [[ ! -e "${src}" ]]; then
    echo "missing source: ${src}" >&2
    return 1
  fi

  if [[ -L "${home_path}" ]]; then
    local current
    current="$(readlink "${home_path}")"
    if [[ "${current}" == "${src}" ]]; then
      echo "ok: ${home_path}"
      return 0
    fi
    case "${current}" in
      "${repo_root}"/*)
        if [[ "${dry_run}" -eq 0 ]]; then
          ln -sfn "${src}" "${home_path}"
        fi
        echo "relink: ${home_path} -> ${src}"
        return 0
        ;;
    esac
  fi

  if [[ ! -e "${home_path}" && ! -L "${home_path}" ]]; then
    if [[ "${dry_run}" -eq 0 ]]; then
      mkdir -p "$(dirname "${home_path}")"
      ln -s "${src}" "${home_path}"
    fi
    echo "link: ${home_path} -> ${src}"
    return 0
  fi

  if [[ "${install_mode}" == "managed" ]]; then
    if path_has_meaningful_content "${home_path}"; then
      local original_path
      original_path="$(timestamped_path "${home_path}" original)"
      if [[ "${dry_run}" -eq 0 ]]; then
        mkdir -p "$(dirname "${original_path}")" "$(dirname "${home_path}")"
        mv "${home_path}" "${original_path}"
        ln -s "${src}" "${home_path}"
      fi
      echo "backup: ${home_path} -> ${original_path}"
      echo "link: ${home_path} -> ${src}"
      print_install_conflict_prompt "${repo_rel}" "${home_path}"
      return 0
    fi
    if [[ "${dry_run}" -eq 0 ]]; then
      ln -s "${src}" "${home_path}"
    fi
    echo "link: ${home_path} -> ${src}"
    return 0
  fi

  CONFIG_COLLISION_ACTION=""
  choose_path_conflict_action "${repo_rel}" "${home_path}"
  case "${CONFIG_COLLISION_ACTION}" in
    overwrite)
      local original_path
      original_path="$(timestamped_path "${home_path}" original)"
      if [[ "${dry_run}" -eq 0 ]]; then
        mkdir -p "$(dirname "${original_path}")" "$(dirname "${home_path}")"
        mv "${home_path}" "${original_path}"
        ln -s "${src}" "${home_path}"
      fi
      echo "backup: ${home_path} -> ${original_path}"
      echo "link: ${home_path} -> ${src}"
      print_install_conflict_prompt "${repo_rel}" "${home_path}"
      ;;
    keep)
      stage_update_item "${repo_rel}" "${home_path}"
      print_install_conflict_prompt "${repo_rel}" "${home_path}"
      ;;
    abort)
      echo "abort: install canceled by user" >&2
      exit 1
      ;;
  esac
}

link_item() {
  local repo_rel="$1"
  local home_path="$2"
  local src="${repo_root}/${repo_rel}"

  if [[ ! -e "${src}" ]]; then
    echo "missing source: ${src}" >&2
    return 1
  fi

  if [[ "${dry_run}" -eq 0 ]]; then
    mkdir -p "$(dirname "${home_path}")"
  fi

  if [[ -L "${home_path}" ]]; then
    local current
    current="$(readlink "${home_path}")"
    if [[ "${current}" == "${src}" ]]; then
      echo "ok: ${home_path}"
      return 0
    fi
    case "${current}" in
      "${repo_root}"/*)
        if [[ "${dry_run}" -eq 0 ]]; then
          ln -sfn "${src}" "${home_path}"
        fi
        echo "relink: ${home_path} -> ${src}"
        return 0
        ;;
    esac
  fi

  if [[ -e "${home_path}" || -L "${home_path}" ]]; then
    local backup_path
    backup_path="$(unique_backup_path "${home_path}")"
    if [[ "${dry_run}" -eq 0 ]]; then
      mkdir -p "$(dirname "${backup_path}")"
      mv "${home_path}" "${backup_path}"
    fi
    echo "backup: ${home_path} -> ${backup_path}"
  fi

  if [[ "${dry_run}" -eq 0 ]]; then
    ln -s "${src}" "${home_path}"
  fi
  echo "link: ${home_path} -> ${src}"
}

print_install_conflict_prompt() {
  local repo_rel="$1"
  local home_path="$2"
  local src="${repo_root}/${repo_rel}"

  echo ""
  echo "Merge review prompt:"
  echo "-----"
  cat <<EOF
Resolve this harness install conflict.

Repo harness path:
  ${src}

Existing local path:
  ${home_path}

Default stance: preserve the existing local path as source of truth unless you can prove a repo change can be added without breaking local behavior.

Required first step: compute your own complete comparison of both paths. Do not rely on this prompt as an exhaustive conflict summary. For directories, inspect the full recursive file list and content diffs. For structured files, parse the format when possible instead of using only text matching.

Goal: preserve the user's existing local behavior while installing useful harness behavior from the repo.

Merge instructions:
- Keep local-only behavior by default.
- Add repo-only harness behavior only when it does not conflict with local behavior.
- If both sides edit the same setting, hook, rule, command, skill, or MCP/server entry, explain the conflict and stop for user choice.
- Do not delete, replace, or move the local path unless the user explicitly approves that exact action.
- Report the files changed and the conflicts left unresolved.
EOF
  echo "-----"
  echo ""
}

link_item_clean() {
  local repo_rel="$1"
  local home_path="$2"
  local src="${repo_root}/${repo_rel}"

  if [[ ! -e "${src}" ]]; then
    echo "missing source: ${src}" >&2
    return 1
  fi

  if [[ "${dry_run}" -eq 0 ]]; then
    mkdir -p "$(dirname "${home_path}")"
  fi

  if [[ -L "${home_path}" ]]; then
    local current
    current="$(readlink "${home_path}")"
    if [[ "${current}" == "${src}" ]]; then
      echo "ok: ${home_path}"
      return 0
    fi
    case "${current}" in
      "${repo_root}"/*)
        if [[ "${dry_run}" -eq 0 ]]; then
          ln -sfn "${src}" "${home_path}"
        fi
        echo "relink: ${home_path} -> ${src}"
        return 0
        ;;
    esac
  fi

  if [[ -e "${home_path}" || -L "${home_path}" ]]; then
    echo "conflict: ${home_path} already exists; not replacing it"
    print_install_conflict_prompt "${repo_rel}" "${home_path}"
    return 1
  fi

  if [[ "${dry_run}" -eq 0 ]]; then
    ln -s "${src}" "${home_path}"
  fi
  echo "link: ${home_path} -> ${src}"
}

export_user_config() {
  local harness="$1"
  local repo_rel="$2"
  local home_path="$3"
  local src="${repo_root}/${repo_rel}"

  if [[ -L "${home_path}" ]]; then
    local current
    current="$(readlink "${home_path}")"
    case "${current}" in
      "${src}"|"${repo_root}"/*)
      if [[ "${dry_run}" -eq 0 ]]; then
        rm "${home_path}"
        cp "${src}" "${home_path}"
      fi
      echo "copy: ${home_path} <- ${src} (converted from repo symlink)"
      return 0
      ;;
    esac
  fi

  install_copy_item "${repo_rel}" "${home_path}" "${harness}"
}

preflight_clean_item() {
  local repo_rel="$1"
  local home_path="$2"
  local src="${repo_root}/${repo_rel}"

  if [[ ! -e "${home_path}" && ! -L "${home_path}" ]]; then
    return 0
  fi

  if [[ -L "${home_path}" ]]; then
    case "$(readlink "${home_path}")" in
      "${src}"|"${repo_root}"/*) return 0 ;;
    esac
  fi

  echo "conflict: ${home_path} already exists; not replacing it" >&2
  print_install_conflict_prompt "${repo_rel}" "${home_path}" >&2
  return 1
}

remove_repo_link() {
  local home_path="$1"

  if [[ ! -L "${home_path}" ]]; then
    return 0
  fi

  local current
  current="$(readlink "${home_path}")"
  case "${current}" in
    "${repo_root}"/*)
      local backup_path
      backup_path="$(unique_backup_path "${home_path}")"
      if [[ "${dry_run}" -eq 0 ]]; then
        mkdir -p "$(dirname "${backup_path}")"
        mv "${home_path}" "${backup_path}"
      fi
      echo "cleanup: ${home_path} -> ${backup_path}"
      ;;
  esac
}

# Link a single skill into a harness's skills dir. Unlike install_link_item, skill collisions
# with real directories (native-installed skills with the same name) are skipped gracefully —
# native skills are out-of-band drift that doctor will surface via "roborepo skill adopt".
link_skill_item() {
  local repo_rel="$1"
  local home_path="$2"
  local src="${repo_root}/${repo_rel}"

  if [[ ! -e "${src}" ]]; then
    echo "missing source: ${src}" >&2
    return 1
  fi

  if [[ -L "${home_path}" ]]; then
    local current
    current="$(readlink "${home_path}")"
    if [[ "${current}" == "${src}" ]]; then
      echo "ok: ${home_path}"
      return 0
    fi
    case "${current}" in
      "${repo_root}"/*)
        if [[ "${dry_run}" -eq 0 ]]; then
          ln -sfn "${src}" "${home_path}"
        fi
        echo "relink: ${home_path} -> ${src}"
        return 0
        ;;
    esac
    echo "skip (unmanaged symlink): ${home_path}"
    return 0
  fi

  if [[ ! -e "${home_path}" && ! -L "${home_path}" ]]; then
    if [[ "${dry_run}" -eq 0 ]]; then
      mkdir -p "$(dirname "${home_path}")"
      ln -s "${src}" "${home_path}"
    fi
    echo "link: ${home_path} -> ${src}"
    return 0
  fi

  # Exists as a real dir/file — a native-installed skill with the same name. Leave it.
  echo "skip (native skill): ${home_path}"
}

# One-shot migration: tear down the legacy ~/.agents/skills runtime tree.
# Pre-native-alignment, roborepo fanned skills into ~/.agents/skills via a single dir-level managed
# symlink (agents link globals/agents/skills -> ~/.agents/skills), and Codex also scans ~/.agents.
# Now that skills are linked per-skill into each harness's native dir, a leftover ~/.agents/skills
# link makes Codex discover the same skills twice. Reclaim it only when it is a roborepo-managed
# symlink into the repo (back up first, mirroring remove_repo_link); never touch a user's real
# ~/.agents content (a real dir/file is left alone). Idempotent: a no-op once removed.
# Self-contained (provides defaults for backup_root/dry_run) so it is safe from every call site.
remove_legacy_agents_skills() {
  local legacy="${HOME}/.agents/skills"

  [[ -L "${legacy}" ]] || return 0
  local current
  current="$(readlink "${legacy}")"
  case "${current}" in
    "${repo_root}"/*) ;;
    *) return 0 ;;
  esac

  local backup_root="${backup_root:-${HOME}/.roborepo-backups/$(date +%Y%m%d-%H%M%S)}"
  local dry_run="${dry_run:-0}"
  local backup_path
  backup_path="$(unique_backup_path "${legacy}")"
  if [[ "${dry_run}" -eq 0 ]]; then
    mkdir -p "$(dirname "${backup_path}")"
    mv "${legacy}" "${backup_path}"
    rmdir "${HOME}/.agents" 2>/dev/null || true  # remove ~/.agents only if now empty
  fi
  echo "cleanup (legacy ~/.agents/skills): ${legacy} -> ${backup_path}"
}

# Enumerate globals/agents/skills/* and link each into <home_dir>/skills/<name>.
# Also prunes stale managed symlinks (skill removed from repo source).
# Requires: ${repo_root}, ${dry_run}, list_source_skills (from skill-lib.sh).
link_global_skills() {
  local home_dir="$1"
  local src_dir="${repo_root}/globals/agents/skills"
  local skills_home="${home_dir}/skills"

  # Migrate off the legacy ~/.agents/skills location before linking. Idempotent and global, so the
  # redundant second call (this runs once per harness) is a cheap no-op.
  remove_legacy_agents_skills

  [[ -d "${src_dir}" ]] || return 0

  local name
  while IFS= read -r name; do
    [[ -n "${name}" ]] || continue
    link_skill_item "globals/agents/skills/${name}" "${skills_home}/${name}"
  done < <(list_source_skills "${src_dir}")

  # Prune managed skill symlinks whose source has been removed
  [[ -d "${skills_home}" ]] || return 0
  local link target skill_name
  for link in "${skills_home}"/*; do
    [[ -L "${link}" ]] || continue
    target="$(readlink "${link}")"
    case "${target}" in
      "${repo_root}/globals/agents/skills/"*) ;;
      *) continue ;;
    esac
    skill_name="$(basename "${link}")"
    [[ -f "${src_dir}/${skill_name}/SKILL.md" ]] && continue
    if [[ "${dry_run}" -eq 0 ]]; then
      rm "${link}"
    fi
    echo "prune: ${link} (source removed)"
  done
}

describe_user_config() {
  local harness="$1"
  local home_path="$2"

  if [[ "${harness}" == "claude" ]]; then
    if command -v node >/dev/null 2>&1; then
      if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "${home_path}" >/dev/null 2>&1; then
        echo "  parse: valid JSON"
      else
        echo "  parse: invalid JSON or non-JSON content"
      fi
    fi
    grep -E '"(permissions|hooks|mcpServers|enabledPlugins|extraKnownMarketplaces|model|statusLine)"[[:space:]]*:' "${home_path}" 2>/dev/null \
      | sed 's/^/  has: /' \
      | head -n 12 || true
    return 0
  fi

  echo "  parse: TOML not fully parsed by installer"
  grep -E '^[[:space:]]*(model|model_provider|approval_policy|sandbox_mode)[[:space:]]*=|^[[:space:]]*\[(mcp_servers|model_providers|profiles|features|hooks|projects|plugins)(\.|\])' "${home_path}" 2>/dev/null \
    | sed 's/^/  has: /' \
    | head -n 20 || true
}

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
      if [[ -f "${HOME}/.bashrc" ]]; then
        echo "${HOME}/.bashrc"
      elif [[ -f "${HOME}/.bash_profile" ]]; then
        echo "${HOME}/.bash_profile"
      else
        echo "${HOME}/.bashrc"
      fi
      ;;
    *)
      if [[ -f "${HOME}/.profile" ]]; then
        echo "${HOME}/.profile"
      else
        echo "${HOME}/.zshrc"
      fi
      ;;
  esac
}

#!/usr/bin/env bash
# Shared helpers for skill linking. Source this file, do not execute directly.
#
# The single source-of-truth rule for "what is a real skill folder":
#   a direct child directory that contains a SKILL.md, and is NOT itself a symlink.
# Both the shared layer (globals/system/skills/) and the internal layer (local/skills/) use this
# rule, so the definition lives in exactly one place.

# list_source_skills <src_dir>
# Prints one skill NAME per line for each real skill folder in <src_dir>.
# Skips: non-directories, symlinked entries, folders without a SKILL.md, dotfiles.
list_source_skills() {
  local src_dir="$1"
  [[ -d "${src_dir}" ]] || return 0

  local entry name
  for entry in "${src_dir}"/*/; do
    [[ -d "${entry}" ]] || continue
    name="$(basename "${entry%/}")"
    case "${name}" in .*) continue ;; esac   # skip dotfolders
    [[ -L "${src_dir}/${name}" ]] && continue # never bundle/link a symlinked source
    [[ -f "${src_dir}/${name}/SKILL.md" ]] || continue
    printf '%s\n' "${name}"
  done
}

#!/usr/bin/env bash
# Reader for the data files under manifests/ — the single source of truth shared by the
# install / verify / doctor / sync scripts. Source this file; do not execute. Requires
# ${repo_root} to be set by the caller.
#
#   manifests/platform/manifest.tsv       managed home<->repo paths   -> manifest_rows / manifest_path
#   manifests/platform/source-files.tsv   required-file checklist     -> source_files
#   manifests/platform/verify-content.tsv post-install content checks -> verify_content_rows
#   manifests/platform/rule-targets.tsv   generated rule targets      -> rule_target_rows
#   manifests/platform/shell-snippets.tsv shell source/prune catalog   -> shell_snippet_rows
#   manifests/platform/harnesses.tsv      harness presence metadata    -> harness_rows / harness_present
#
# manifest_path
#   Echo the absolute path to the manifest.
#
# manifest_rows [harness] [kind]
#   Emit matching rows as tab-separated lines, one per row, with the home dir already
#   resolved to an absolute path. Output columns:
#       harness <TAB> kind <TAB> src_rel <TAB> home_abs <TAB> flags
#   Filters (each optional, "-" or empty = no filter):
#       harness : claude | codex
#       kind    : link | root_config | cleanup
#   Comment lines (#...) and blank lines are skipped. Callers split with IFS=$'\t'.
#
# Home roots are resolved here so no other script hardcodes ~/.claude etc.

manifest_path() {
  echo "${repo_root}/manifests/platform/manifest.tsv"
}

# Resolve a home_root token (claude|codex) to an absolute dir.
_manifest_home_root() {
  case "$1" in
    claude) echo "${HOME}/.claude" ;;
    codex)  echo "${HOME}/.codex" ;;
    *) echo "manifest: unknown home_root '$1'" >&2; return 1 ;;
  esac
}

manifest_rows() {
  local want_harness="${1:-}"
  local want_kind="${2:-}"
  [[ "${want_harness}" == "-" ]] && want_harness=""
  [[ "${want_kind}" == "-" ]] && want_kind=""

  local harness kind src_rel home_sub home_root flags home_abs
  while IFS=$'\t' read -r harness kind src_rel home_sub home_root flags; do
    # Skip comments / blanks. The leading field of a comment line starts with '#'.
    [[ -z "${harness}" || "${harness}" == \#* ]] && continue
    [[ -n "${want_harness}" && "${harness}" != "${want_harness}" ]] && continue
    [[ -n "${want_kind}" && "${kind}" != "${want_kind}" ]] && continue

    home_abs="$(_manifest_home_root "${home_root}")/${home_sub}"
    printf '%s\t%s\t%s\t%s\t%s\n' "${harness}" "${kind}" "${src_rel}" "${home_abs}" "${flags}"
  done < "$(manifest_path)"
}

# Convenience: true if a row's flags field contains <flag>.
manifest_has_flag() {
  local flags="$1" flag="$2"
  [[ ",${flags}," == *",${flag},"* ]]
}

# Emit each repo-relative path from manifests/platform/source-files.tsv, one per line. This is the
# "packing checklist" of files the repo must contain (asserted by doctor). Comments and
# blank lines are skipped.
source_files() {
  local line
  while IFS= read -r line; do
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    echo "${line}"
  done < "${repo_root}/manifests/platform/source-files.tsv"
}

verify_content_rows() {
  local home_root home_sub pattern label home_abs
  while IFS=$'\t' read -r home_root home_sub pattern label; do
    [[ -z "${home_root}" || "${home_root}" == \#* ]] && continue
    home_abs="$(_manifest_home_root "${home_root}")/${home_sub}"
    printf '%s\t%s\t%s\n' "${home_abs}" "${pattern}" "${label}"
  done < "${repo_root}/manifests/platform/verify-content.tsv"
}

rule_target_rows() {
  local target source_dirs
  while IFS=$'\t' read -r target source_dirs; do
    [[ -z "${target}" || "${target}" == \#* ]] && continue
    printf '%s\t%s\n' "${target}" "${source_dirs}"
  done < "${repo_root}/manifests/platform/rule-targets.tsv"
}

shell_snippet_rows() {
  local kind path
  while IFS=$'\t' read -r kind path; do
    [[ -z "${kind}" || "${kind}" == \#* ]] && continue
    printf '%s\t%s\n' "${kind}" "${path}"
  done < "${repo_root}/manifests/platform/shell-snippets.tsv"
}

harness_rows() {
  local harness home_roots presence_roots display_name
  while IFS=$'\t' read -r harness home_roots presence_roots display_name; do
    [[ -z "${harness}" || "${harness}" == \#* ]] && continue
    printf '%s\t%s\t%s\t%s\n' "${harness}" "${home_roots}" "${presence_roots}" "${display_name}"
  done < "${repo_root}/manifests/platform/harnesses.tsv"
}

harness_present() {
  local want_harness="$1"
  local harness _home_roots presence_roots _display_name token
  while IFS=$'\t' read -r harness _home_roots presence_roots _display_name; do
    [[ "${harness}" == "${want_harness}" ]] || continue
    IFS=',' read -ra tokens <<< "${presence_roots}"
    for token in "${tokens[@]}"; do
      [[ -d "$(_manifest_home_root "${token}")" ]] && return 0
    done
    return 1
  done < <(harness_rows)
  echo "harness: unknown harness '${want_harness}'" >&2
  return 1
}

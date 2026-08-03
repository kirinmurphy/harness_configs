#!/usr/bin/env bash
# Reusable uninstall building blocks, extracted from uninstall.sh (Phase 4:
# docs/plans/active/discoverable-harness-provider-architecture-plan.md) so `roborepo harness
# withdraw <id>` can reuse the same per-capability removal logic uninstall.sh uses, scoped to one
# provider, without executing uninstall.sh's full top-to-bottom sequence. Source this file; do not
# execute. Requires ${repo_root}, ${dry_run}, and ${HOME} to be set by the caller, and
# scripts/lib/manifests-data.sh + scripts/install/state-lib.sh + scripts/install/install-lib.sh
# already sourced (for manifest_rows, harness_detected_rows, roborepo_state_dir,
# root_config_drift_status, is_roborepo_authored, content_matches_repo_source).

# The checkout that performed the last install, recorded in install-state.json. May differ
# from repo_root if the checkout was moved/renamed since install; used so uninstall can still
# reclaim links left by that prior path. Empty if no state file.
recorded_repo="$(read_install_repo 2>/dev/null || true)"

# True if a symlink at ${path} is one this repo manages: it targets the current repo_root,
# the recorded prior checkout, or the machine-local skill cache. Dangling links into a prior
# checkout or cache are also managed.
is_managed_link() {
  local path="$1"
  [[ -L "${path}" ]] || return 1

  local current
  current="$(readlink "${path}")"
  case "${current}" in
    "${repo_root}"/*) return 0 ;;
  esac
  if [[ -n "${recorded_repo}" ]]; then
    case "${current}" in
      "${recorded_repo}"/*) return 0 ;;
    esac
  fi
  case "${current}" in
    */.roborepo/skills/*) return 0 ;;
  esac
  # Dangling: link present but target missing -> stale link from a prior checkout path.
  [[ ! -e "${path}" ]] && return 0
  return 1
}

remove_repo_symlink() {
  local path="$1"
  is_managed_link "${path}" || return 0

  if [[ "${dry_run}" -eq 1 ]]; then
    echo "unlink: ${path}"
  else
    rm "${path}"
    echo "unlink: ${path}"
  fi
}

remove_file_if_repo_symlink() {
  local path="$1"
  local expected="$2"
  [[ -L "${path}" ]] || return 0
  # Match the exact current target, or reclaim any managed/dangling link at this path.
  if [[ "$(readlink "${path}")" != "${expected}" ]]; then
    is_managed_link "${path}" || return 0
  fi

  if [[ "${dry_run}" -eq 1 ]]; then
    echo "unlink: ${path}"
  else
    rm "${path}"
    echo "unlink: ${path}"
  fi
}

# is_roborepo_authored and content_matches_repo_source come from install-lib.sh (sourced by the
# caller) — single source of truth instead of two hand-kept-in-sync copies.

# Defense-in-depth for rm -rf call sites: every path uninstall deletes must resolve (after symlink
# resolution) under a known harness home (~/.claude, ~/.codex, or any provider the registry adds
# later — from harness_detected_rows, whose home path is always the resolved manifest location
# regardless of whether that provider is currently present). content_matches_repo_source already
# makes deletion content-safe; this makes it path-safe too, so a future manifest-row bug can never
# point a delete at an arbitrary path. Aborts uninstall rather than silently skipping — a path
# outside every known home reaching here means the manifest itself is wrong and needs a human to
# look at it.
assert_under_harness_home() {
  local target="$1"
  local resolved home_path
  resolved="$(cd "$(dirname "${target}")" 2>/dev/null && pwd)/$(basename "${target}")" || resolved="${target}"
  while IFS=$'\t' read -r _id home_path _present _display_name _root_config_path; do
    [[ -z "${home_path}" ]] && continue
    case "${resolved}" in
      "${home_path}"/*) return 0 ;;
    esac
  done < <(harness_detected_rows)
  echo "abort: refusing to delete outside harness home: ${target} (resolved: ${resolved})" >&2
  exit 1
}

# Restore the user's pre-roborepo original for a link target, if install persisted one to
# ~/.roborepo/backups/pre-install/<harness>/<basename>. Only restores into a now-vacant slot (the
# caller has already reclaimed roborepo's symlink/copy), so it never clobbers a user's own file left
# in place. Mirrors remove_root_config's restore arm for link rows.
restore_pre_install_link_backup() {
  local home_abs="$1"
  local harness="$2"
  [[ -n "${harness}" ]] || return 0

  local backup="${HOME}/.roborepo/backups/pre-install/${harness}/$(basename "${home_abs}")"
  [[ -e "${backup}" ]] || return 0
  [[ ! -e "${home_abs}" && ! -L "${home_abs}" ]] || return 0

  if [[ "${dry_run}" -eq 1 ]]; then
    echo "restore (link backup): ${backup} -> ${home_abs}"
  else
    mkdir -p "$(dirname "${home_abs}")"
    mv "${backup}" "${home_abs}"
    echo "restore (link backup): ${backup} -> ${home_abs}"
  fi
}

# Reclaim a managed `link` target left by install, in three passes:
#   1) a roborepo symlink (managed mode) -> remove it (is_managed_link gated).
#   2) a REAL file/dir byte-identical to the repo source (adopt-mode copy, or a legacy materialized
#      link) -> remove it. Content-matched so native/user-modified content is never deleted.
#   3) restore the user's pre-roborepo original, if install persisted one.
# A real, content-DIVERGENT target (the user edited the copy, or it is genuinely theirs) is left in
# place by both (1) and (2) — we remove only what roborepo itself put there.
reclaim_link_target() {
  local src_rel="$1"
  local home_abs="$2"
  local harness="$3"
  local src="${repo_root}/${src_rel}"

  remove_repo_symlink "${home_abs}"

  if [[ -e "${home_abs}" && ! -L "${home_abs}" ]] && content_matches_repo_source "${src}" "${home_abs}"; then
    # Defense-in-depth: content_matches_repo_source already guards against deleting user/native
    # content (any byte divergence returns false), but a manifest-row bug could still point home_abs
    # somewhere unexpected. Assert it resolves under a harness home before the rm -rf ever runs.
    assert_under_harness_home "${home_abs}"
    if [[ "${dry_run}" -eq 1 ]]; then
      echo "remove (repo copy): ${home_abs}"
    else
      rm -rf "${home_abs}"
      echo "remove (repo copy): ${home_abs}"
    fi
  fi

  restore_pre_install_link_backup "${home_abs}" "${harness}"
}

# Reclaim a rendered_rules target (CLAUDE.md / AGENTS.md):
#   1) Remove any legacy repo symlink (pre-Phase-3 install).
#   2) Remove only Roborepo managed blocks from normal files.
#   3) For legacy whole-file rendered output, remove the file and restore the user's pre-install
#      backup if one was saved.
reclaim_rendered_rules_target() {
  local home_abs="$1"
  local harness="$2"

  remove_repo_symlink "${home_abs}"

  if [[ -e "${home_abs}" && ! -L "${home_abs}" ]]; then
    if grep -Eq "BEGIN managed:roborepo-code-style|BEGIN managed:roborepo-agents-import" "${home_abs}" 2>/dev/null; then
      if command -v node >/dev/null 2>&1; then
        if [[ "${dry_run}" -eq 1 ]]; then
          node "${repo_root}/scripts/cli/rules-render.mjs" --remove-managed --dry-run "${harness}"
        else
          node "${repo_root}/scripts/cli/rules-render.mjs" --remove-managed "${harness}"
        fi
      else
        echo "skip: cannot remove managed rules blocks without node: ${home_abs}" >&2
      fi
      return 0
    fi

    if is_roborepo_authored "${home_abs}"; then
      if [[ "${dry_run}" -eq 1 ]]; then
        echo "remove (rendered_rules): ${home_abs}"
      else
        rm -f "${home_abs}"
        echo "remove (rendered_rules): ${home_abs}"
      fi
    fi
  fi

  restore_pre_install_link_backup "${home_abs}" "${harness}"
}

# Path to the repo's bare starter for a harness's root_config file, or empty if none exists. The
# starter is the clean baseline (no roborepo hooks/MCP/perms) we fall back to when the user had no
# config of their own before install — so uninstall leaves a working, roborepo-free file instead of
# deleting it outright.
starter_for_root_config() {
  local home_abs="$1"
  local base; base="$(basename "${home_abs}")"
  case "${base}" in
    settings.json) echo "${repo_root}/globals/harnesses/claude/settings.starter.json" ;;
    config.toml)   echo "${repo_root}/globals/harnesses/codex/config.starter.toml" ;;
    *)             echo "" ;;
  esac
}

remove_root_config() {
  local home_abs="$1"
  local harness="${2:-}"
  local src_rel="${3:-}"
  [[ -f "${home_abs}" ]] || return 0

  # Drift gate (docs/plans/completed/root-config-layered-inheritance.md, "Uninstall"): a root_config file is
  # mutable and may have been hand-edited or written by a native harness flow after roborepo's own
  # last write. If the recorded sidecar hash no longer matches on-disk content, the file has drifted
  # and we do not know which parts are safe to touch — leave it in place and report the path rather
  # than deleting user-modified content (even though is_roborepo_authored below would still match the
  # roborepo markers the user's edit sits on top of). Only "clean"/"unwritten"/"missing" fall
  # through to the content-based removal logic; "unwritten" preserves backward compatibility with
  # installs that predate the sidecar (removal then relies on is_roborepo_authored/content match).
  if [[ -n "${harness}" ]] && [[ "$(root_config_drift_status "${harness}" "${home_abs}")" == "drifted" ]]; then
    echo "skip drifted root_config (edited since roborepo last wrote it): ${home_abs}"
    return 0
  fi

  local pre_install_backup=""
  if [[ -n "${harness}" ]]; then
    pre_install_backup="${HOME}/.roborepo/backups/pre-install/${harness}/$(basename "${home_abs}")"
  fi

  if [[ -n "${pre_install_backup}" && -f "${pre_install_backup}" ]]; then
    # User had their own config before install — restore it verbatim.
    if [[ "${dry_run}" -eq 1 ]]; then
      echo "restore (root_config): ${pre_install_backup} -> ${home_abs}"
    else
      mv "${pre_install_backup}" "${home_abs}"
      echo "restore (root_config): ${pre_install_backup} -> ${home_abs}"
    fi
    return 0
  fi

  local starter; starter="$(starter_for_root_config "${home_abs}")"
  local remove_config=0
  if is_roborepo_authored "${home_abs}"; then
    remove_config=1
  elif [[ -n "${src_rel}" ]] && content_matches_repo_source "${repo_root}/${src_rel}" "${home_abs}"; then
    remove_config=1
  elif [[ -n "${starter}" && -f "${starter}" ]] && content_matches_repo_source "${starter}" "${home_abs}"; then
    remove_config=1
  fi

  if [[ "${remove_config}" -eq 1 ]]; then
    # No pre-install backup means roborepo created this root config on a clean machine. Remove it
    # instead of resetting to a starter so uninstall leaves no roborepo-authored file behind.
    if [[ "${dry_run}" -eq 1 ]]; then
      echo "remove (root_config): ${home_abs}"
    else
      rm -f "${home_abs}"
      echo "remove (root_config): ${home_abs}"
    fi
    return 0
  fi

  echo "skip user-owned root_config: ${home_abs}"
}

# Delegates to the Claude provider's mcp.remove adapter (scripts/harnesses/claude/index.mjs),
# ported from this function's own former inline bash+node — see
# scripts/test/harness-mcp-remove-characterization-check.mjs for the pinned behavior. Codex has no
# mcp.remove adapter yet (asymmetric: Codex stores MCP servers in config.toml
# [mcp_servers.*] tables, not migrated to a provider adapter as of this Phase 4 pass), so this
# stays Claude-only, matching the original function.
remove_mcp_servers() {
  command -v node >/dev/null 2>&1 || return 0
  local dry_run_flag="false"
  [[ "${dry_run}" -eq 1 ]] && dry_run_flag="true"
  HOME_DIR="${HOME}" DRY_RUN="${dry_run_flag}" node -e '
import(process.argv[1] + "/scripts/harnesses/claude/index.mjs").then(async ({ claudeProvider }) => {
  const result = claudeProvider.adapters.mcp.remove({
    homePath: process.env.HOME_DIR + "/.claude",
    dryRun: process.env.DRY_RUN === "true",
  });
  for (const warning of result.warnings) console.log("mcp remove: " + warning);
  for (const path of result.paths) console.log("mcp prune (" + path + "): pruned");
  if (!result.ok) process.exit(1);
}).catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
' "${repo_root}" || true
}

# Strip package-injected hooks and permissions from ~/.claude/settings.json after the backup
# restore/reset above. Packages (jcodemunch, jdocmunch, …) merge hooks directly into settings.json
# via mergeHooks; remove_root_config restores the pre-install backup verbatim, which can contain
# those hooks from a previous install cycle ("poisoned backup"). This pass removes whatever the
# package enablers put in, leaving only the user's genuine pre-roborepo content.
#
# Delegates to the Claude provider's hooks.write adapter (removal semantics — scripts/harnesses/
# claude/index.mjs), ported from this function's own former inline bash+node — see
# scripts/test/harness-hooks-write-remove-characterization-check.mjs for the pinned behavior.
# Claude-only: hooks.write has no Codex implementation (Codex hooks live in a separate hooks.json
# sidecar, not migrated to a provider adapter as of this Phase 4 pass).
strip_package_hooks() {
  local settings="${HOME}/.claude/settings.json"
  [[ -f "${settings}" ]] || return 0
  command -v node >/dev/null 2>&1 || return 0

  local dry_run_flag="false"
  [[ "${dry_run}" -eq 1 ]] && dry_run_flag="true"
  HOME_DIR="${HOME}" DRY_RUN="${dry_run_flag}" node -e '
import(process.argv[1] + "/scripts/harnesses/claude/index.mjs").then(async ({ claudeProvider }) => {
  const result = claudeProvider.adapters.hooks.write({
    homePath: process.env.HOME_DIR + "/.claude",
    dryRun: process.env.DRY_RUN === "true",
  });
  for (const warning of result.warnings) console.log("strip: " + warning);
  if (result.changed) console.log("strip: removed package hooks/permissions from " + result.paths[0]);
  if (!result.ok) process.exit(1);
}).catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
' "${repo_root}" || true
}

# Reverse install-gitignore-globals.sh: drop the .jdm-indexed entry it appended to
# ~/.gitignore_global. Leave git core.excludesfile alone — it may have been the user's own setting,
# and an otherwise-empty global gitignore is harmless.
remove_gitignore_globals() {
  local gitignore_global="${HOME}/.gitignore_global"
  [[ -f "${gitignore_global}" ]] || return 0
  grep -Fqx ".jdm-indexed" "${gitignore_global}" || return 0

  if [[ "${dry_run}" -eq 1 ]]; then
    echo "prune: would remove .jdm-indexed from ${gitignore_global}"
    return 0
  fi

  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/roborepo-gitignore.XXXXXX")"
  # grep -v exits 1 when nothing remains (".jdm-indexed" was the only line); that is success here —
  # the resulting empty global gitignore is harmless (see header) — so don't let set -e abort.
  grep -Fvx ".jdm-indexed" "${gitignore_global}" > "${tmp}" || true
  mv "${tmp}" "${gitignore_global}"
  echo "prune: removed .jdm-indexed from ${gitignore_global}"
}

remove_install_backups() {
  local dir file home_path
  while IFS=$'\t' read -r _id home_path _present _display_name _root_config_path; do
    [[ -z "${home_path}" ]] && continue
    dir="${home_path}"
    [[ -d "${dir}" ]] || continue
    for file in "${dir}"/*_original_*; do
      [[ -e "${file}" ]] || continue
      if [[ "${dry_run}" -eq 1 ]]; then
        echo "remove (backup): ${file}"
      else
        rm -rf "${file}"
        echo "remove (backup): ${file}"
      fi
    done
  done < <(harness_detected_rows)

  local pre_install_dir="${HOME}/.roborepo/backups/pre-install"
  if [[ -d "${pre_install_dir}" ]]; then
    if [[ "${dry_run}" -eq 1 ]]; then
      echo "remove (pre-install backups): ${pre_install_dir}/"
    else
      rm -rf "${pre_install_dir}"
      echo "remove (pre-install backups): ${pre_install_dir}/"
    fi
  fi
}

remove_preset_state() {
  local presets_dir
  presets_dir="$(roborepo_state_dir)/presets"
  [[ -d "${presets_dir}" ]] || return 0
  if [[ "${dry_run}" -eq 1 ]]; then
    echo "remove: ${presets_dir}/"
  else
    rm -rf "${presets_dir}"
    echo "remove: ${presets_dir}/"
  fi
}

remove_rules_state() {
  local rules_dir
  rules_dir="$(roborepo_state_dir)/rules"
  [[ -d "${rules_dir}" ]] || return 0
  if [[ "${dry_run}" -eq 1 ]]; then
    echo "remove: ${rules_dir}/"
  else
    rm -rf "${rules_dir}"
    echo "remove: ${rules_dir}/"
  fi
}

remove_path() {
  local path="$1"
  local label="${2:-remove}"
  [[ -e "${path}" || -L "${path}" ]] || return 0
  if [[ "${dry_run}" -eq 1 ]]; then
    echo "${label}: ${path}"
  else
    rm -rf "${path}"
    echo "${label}: ${path}"
  fi
}

remove_empty_dir() {
  local path="$1"
  [[ -d "${path}" ]] || return 0
  if [[ "${dry_run}" -eq 1 ]]; then
    find "${path}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q . || echo "rmdir: ${path}"
  else
    rmdir "${path}" 2>/dev/null && echo "rmdir: ${path}" || true
  fi
}

remove_runtime_state() {
  local state_dir
  state_dir="$(roborepo_state_dir)"

  remove_path "${state_dir}/command-overrides.json" "remove"
  remove_path "${state_dir}/enabled-packages.json" "remove"
  remove_path "${state_dir}/telemetry" "remove"
  remove_path "${state_dir}/telemetry-backups" "remove"
  remove_path "${state_dir}/backups" "remove"
  remove_path "${state_dir}" "remove"

  local pid_path="${ROBOREPO_PORTAL_PID_PATH:-${ROBOREPO_TELEMETRY_PID_PATH:-${HOME}/.local/state/roborepo/portal-server.pid}}"
  local legacy_pid_path="${ROBOREPO_TELEMETRY_PID_PATH:-${HOME}/.local/state/roborepo/telemetry-server.pid}"
  remove_path "${pid_path}" "remove"
  remove_path "${legacy_pid_path}" "remove"
  remove_empty_dir "$(dirname "${pid_path}")"
}

remove_durable_install_backups() {
  remove_path "${HOME}/.roborepo-backups" "remove (install backups)"
}

roborepo_process_pids() {
  local process_root="${ROBOREPO_UNINSTALL_PROCESS_ROOT:-${repo_root}}"
  ps -ax -o pid=,command= 2>/dev/null | awk -v process_root="${process_root}" '
    index($0, process_root "/scripts/cli/main.mjs serve") > 0 ||
    index($0, process_root "/scripts/install/main.sh") > 0 ||
    index($0, process_root "/scripts/cli/main.mjs mcp apply") > 0 ||
    index($0, process_root "/scripts/cli/main.mjs bundle apply --default") > 0 {
      print $1
    }
  '
}

stop_roborepo_processes() {
  local pids=()
  local pid
  local pid_path legacy_pid_path
  pid_path="${ROBOREPO_PORTAL_PID_PATH:-${ROBOREPO_TELEMETRY_PID_PATH:-${HOME}/.local/state/roborepo/portal-server.pid}}"
  legacy_pid_path="${ROBOREPO_TELEMETRY_PID_PATH:-${HOME}/.local/state/roborepo/telemetry-server.pid}"
  for path in "${pid_path}" "${legacy_pid_path}"; do
    if [[ -f "${path}" ]]; then
      pid="$(tr -cd '0-9' < "${path}" 2>/dev/null || true)"
      [[ -n "${pid}" && "${pid}" != "$$" ]] && pids+=("${pid}")
    fi
  done
  while IFS= read -r pid; do
    [[ -n "${pid}" && "${pid}" != "$$" ]] && pids+=("${pid}")
  done < <(roborepo_process_pids || true)
  [[ ${#pids[@]} -gt 0 ]] || return 0

  if [[ "${dry_run}" -eq 1 ]]; then
    echo "stop processes: ${pids[*]}"
    return 0
  fi

  kill "${pids[@]}" 2>/dev/null || true
  sleep 0.2
  local live=()
  for pid in "${pids[@]}"; do
    kill -0 "${pid}" 2>/dev/null && live+=("${pid}") || true
  done
  [[ ${#live[@]} -eq 0 ]] || kill -TERM "${live[@]}" 2>/dev/null || true
  echo "stop processes: ${pids[*]}"
}

check_no_active_remnants() {
  local failed=0 path pid
  local state_dir
  state_dir="$(roborepo_state_dir)"

  for path in \
    "${HOME}/.local/bin/roborepo" \
    "${state_dir}/install-state.json" \
    "${state_dir}/presets" \
    "${state_dir}/rules" \
    "${state_dir}/command-overrides.json" \
    "${state_dir}/enabled-packages.json" \
    "${state_dir}/telemetry" \
    "${state_dir}/telemetry-backups" \
    "${state_dir}/backups" \
    "${state_dir}" \
    "${HOME}/.roborepo-backups" \
    "${ROBOREPO_PORTAL_PID_PATH:-${ROBOREPO_TELEMETRY_PID_PATH:-${HOME}/.local/state/roborepo/portal-server.pid}}" \
    "${ROBOREPO_TELEMETRY_PID_PATH:-${HOME}/.local/state/roborepo/telemetry-server.pid}"; do
    if [[ -e "${path}" || -L "${path}" ]]; then
      echo "remnant: ${path}" >&2
      failed=1
    fi
  done

  while IFS= read -r pid; do
    [[ -n "${pid}" && "${pid}" != "$$" ]] || continue
    echo "remnant process: ${pid}" >&2
    failed=1
  done < <(roborepo_process_pids || true)

  if [[ -f "${HOME}/.gitignore_global" ]] && grep -Fqx ".jdm-indexed" "${HOME}/.gitignore_global"; then
    echo "remnant: ${HOME}/.gitignore_global contains .jdm-indexed" >&2
    failed=1
  fi

  local profile line
  line='export PATH="${HOME}/.local/bin:${PATH}"'
  for profile in "${HOME}/.zshrc" "${HOME}/.bashrc" "${HOME}/.bash_profile" "${HOME}/.profile"; do
    [[ -f "${profile}" ]] || continue
    if grep -Fq "${repo_root}/shell/" "${profile}" || grep -Fqx "${line}" "${profile}"; then
      echo "remnant: ${profile} contains roborepo shell wiring" >&2
      failed=1
    fi
  done

  while IFS=$'\t' read -r _h kind src_rel home_abs _flags; do
    case "${kind}" in
      managed_copy|link)
        if [[ -L "${home_abs}" ]] && is_managed_link "${home_abs}"; then
          echo "remnant: ${home_abs}" >&2
          failed=1
        elif [[ "${src_rel}" != "-" && -e "${home_abs}" && ! -L "${home_abs}" ]] \
          && content_matches_repo_source "${repo_root}/${src_rel}" "${home_abs}"; then
          echo "remnant: ${home_abs}" >&2
          failed=1
        fi
        ;;
      cleanup)
        if [[ -L "${home_abs}" ]] && is_managed_link "${home_abs}"; then
          echo "remnant: ${home_abs}" >&2
          failed=1
        fi
        ;;
      root_config)
        # A drifted root_config is left in place on purpose by remove_root_config (the user edited
        # it after roborepo's last write), so it is NOT a remnant even though is_roborepo_authored
        # still matches the markers underneath the edit. Only a "clean" authored file — roborepo's
        # own untouched write that removal should have deleted — counts. Post-uninstall the sidecar
        # is already gone, so drift reports "unwritten" for the deliberately-kept file and it is
        # correctly not flagged; the standalone --check-clean run (sidecar present) still catches a
        # genuinely-clean leftover.
        if is_roborepo_authored "${home_abs}" \
          && [[ "$(root_config_drift_status "${_h}" "${home_abs}")" == "clean" ]]; then
          echo "remnant: ${home_abs} contains roborepo-authored content" >&2
          failed=1
        fi
        ;;
      rendered_rules)
        if is_roborepo_authored "${home_abs}"; then
          echo "remnant: ${home_abs} contains roborepo-authored content" >&2
          failed=1
        fi
        ;;
    esac
  done < <(manifest_rows)

  local skills_home entry home_path
  while IFS=$'\t' read -r _id home_path _present _display_name _root_config_path; do
    [[ -z "${home_path}" ]] && continue
    skills_home="${home_path}/skills"
    [[ -d "${skills_home}" ]] || continue
    for entry in "${skills_home}"/*; do
      [[ -e "${entry}" || -L "${entry}" ]] || continue
      if [[ -e "${entry}/.roborepo-managed" ]] || is_roborepo_skill_link "${entry}"; then
        echo "remnant: ${entry}" >&2
        failed=1
      fi
    done
  done < <(harness_detected_rows)

  if [[ "${failed}" -eq 0 ]]; then
    echo "ok: no active roborepo remnants"
  fi
  return "${failed}"
}

# Per-skill global skill links: not in manifest, so manifest_rows won't remove them.
is_roborepo_skill_link() {
  local link="$1"
  local target
  [[ -L "${link}" ]] || return 1
  target="$(readlink "${link}")"
  # Current or recorded-prior checkout. globals/agents/skills is the pre-migration path (kept here
  # so uninstall can still reclaim links from an install predating the system/package/generated split).
  case "${target}" in
    "${repo_root}"/globals/system/skills/*|"${repo_root}"/globals/agents/skills/*) return 0 ;;
  esac
  if [[ -n "${recorded_repo}" ]]; then
    case "${target}" in
      "${recorded_repo}"/globals/system/skills/*|"${recorded_repo}"/globals/agents/skills/*) return 0 ;;
    esac
  fi
  case "${target}" in
    */.roborepo/skills/*) return 0 ;;
  esac
  # Dangling link that points into globals/system/skills/, the legacy globals/agents/skills/, or
  # ~/.roborepo/skills/ of any roborepo checkout / install.
  if [[ ! -e "${link}" ]]; then
    case "${target}" in
      */globals/system/skills/*|*/globals/agents/skills/*|*/.roborepo/skills/*) return 0 ;;
    esac
  fi
  return 1
}

# Remove roborepo-managed skills: cache entries carrying the '.roborepo-managed' marker, plus
# symlinks that point into the roborepo-managed cache or legacy repo source. Never touches a
# user's native skill (a real dir without the marker).
remove_skill_links() {
  local skills_home="$1"
  [[ -d "${skills_home}" ]] || return 0
  local entry
  for entry in "${skills_home}"/*; do
    if [[ -L "${entry}" ]]; then
      if is_roborepo_skill_link "${entry}"; then
        if [[ "${dry_run}" -eq 1 ]]; then
          echo "remove: ${entry}"
        else
          rm -f "${entry}"
          echo "remove: ${entry}"
        fi
      fi
    elif [[ -e "${entry}/.roborepo-managed" ]]; then
      if [[ "${dry_run}" -eq 1 ]]; then
        echo "remove: ${entry}"
      else
        rm -rf "${entry}"
        echo "remove: ${entry}"
      fi
    fi
  done
}

remove_shell_wiring() {
  local profile line tmp
  line='export PATH="${HOME}/.local/bin:${PATH}"'

  for profile in "${HOME}/.zshrc" "${HOME}/.bashrc" "${HOME}/.bash_profile" "${HOME}/.profile"; do
    [[ -f "${profile}" ]] || continue
    if grep -Fq "${repo_root}/shell/" "${profile}" || grep -Fqx "${line}" "${profile}"; then
      if [[ "${dry_run}" -eq 1 ]]; then
        echo "prune: would remove roborepo shell wiring from ${profile}"
        continue
      fi
      tmp="$(mktemp "${TMPDIR:-/tmp}/roborepo-profile.XXXXXX")"
      # Drop roborepo wiring lines and their marker comments. Both marker strings are written
      # verbatim by the installer (shell-snippets.sh -> "# Harness config shell helpers" before
      # its `source` lines; install-global-commands.sh -> "# Harness config global commands"
      # before the PATH export) and are removed unconditionally — a user is not expected to have
      # authored these exact strings. Dropping the marker regardless of what follows also cleans
      # up comments orphaned by earlier uninstall runs that pruned the wiring line but not the
      # marker. Blank lines elsewhere in the profile are left untouched.
      awk -v repo_root="${repo_root}" -v path_line="${line}" '
        $0 == path_line { next }
        index($0, "source \"" repo_root "/shell/") == 1 { next }
        $0 == "# Harness config shell helpers" { next }
        $0 == "# Harness config global commands" { next }
        { print }
      ' "${profile}" > "${tmp}"
      mv "${tmp}" "${profile}"
      echo "prune: removed roborepo shell wiring from ${profile}"
    fi
  done
}

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dry_run=0
skip_presets_onboard=0
agent_permission_profile="${ROBOREPO_AGENT_PERMISSION_PROFILE:-${ROBOREPO_CODEX_PERMISSION_PROFILE:-}}"
install_mode="${ROBOREPO_INSTALL_MODE:-}"
on_conflict="${ROBOREPO_ON_CONFLICT:-}"
on_conflict_explicit=0
on_conflict_persisted=0
[[ -n "${on_conflict}" ]] && on_conflict_explicit=1
backup_root="${ROBOREPO_BACKUP_ROOT:-${HOME}/.roborepo-backups/$(date +%Y%m%d-%H%M%S)}"
export ROBOREPO_BACKUP_ROOT="${backup_root}"
export ROBOREPO_INSTALL_TIMESTAMP="${ROBOREPO_INSTALL_TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      dry_run=1
      shift
      ;;
    --no-presets-onboard)
      skip_presets_onboard=1
      shift
      ;;
    --permissions|--agent-permissions|--codex-permissions)
      [[ $# -ge 2 ]] || { echo "usage: $0 [--dry-run] [--no-presets-onboard] [--mode managed|adopt] [--on-conflict overwrite|keep|abort] [--permissions <profile>]" >&2; exit 2; }
      agent_permission_profile="$2"
      shift 2
      ;;
    --permissions=*|--agent-permissions=*)
      agent_permission_profile="${1#*=}"
      shift
      ;;
    --codex-permissions=*)
      agent_permission_profile="${1#*=}"
      shift
      ;;
    --mode)
      [[ $# -ge 2 ]] || { echo "usage: $0 [--dry-run] [--no-presets-onboard] [--mode managed|adopt] [--on-conflict overwrite|keep|abort] [--permissions <profile>]" >&2; exit 2; }
      install_mode="$2"
      shift 2
      ;;
    --mode=*)
      install_mode="${1#*=}"
      shift
      ;;
    --on-conflict)
      [[ $# -ge 2 ]] || { echo "usage: $0 [--dry-run] [--no-presets-onboard] [--mode managed|adopt] [--on-conflict overwrite|keep|abort] [--permissions <profile>]" >&2; exit 2; }
      on_conflict="$2"
      on_conflict_explicit=1
      shift 2
      ;;
    --on-conflict=*)
      on_conflict="${1#*=}"
      on_conflict_explicit=1
      shift
      ;;
    *)
      echo "usage: $0 [--dry-run] [--no-presets-onboard] [--mode managed|adopt] [--on-conflict overwrite|keep|abort] [--permissions <profile>]" >&2
      exit 2
      ;;
  esac
done

case "${install_mode}" in
  "" ) ;;
  managed|adopt) ;;
  *) echo "usage: $0 [--dry-run] [--no-presets-onboard] [--mode managed|adopt] [--on-conflict overwrite|keep|abort] [--permissions <profile>]" >&2; exit 2 ;;
esac

case "${on_conflict}" in
  "" ) ;;
  overwrite|keep|abort) ;;
  *) echo "usage: $0 [--dry-run] [--no-presets-onboard] [--mode managed|adopt] [--on-conflict overwrite|keep|abort] [--permissions <profile>]" >&2; exit 2 ;;
esac
export ROBOREPO_ON_CONFLICT="${on_conflict}"

dry_args=()
[[ $dry_run -eq 1 ]] && dry_args=(--dry-run)

# shellcheck source=scripts/install/install-lib.sh
source "${repo_root}/scripts/install/install-lib.sh"
# shellcheck source=scripts/install/state-lib.sh
source "${repo_root}/scripts/install/state-lib.sh"
# shellcheck source=scripts/lib/manifests-data.sh
source "${repo_root}/scripts/lib/manifests-data.sh"  # provides manifest_rows

choose_install_mode() {
  local choice

  if [[ -n "${install_mode}" ]]; then
    return 0
  fi

  if ! stdin_is_interactive; then
    install_mode="$(read_install_mode 2>/dev/null || true)"
    install_mode="${install_mode:-managed}"
    return 0
  fi

  while true; do
    echo ""
    echo "Choose install mode:"
    echo "  1) managed  backup any existing config first; install repo defaults"
    echo "  2) adopt    keep local root config active; install repo defaults around it"
    echo "  q) quit"
    printf "Selection [1/2/q]: "
    if ! read -r choice; then
      install_mode="managed"
      return 0
    fi

    case "${choice}" in
      1|managed)
        install_mode="managed"
        return 0
        ;;
      2|adopt)
        install_mode="adopt"
        return 0
        ;;
      q|Q|quit|exit)
        echo "install canceled by user" >&2
        exit 1
        ;;
      *)
        echo "Invalid selection."
        ;;
    esac
  done
}

choose_install_mode

if [[ -z "${install_mode}" ]]; then
  install_mode="$(read_install_mode 2>/dev/null || true)"
fi
install_mode="${install_mode:-managed}"

choose_adopt_conflict_policy() {
  local choice

  if [[ "${install_mode}" == "managed" ]]; then
    if [[ -z "${on_conflict}" ]]; then
      on_conflict="$(read_install_on_conflict 2>/dev/null || true)"
      if [[ -n "${on_conflict}" ]]; then
        on_conflict_persisted=1
      else
        on_conflict="overwrite"
      fi
    fi
    on_conflict="overwrite"
    return 0
  fi

  if [[ -n "${on_conflict}" ]]; then
    return 0
  fi

  on_conflict="$(read_install_on_conflict 2>/dev/null || true)"
  if [[ -n "${on_conflict}" ]]; then
    on_conflict_persisted=1
    return 0
  fi

  if ! stdin_is_interactive; then
    on_conflict="keep"
    return 0
  fi

  while true; do
    echo ""
    echo "Choose adopt collision behavior:"
    echo "  1) overwrite      backup existing files as *_original_TIMESTAMP; install repo items"
    echo "  2) keep originals leave existing files active; stage repo items as *_update_TIMESTAMP"
    echo "  q) quit"
    printf "Selection [1/2/q]: "
    if ! read -r choice; then
      on_conflict="keep"
      return 0
    fi

    case "${choice}" in
      1|overwrite)
        on_conflict="overwrite"
        return 0
        ;;
      2|keep|original|originals)
        on_conflict="keep"
        return 0
        ;;
      q|Q|quit|exit)
        echo "install canceled by user" >&2
        exit 1
        ;;
      *)
        echo "Invalid selection."
        ;;
    esac
  done
}

choose_adopt_conflict_policy
export ROBOREPO_INSTALL_MODE="${install_mode}"
export ROBOREPO_ON_CONFLICT="${on_conflict}"

run_with_dry_args() {
  if [[ $dry_run -eq 1 ]]; then
    "$1" --dry-run
  else
    "$1"
  fi
}

# Windows: delegate to PowerShell installer, then continue for bash-specific steps
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*)
    echo "Windows + bash detected (Git Bash or similar)."
    if command -v powershell.exe &>/dev/null; then
      echo "Running PowerShell installer..."
      ps_args=(-ExecutionPolicy Bypass -File "${repo_root}/scripts/install/install-windows.ps1")
      [[ $dry_run -eq 1 ]] && ps_args+=(-DryRun)
      powershell.exe "${ps_args[@]}"
    else
      echo "powershell.exe not found. Run scripts/install/install-windows.ps1 from PowerShell manually."
    fi
    # Shell snippets and global commands still need bash — continue below
    run_with_dry_args "${repo_root}/scripts/install/install-gitignore-globals.sh"
    if [[ $dry_run -eq 0 ]]; then
      "${repo_root}/scripts/install/install-global-commands.sh"
      "${repo_root}/scripts/install/install-shell-snippets.sh"
    fi
    exit 0
    ;;
esac

# Detect which harnesses are present.
has_claude=0
has_codex=0
harness_present claude && has_claude=1
harness_present codex && has_codex=1

if [[ -n "${agent_permission_profile}" ]]; then
  if [[ $dry_run -eq 1 ]]; then
    if node "${repo_root}/scripts/build/render-agent-permissions.mjs" --check --profile "${agent_permission_profile}" >/dev/null; then
      echo "ok: agent permission profile ${agent_permission_profile} already rendered"
    else
      echo "dry-run: would render agent permission profile ${agent_permission_profile}"
    fi
  else
    node "${repo_root}/scripts/build/render-agent-permissions.mjs" --profile "${agent_permission_profile}"
  fi
fi

preflight_shell_setup() {
  "${repo_root}/scripts/install/install-global-commands.sh" --dry-run
  "${repo_root}/scripts/install/install-shell-snippets.sh" --dry-run
}

check_clean_target() {
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

  echo "conflict: ${home_path} already exists and is not managed by this repo." >&2
  echo "  repo source: ${src}" >&2
  echo "Merge review prompt:" >&2
  echo "  Default stance: preserve the existing local path as source of truth unless you can prove a repo change can be added without breaking local behavior." >&2
  echo "  Required first step: compute your own complete comparison of both paths. Do not rely on this prompt as an exhaustive conflict summary." >&2
  echo "  For directories, inspect the full recursive file list and content diffs. For structured files, parse the format when possible." >&2
  echo "  Add repo-only harness behavior only when it does not conflict with local behavior. Flag conflicts instead of guessing." >&2
  return 1
}

# Preflight every managed link target (from manifests/platform/manifest.tsv) for the present harnesses.
# Claude uses the claude rows; Codex uses the codex rows.
# root_config and cleanup rows are not preflighted here — root config is mutable user state.
preflight_clean_targets() {
  local conflict=0
  local _h kind src_rel home_abs _flags

  preflight_harness() {
    while IFS=$'\t' read -r _h kind src_rel home_abs _flags; do
      [[ "${kind}" == "link" ]] || continue
      check_clean_target "${src_rel}" "${home_abs}" || conflict=1
    done < <(manifest_rows "$1")
  }

  [[ $has_claude -eq 1 ]] && preflight_harness claude
  [[ $has_codex  -eq 1 ]] && preflight_harness codex

  if [[ $conflict -eq 1 ]]; then
    echo "Install has non-root config conflicts. No files were changed." >&2
    echo "Use the merge prompt above, or merge/move these paths before re-running." >&2
    exit 1
  fi
}

preflight_unattended_conflicts() {
  [[ "${dry_run}" -eq 0 ]] || return 0
  [[ "${on_conflict_explicit}" -eq 1 || "${on_conflict_persisted}" -eq 1 ]] && return 0
  stdin_is_interactive && return 0

  local conflict=0
  local _h kind src_rel home_abs _flags src current
  preflight_harness_conflicts() {
    while IFS=$'\t' read -r _h kind src_rel home_abs _flags; do
      case "${kind}" in
        root_config|link) ;;
        *) continue ;;
      esac
      src="${repo_root}/${src_rel}"
      [[ ! -e "${home_abs}" && ! -L "${home_abs}" ]] && continue
      if [[ "${kind}" == "link" && "${install_mode}" == "managed" && -L "${home_abs}" ]]; then
        current="$(readlink "${home_abs}")"
        [[ "${current}" == "${src}" || "${current}" == "${repo_root}"/* ]] && continue
      fi
      if [[ "${kind}" == "root_config" && -L "${home_abs}" ]]; then
        current="$(readlink "${home_abs}")"
        [[ "${current}" == "${src}" || "${current}" == "${repo_root}"/* ]] && continue
      fi
      if paths_equivalent_for_copy "${src}" "${home_abs}"; then
        continue
      fi
      echo "error: ${home_abs} exists and stdin is not interactive." >&2
      conflict=1
    done < <(manifest_rows "$1")
  }

  [[ $has_claude -eq 1 ]] && preflight_harness_conflicts claude
  [[ $has_codex  -eq 1 ]] && preflight_harness_conflicts codex
  if [[ "${conflict}" -eq 1 ]]; then
    echo "Run interactively, pass --on-conflict overwrite|keep, or use --dry-run to inspect collisions." >&2
    exit 1
  fi
}

preflight_shell_setup

# Harness-agnostic setup
run_with_dry_args "${repo_root}/scripts/install/install-gitignore-globals.sh"

# Shell and PATH setup (harness-agnostic, bash only)
if [[ $dry_run -eq 0 ]]; then
  "${repo_root}/scripts/install/install-global-commands.sh"
  "${repo_root}/scripts/install/install-shell-snippets.sh"
fi

write_install_state "${install_mode}" "${on_conflict}"

# Link shared skills per-skill into each present harness's native skills dir.
if [[ $dry_run -eq 0 ]]; then
  bash "${repo_root}/scripts/build/link-global-skills.sh" || true
fi

# Re-apply Claude MCP live store from mcp-servers.json so the recorded set is portable.
# (Codex reads config.toml directly from the repo; only Claude's live store needs reapplication.)
if [[ $dry_run -eq 0 ]] && command -v node >/dev/null 2>&1; then
  node "${repo_root}/scripts/cli/main.mjs" mcp apply || true
fi

presets_onboarded() {
  node -e '
const fs = require("fs");
try {
  const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.exit(state?.onboardedAt ? 0 : 1);
} catch {
  process.exit(1);
}
' "$(roborepo_state_dir)/presets/state.json"
}

# Onboarding wizard is disabled (in-progress feature). Install applies the default bundles headlessly
# instead of launching the interactive `roborepo onboard` UI. The original UI-launching version is
# recorded in docs/plans/onboarding-reinstatement.md.
run_post_install_onboarding() {
  if [[ $dry_run -eq 1 ]]; then
    echo "Next: install will apply the default configuration after core install."
    return 0
  fi

  if presets_onboarded; then
    echo "Default configuration already applied."
    return 0
  fi

  echo "Applying default configuration."
  echo ""
  # `onboard` now headlessly applies the default bundles and records onboarding state (no UI).
  node "${repo_root}/scripts/cli/main.mjs" onboard
}

# Post-install summary
echo ""
echo "Core install complete."
echo "  Mode:   ${install_mode}"
echo "  Claude: $([ $has_claude -eq 1 ] && echo 'available' || echo 'not installed')"
echo "  Codex:  $([ $has_codex  -eq 1 ] && echo 'available' || echo 'not installed')"
echo ""
run_post_install_onboarding
if [[ $has_claude -eq 0 || $has_codex -eq 0 ]]; then
  echo ""
  echo "To add another harness later: install it, then run roborepo onboard again."
fi

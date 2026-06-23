#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dry_run=0

case "${1:-}" in
  --dry-run) dry_run=1 ;;
  "") ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

# shellcheck source=scripts/lib/manifests-data.sh
source "${repo_root}/scripts/lib/manifests-data.sh"
# shellcheck source=scripts/install/state-lib.sh
source "${repo_root}/scripts/install/state-lib.sh"

# The checkout that performed the last install, recorded in install-state.json. May differ
# from repo_root if the checkout was moved/renamed since install; used so uninstall can still
# reclaim links left by that prior path. Empty if no state file.
recorded_repo="$(read_install_repo 2>/dev/null || true)"

# True if a symlink at ${path} is one this repo manages: it targets the current repo_root,
# the recorded prior checkout, or is dangling (target gone — a stale prior-checkout link).
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

# Path to the repo's bare starter for a harness's root_config file, or empty if none exists. The
# starter is the clean baseline (no roborepo hooks/MCP/perms) we fall back to when the user had no
# config of their own before install — so uninstall leaves a working, roborepo-free file instead of
# deleting it outright.
starter_for_root_config() {
  local home_abs="$1"
  local base; base="$(basename "${home_abs}")"
  case "${base}" in
    settings.json) echo "${repo_root}/globals/claude/settings.starter.json" ;;
    config.toml)   echo "${repo_root}/globals/codex/config.starter.toml" ;;
    *)             echo "" ;;
  esac
}

remove_root_config() {
  local home_abs="$1"
  local harness="${2:-}"
  [[ -f "${home_abs}" ]] || return 0

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
  if [[ -n "${starter}" && -f "${starter}" ]]; then
    # No pre-install backup (clean machine, or backup already consumed) — reset to the bare starter
    # rather than deleting, so the harness keeps a clean roborepo-free config.
    if [[ "${dry_run}" -eq 1 ]]; then
      echo "reset (root_config): ${starter} -> ${home_abs}"
    else
      cp "${starter}" "${home_abs}"
      echo "reset (root_config): ${starter} -> ${home_abs}"
    fi
    return 0
  fi

  # No backup and no starter — remove the roborepo-installed file.
  if [[ "${dry_run}" -eq 1 ]]; then
    echo "remove (root_config): ${home_abs}"
  else
    rm "${home_abs}"
    echo "remove (root_config): ${home_abs}"
  fi
}

remove_mcp_servers() {
  local mcp_file="${repo_root}/manifests/inventory/mcp-servers.json"
  [[ -f "${mcp_file}" ]] || return 0

  local names=()
  while IFS= read -r name; do
    [[ -n "${name}" ]] && names+=("${name}")
  done < <(node -e "
const d = JSON.parse(require('fs').readFileSync('${mcp_file}', 'utf8'));
d.servers.filter(s => s.harnesses.includes('claude')).forEach(s => console.log(s.name));
")
  [[ ${#names[@]} -gt 0 ]] || return 0

  # `claude mcp add` registers at a chosen scope (default `user`); `claude mcp remove` without
  # --scope only checks the default (`local`), so a single remove leaks the other scopes. Remove from
  # every scope via the CLI when available, then prune ~/.claude.json directly as a fallback so the
  # entry is gone even when the `claude` binary isn't present.
  local name scope
  if command -v claude >/dev/null 2>&1; then
    for name in "${names[@]}"; do
      if [[ "${dry_run}" -eq 1 ]]; then
        echo "mcp remove (claude, all scopes): ${name}"
      else
        for scope in user local project; do
          claude mcp remove "${name}" --scope "${scope}" >/dev/null 2>&1 || true
        done
        echo "mcp remove (claude, all scopes): ${name}"
      fi
    done
  fi

  # Direct prune of ~/.claude.json: top-level mcpServers and every project-scoped mcpServers map.
  local claude_json="${HOME}/.claude.json"
  [[ -f "${claude_json}" ]] || return 0
  if [[ "${dry_run}" -eq 1 ]]; then
    echo "mcp prune (~/.claude.json): ${names[*]}"
    return 0
  fi
  ROBOREPO_MCP_NAMES="${names[*]}" node -e '
const fs = require("fs");
const file = process.env.HOME + "/.claude.json";
const names = new Set((process.env.ROBOREPO_MCP_NAMES || "").split(" ").filter(Boolean));
let d;
try { d = JSON.parse(fs.readFileSync(file, "utf8")); } catch { process.exit(0); }
let changed = false;
const prune = (m) => { if (!m) return; for (const n of names) if (n in m) { delete m[n]; changed = true; } };
prune(d.mcpServers);
for (const p of Object.values(d.projects || {})) prune(p.mcpServers);
if (changed) fs.writeFileSync(file, JSON.stringify(d, null, 2) + "\n");
' && echo "mcp prune (~/.claude.json): ${names[*]}" || true
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
  grep -Fvx ".jdm-indexed" "${gitignore_global}" > "${tmp}"
  mv "${tmp}" "${gitignore_global}"
  echo "prune: removed .jdm-indexed from ${gitignore_global}"
}

remove_install_backups() {
  local dir file
  for dir in "${HOME}/.claude" "${HOME}/.codex"; do
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
  done

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

while IFS=$'\t' read -r _h kind _src_rel home_abs _flags; do
  case "${kind}" in
    link|cleanup)   remove_repo_symlink "${home_abs}" ;;
    root_config)    remove_root_config  "${home_abs}" "${_h}" ;;
  esac
done < <(manifest_rows)

# Per-skill global skill links: not in manifest, so manifest_rows won't remove them.
is_roborepo_skill_link() {
  local link="$1"
  local target
  [[ -L "${link}" ]] || return 1
  target="$(readlink "${link}")"
  # Current or recorded-prior checkout
  case "${target}" in
    "${repo_root}"/globals/agents/skills/*) return 0 ;;
  esac
  if [[ -n "${recorded_repo}" ]]; then
    case "${target}" in
      "${recorded_repo}"/globals/agents/skills/*) return 0 ;;
    esac
  fi
  # Dangling link that points into globals/agents/skills/ of any roborepo checkout
  if [[ ! -e "${link}" ]]; then
    case "${target}" in
      */globals/agents/skills/*) return 0 ;;
    esac
  fi
  return 1
}

remove_skill_links() {
  local skills_home="$1"
  [[ -d "${skills_home}" ]] || return 0
  local link
  for link in "${skills_home}"/*; do
    is_roborepo_skill_link "${link}" && remove_repo_symlink "${link}" || true
  done
}
remove_skill_links "${HOME}/.claude/skills"
remove_skill_links "${HOME}/.codex/skills"

remove_file_if_repo_symlink "${HOME}/.local/bin/roborepo" "${repo_root}/bin/roborepo"
remove_shell_wiring

state_file="$(roborepo_state_file)"
if [[ -f "${state_file}" ]]; then
  if [[ "${dry_run}" -eq 1 ]]; then
    echo "remove: ${state_file}"
  else
    rm "${state_file}"
    echo "remove: ${state_file}"
  fi
fi

remove_mcp_servers
remove_gitignore_globals
remove_preset_state
remove_install_backups

echo "Uninstall complete."

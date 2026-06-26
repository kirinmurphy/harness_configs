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

# Detect roborepo-authored files: root_config markers (hooks/write-guard/perms), the rendered_rules
# header ("# Generated Harness Rules"), and package hook signatures (jcmwatch = jcodemunch,
# jdm-indexed = jdocmunch). The package signatures prevent a poisoned pre-install backup: after a
# partial uninstall the settings.json can hold package hooks without the main roborepo markers, and
# without these extra patterns it would be captured as the user's "original" on the next install.
# Mirrors install-lib.sh is_roborepo_authored — keep both in sync.
is_roborepo_authored() {
  local file="$1"
  [[ -f "${file}" ]] || return 1
  grep -Eq "roborepo telemetry capture|roborepo-write-guard|BEGIN GENERATED AGENT PERMISSIONS|MANAGED_BY_ROBOREPO|# Generated Harness Rules|jcmwatch|jdm-indexed" "${file}" 2>/dev/null
}

# True when ${dest} is a REAL (non-symlink) file or dir whose content is byte-for-byte identical to
# repo source ${src}: files via cmp, directories via `diff -r`. Lets uninstall reclaim a roborepo
# copy (adopt-mode install, or a legacy materialized link like a real ~/.codex/hooks dir) WITHOUT
# ever deleting native or user-modified content: any divergence — an extra file, one edited line —
# returns false, so the path is left untouched. Mirrors install-lib.sh's helper of the same name.
content_matches_repo_source() {
  local src="$1"
  local dest="$2"

  [[ -e "${src}" ]] || return 1
  [[ -e "${dest}" && ! -L "${dest}" ]] || return 1
  if [[ -f "${src}" && -f "${dest}" ]]; then
    cmp -s "${src}" "${dest}"
    return $?
  fi
  if [[ -d "${src}" && -d "${dest}" ]]; then
    diff -r "${src}" "${dest}" >/dev/null 2>&1
    return $?
  fi
  return 1
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
#   2) If the file is our rendered output (recognized by is_roborepo_authored / render header), remove it.
#      The file is machine-generated ("Do not edit this file directly") so we remove it unconditionally
#      rather than checking --matches: a repo update between install and uninstall would change what
#      --matches produces, causing the old installed copy to be kept as orphaned roborepo content.
#      Files with no roborepo header (genuinely user-authored) are left untouched.
#   3) Restore the user's pre-install backup, if one was saved.
reclaim_rendered_rules_target() {
  local home_abs="$1"
  local harness="$2"

  remove_repo_symlink "${home_abs}"

  if [[ -e "${home_abs}" && ! -L "${home_abs}" ]]; then
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
  # grep -v exits 1 when nothing remains (".jdm-indexed" was the only line); that is success here —
  # the resulting empty global gitignore is harmless (see header) — so don't let set -e abort.
  grep -Fvx ".jdm-indexed" "${gitignore_global}" > "${tmp}" || true
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

while IFS=$'\t' read -r _h kind src_rel home_abs _flags; do
  case "${kind}" in
    managed_copy)    reclaim_link_target          "${src_rel}" "${home_abs}" "${_h}" ;;
    link)            reclaim_link_target          "${src_rel}" "${home_abs}" "${_h}" ;;
    cleanup)         remove_repo_symlink          "${home_abs}" ;;
    root_config)     remove_root_config           "${home_abs}" "${_h}" ;;
    rendered_rules)  reclaim_rendered_rules_target "${home_abs}" "${_h}" ;;
  esac
done < <(manifest_rows)

# Strip package-injected hooks and permissions from ~/.claude/settings.json after the backup
# restore/reset above. Packages (jcodemunch, jdocmunch, …) merge hooks directly into settings.json
# via mergeHooks; remove_root_config restores the pre-install backup verbatim, which can contain
# those hooks from a previous install cycle ("poisoned backup"). This pass removes whatever the
# package enablers put in, leaving only the user's genuine pre-roborepo content.
strip_package_hooks() {
  local settings="${HOME}/.claude/settings.json"
  [[ -f "${settings}" ]] || return 0
  command -v node >/dev/null 2>&1 || return 0

  local pkg_dir="${repo_root}/globals/packages"
  local pkgs_manifest="${repo_root}/manifests/inventory/packages.json"
  [[ -d "${pkg_dir}" || -f "${pkgs_manifest}" ]] || return 0

  if [[ "${dry_run}" -eq 1 ]]; then
    echo "strip: would remove package hooks/permissions from ${settings}"
    return 0
  fi

  SETTINGS_PATH="${settings}" PKG_DIR="${pkg_dir}" PKGS_MANIFEST="${pkgs_manifest}" node -e '
const fs = require("fs");
const path = require("path");
const settingsPath = process.env.SETTINGS_PATH;
const pkgDir = process.env.PKG_DIR;
const pkgsManifest = process.env.PKGS_MANIFEST;

let settings;
try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { process.exit(0); }

let changed = false;

// Strip hooks injected by each package
if (fs.existsSync(pkgDir)) {
  for (const pkg of fs.readdirSync(pkgDir)) {
    const hooksFile = path.join(pkgDir, pkg, "hooks-claude.json");
    if (!fs.existsSync(hooksFile)) continue;
    let fragment;
    try { fragment = JSON.parse(fs.readFileSync(hooksFile, "utf8")); } catch { continue; }
    const hooks = settings.hooks || {};
    for (const [event, entries] of Object.entries(fragment)) {
      const cmds = new Set(entries.map(e => e.hooks?.[0]?.command).filter(Boolean));
      const existing = hooks[event] || [];
      const next = existing.filter(e => {
        const cmd = e.hooks?.[0]?.command;
        if (cmd && cmds.has(cmd)) { changed = true; return false; }
        return true;
      });
      if (next.length === 0) delete hooks[event];
      else hooks[event] = next;
    }
    if (Object.keys(hooks).length === 0) delete settings.hooks;
    else settings.hooks = hooks;
  }
}

// Strip permissions injected by packages
if (fs.existsSync(pkgsManifest)) {
  let catalog;
  try { catalog = JSON.parse(fs.readFileSync(pkgsManifest, "utf8")).packages; } catch { catalog = []; }
  const toRemove = new Set(
    catalog.flatMap(p => p.components.filter(c => c.type === "permissions").flatMap(c => c.allow || []))
  );
  const existing = settings.permissions?.allow || [];
  const next = existing.filter(p => !toRemove.has(p));
  if (next.length !== existing.length) {
    if (next.length === 0) delete settings.permissions;
    else settings.permissions = { ...settings.permissions, allow: next };
    changed = true;
  }
}

if (changed) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log("strip: removed package hooks/permissions from " + settingsPath);
}
' && true || true
}
strip_package_hooks

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

# Remove roborepo-managed skills: copies carrying the '.roborepo-managed' marker, plus legacy
# managed symlinks from pre-copy installs. Never touches a user's native skill (a dir without the
# marker).
remove_skill_links() {
  local skills_home="$1"
  [[ -d "${skills_home}" ]] || return 0
  local entry
  for entry in "${skills_home}"/*; do
    if [[ -e "${entry}/.roborepo-managed" ]]; then
      rm -rf "${entry}"
      echo "remove: ${entry}"
    else
      is_roborepo_skill_link "${entry}" && remove_repo_symlink "${entry}" || true
    fi
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

# Surface (never delete) the durable pre-roborepo snapshot: the escape hatch the per-file restore
# above does not consume. Lets the user hand-restore anything the surgical restore did not cover.
original_archive="${HOME}/.roborepo-backups/pre-roborepo-original.tar.gz"
if [[ -e "${original_archive}" ]]; then
  echo "kept pre-roborepo snapshot: ${original_archive}"
  echo "  inspect: tar tzf ${original_archive}"
  echo "  restore: tar xzf ${original_archive} -C ${HOME}"
fi

echo "Uninstall complete."

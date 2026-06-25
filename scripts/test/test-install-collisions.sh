#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

pass() {
  echo "ok: $1"
}

fail() {
  echo "FAIL: $1" >&2
  if [[ $# -gt 1 && -f "$2" ]]; then
    sed -n '1,160p' "$2" >&2
  fi
  exit 1
}

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  local label="$3"

  grep -qE "$pattern" "$file" && pass "$label" || fail "$label" "$file"
}

assert_file_not_contains() {
  local file="$1"
  local pattern="$2"
  local label="$3"

  if grep -qE "$pattern" "$file"; then
    fail "$label" "$file"
  fi
  pass "$label"
}

assert_symlink_target() {
  local link_path="$1"
  local target="$2"
  local label="$3"

  [[ -L "$link_path" && "$(readlink "$link_path")" == "$target" ]] && pass "$label" || fail "$label"
}

assert_not_symlink() {
  local path="$1"
  local label="$2"

  [[ -e "$path" && ! -L "$path" ]] && pass "$label" || fail "$label"
}

assert_regular_file_contains() {
  local file="$1"
  local pattern="$2"
  local label="$3"

  [[ -f "$file" && ! -L "$file" ]] || fail "$label"
  assert_file_contains "$file" "$pattern" "$label"
}

make_home() {
  local tmp
  tmp="$(mktemp -d)"
  mkdir -p "$tmp/.claude" "$tmp/.codex"
  echo "$tmp"
}

seed_user_configs() {
  local home_dir="$1"
  printf '{"model":"opus","permissions":{"allow":["Bash(foo)"]}}\n' > "$home_dir/.claude/settings.json"
  printf 'model = "o3"\n[profiles.personal]\nmodel = "gpt-5"\n[mcp_servers.personal]\ncommand = "foo"\n' > "$home_dir/.codex/config.toml"
}

run_expect_install() {
  local home_dir="$1"
  local output="$2"
  local script="$3"

  command -v expect >/dev/null 2>&1 || fail "expect is required for interactive installer tests"
  # These tests cover the install-mode + collision prompts, not onboarding, so run with
  # ROBOREPO_PRESETS_ONBOARD=skip: main.sh applies the base configuration and then skips the
  # interactive wizard (no keypress to drive, no timing-dependent dismissal that can hang under
  # load). The wizard itself is covered by test_onboarding_wizard_toggles_and_applies, which spawns
  # `onboard` alone so it reaches the wizard instantly. 120s tolerates the full install under load
  # (main.sh always terminates in skip mode, so eof is guaranteed — the timeout just bounds install).
  HC_REPO="$repo_root" HC_HOME="$home_dir" HC_EXPECT_SCRIPT="$script" expect <<'EOF' >"$output" 2>&1
set timeout 120
spawn env HOME=$env(HC_HOME) ROBOREPO_ASSUME_INTERACTIVE=1 ROBOREPO_PRESETS_ONBOARD=skip $env(HC_REPO)/scripts/install/main.sh
source $env(HC_EXPECT_SCRIPT)
expect eof
set wait_result [wait]
set exit_code [lindex $wait_result 3]
exit $exit_code
EOF
}

run_expect_install_args() {
  local home_dir="$1"
  local output="$2"
  shift 2

  HOME="$home_dir" "$repo_root/scripts/install/main.sh" "$@" >"$output" 2>&1
}

run_harness_install_args() {
  local home_dir="$1"
  local output="$2"
  shift 2

  HOME="$home_dir" "$repo_root/scripts/install/install-claude.sh" "$@" >"$output" 2>&1
  HOME="$home_dir" "$repo_root/scripts/install/install-codex.sh" "$@" >>"$output" 2>&1
}

test_fresh_managed() {
  local home_dir
  home_dir="$(make_home)"

  HOME="$home_dir" "$repo_root/scripts/install/main.sh" >"$home_dir/out"

  # Install applies the minimal base bundle, then hands off to onboarding. Non-interactively the
  # onboard step takes its headless path (applies the default set, no wizard), so a noninteractive
  # install still lands a working harness without prompting.
  assert_file_contains "$home_dir/out" "Core Install Complete" "main install completes core"
  assert_file_contains "$home_dir/out" "Base Configuration" "noninteractive install applies the base bundle"
  assert_file_contains "$home_dir/out" "applying the default configuration" "noninteractive onboard runs headlessly"
  [[ -e "$home_dir/.claude/settings.json" && -e "$home_dir/.codex/config.toml" ]] \
    && pass "main install applies harness root config automatically" \
    || fail "main install applies harness root config automatically"
}

test_mode_prompt_allows_adopt_on_clean_machine() {
  local home_dir expect_file
  home_dir="$(make_home)"
  expect_file="$home_dir/expect.tcl"
  # Covers the mode + collision prompts only; onboarding is skipped (see run_expect_install).
  cat >"$expect_file" <<'EOF'
expect "Selection*"
send "2\r"
expect "Choose adopt collision behavior"
expect "Selection*"
send "2\r"
EOF

  run_expect_install "$home_dir" "$home_dir/out" "$expect_file"

  assert_file_contains "$home_dir/out" "Choose install mode" "install mode prompt appears"
  assert_file_contains "$home_dir/out" "Mode.*adopt" "install mode prompt accepts adopt"
  assert_file_contains "$home_dir/out" "state: .* mode=adopt on-conflict=keep" "adopt keep policy is persisted"
  assert_file_contains "$home_dir/out" "Base Configuration" "install applies base configuration after core install"
  [[ -f "$home_dir/.roborepo/presets/state.json" ]] \
    && pass "post-install default apply records preset state" \
    || fail "post-install default apply records preset state" "$home_dir/out"
}

test_mode_prompt_allows_managed_selection() {
  local home_dir expect_file
  home_dir="$(make_home)"
  expect_file="$home_dir/expect.tcl"
  # Managed mode on a clean machine has no collision prompt; onboarding is skipped (see
  # run_expect_install), so only the mode prompt needs driving.
  cat >"$expect_file" <<'EOF'
expect "Selection*"
send "1\r"
EOF

  run_expect_install "$home_dir" "$home_dir/out" "$expect_file"

  assert_file_contains "$home_dir/out" "Choose install mode" "install mode prompt appears for managed"
  assert_file_contains "$home_dir/out" "Mode.*managed" "install mode prompt accepts managed"
  assert_file_contains "$home_dir/out" "state: .* mode=managed on-conflict=overwrite" "managed overwrite policy is persisted"
  assert_file_contains "$home_dir/out" "Base Configuration" "managed install applies base configuration after core install"
}

# End-to-end coverage of the interactive onboarding wizard: a real keypress toggles an item (instant
# in-memory flip), and on exit the deferred batch apply runs after raw mode is off and applies only
# the changed item. The pure diff selection is unit-tested separately (wizard-diff-check.mjs).
test_onboarding_wizard_toggles_and_applies() {
  local home_dir
  home_dir="$(make_home)"
  # Core-install (headless) first so the wizard has a real config to build its steps from.
  HOME="$home_dir" "$repo_root/scripts/install/main.sh" < /dev/null >/dev/null 2>&1

  command -v expect >/dev/null 2>&1 || fail "expect is required for interactive installer tests"
  # Space toggles the highlighted item; Esc finishes, triggering the deferred batch apply.
  HC_HOME="$home_dir" HC_REPO="$repo_root" expect <<'EOF' >"$home_dir/wiz.out" 2>&1
set timeout 45
spawn env HOME=$env(HC_HOME) ROBOREPO_STATE_DIR=$env(HC_HOME)/.roborepo node $env(HC_REPO)/scripts/cli/main.mjs onboard
expect "Step 1"
send " "
send "\033"
expect eof
EOF

  assert_file_contains "$home_dir/wiz.out" "Applying changes" "wizard runs deferred batch apply after a toggle"
  assert_file_not_contains "$home_dir/wiz.out" "failed:" "wizard toggle applies without error"
  assert_file_contains "$home_dir/wiz.out" "Onboarding complete" "wizard finishes cleanly"
}

test_managed_mode_backs_up_existing_configs() {
  local home_dir
  home_dir="$(make_home)"
  seed_user_configs "$home_dir"

  ROBOREPO_INSTALL_MODE=managed run_harness_install_args "$home_dir" "$home_dir/out"

  assert_file_contains "$home_dir/out" "backup: $home_dir/.claude/settings.json" "managed backs up existing Claude config"
  assert_file_contains "$home_dir/out" "backup: $home_dir/.codex/config.toml" "managed backs up existing Codex config"
  assert_file_contains "$home_dir/out" "Merge review prompt:" "managed prints merge review prompt"
}

test_existing_root_symlinks_convert_to_local_copies() {
  local home_dir
  home_dir="$(make_home)"

  ln -s "$repo_root/globals/claude/settings.json" "$home_dir/.claude/settings.json"
  ln -s "$repo_root/globals/codex/config.toml" "$home_dir/.codex/config.toml"

  HOME="$home_dir" "$repo_root/scripts/install/install-claude.sh" >"$home_dir/claude.out"
  HOME="$home_dir" "$repo_root/scripts/install/install-codex.sh" >"$home_dir/codex.out"

  assert_file_contains "$home_dir/claude.out" "converted from repo symlink" "managed Claude root config symlinks are converted"
  assert_file_contains "$home_dir/codex.out" "converted from repo symlink" "managed Codex root config symlinks are converted"
  assert_regular_file_contains "$home_dir/.claude/settings.json" "permissions" "converted Claude config is local file"
  assert_regular_file_contains "$home_dir/.codex/config.toml" "mcp_servers.jcodemunch" "converted Codex config is local file"
}

test_direct_harness_installers_export_root_configs() {
  local home_dir
  home_dir="$(make_home)"

  HOME="$home_dir" "$repo_root/scripts/install/install-claude.sh" >"$home_dir/claude.out"
  HOME="$home_dir" "$repo_root/scripts/install/install-codex.sh" >"$home_dir/codex.out"

  assert_regular_file_contains "$home_dir/.claude/settings.json" "permissions" "direct Claude installer copies root config as local file"
  assert_regular_file_contains "$home_dir/.codex/config.toml" "mcp_servers.jcodemunch" "direct Codex installer copies root config as local file"
  assert_symlink_target "$home_dir/.claude/CLAUDE.md" "$repo_root/globals/claude/CLAUDE.md" "direct Claude installer links read-mostly assets"
  assert_symlink_target "$home_dir/.codex/AGENTS.md" "$repo_root/globals/codex/AGENTS.md" "direct Codex installer links read-mostly assets"
  assert_symlink_target "$home_dir/.codex/skills/blog" "$repo_root/globals/agents/skills/blog" "direct Codex installer links per-skill symlinks into ~/.codex/skills"
}

test_direct_harness_installers_convert_root_symlinks() {
  local home_dir
  home_dir="$(make_home)"

  ln -s "$repo_root/globals/claude/settings.json" "$home_dir/.claude/settings.json"
  ln -s "$repo_root/globals/codex/config.toml" "$home_dir/.codex/config.toml"

  HOME="$home_dir" "$repo_root/scripts/install/install-claude.sh" >"$home_dir/claude.out"
  HOME="$home_dir" "$repo_root/scripts/install/install-codex.sh" >"$home_dir/codex.out"

  assert_file_contains "$home_dir/claude.out" "converted from repo symlink" "direct Claude installer converts stale root symlink"
  assert_file_contains "$home_dir/codex.out" "converted from repo symlink" "direct Codex installer converts stale root symlink"
  assert_not_symlink "$home_dir/.claude/settings.json" "direct Claude converted config is not a symlink"
  assert_not_symlink "$home_dir/.codex/config.toml" "direct Codex converted config is not a symlink"
}

test_old_repo_managed_symlinks_are_migrated() {
  local home_dir
  home_dir="$(make_home)"
  mkdir -p "$home_dir/.agents"

  ln -s "$repo_root/claude/settings.json" "$home_dir/.claude/settings.json"
  ln -s "$repo_root/codex/config.toml" "$home_dir/.codex/config.toml"
  ln -s "$repo_root/claude/CLAUDE.md" "$home_dir/.claude/CLAUDE.md"
  ln -s "$repo_root/claude/hooks" "$home_dir/.claude/hooks"
  ln -s "$repo_root/claude/skills" "$home_dir/.claude/skills"
  ln -s "$repo_root/codex/AGENTS.md" "$home_dir/.codex/AGENTS.md"
  ln -s "$repo_root/codex/hooks.json" "$home_dir/.codex/hooks.json"
  ln -s "$repo_root/codex/rules" "$home_dir/.codex/rules"
  ln -s "$repo_root/agents/skills" "$home_dir/.agents/skills"
  ln -s "$repo_root/agents/skills" "$home_dir/.codex/skills"

  run_harness_install_args "$home_dir" "$home_dir/out"

  assert_regular_file_contains "$home_dir/.claude/settings.json" "permissions" "old Claude root config symlink converts to local file"
  assert_regular_file_contains "$home_dir/.codex/config.toml" "mcp_servers.jcodemunch" "old Codex root config symlink converts to local file"
  assert_symlink_target "$home_dir/.claude/CLAUDE.md" "$repo_root/globals/claude/CLAUDE.md" "old Claude asset symlink relinks to globals"
  assert_symlink_target "$home_dir/.claude/hooks" "$repo_root/globals/claude/hooks" "old Claude hooks symlink relinks to globals"
  assert_symlink_target "$home_dir/.codex/AGENTS.md" "$repo_root/globals/codex/AGENTS.md" "old Codex AGENTS symlink relinks to globals"
  assert_symlink_target "$home_dir/.codex/hooks.json" "$repo_root/globals/codex/hooks.json" "old Codex hooks symlink relinks to globals"
  assert_symlink_target "$home_dir/.codex/rules" "$repo_root/globals/codex/rules" "old Codex rules symlink relinks to globals"
  # Old dir-level ~/.claude/skills symlink is cleaned up by the migration cleanup row.
  # Old ~/.agents/skills and transitional ~/.codex/skills dir-level symlinks are no longer managed.
  # After install, ~/.codex/skills/ is a real directory with per-skill managed symlinks.
  assert_symlink_target "$home_dir/.codex/skills/blog" "$repo_root/globals/agents/skills/blog" "old machine migrated: per-skill Codex links created"
  assert_symlink_target "$home_dir/.claude/skills/blog" "$repo_root/globals/agents/skills/blog" "old machine migrated: per-skill Claude links created"
}

test_direct_claude_installer_removes_stale_retired_symlink() {
  local home_dir
  home_dir="$(make_home)"
  ln -s "$repo_root/claude/MANAGED_BY_HARNESS_CONFIGS.md" "$home_dir/.claude/MANAGED_BY_HARNESS_CONFIGS.md"

  HOME="$home_dir" "$repo_root/scripts/install/install-claude.sh" >"$home_dir/out"

  [[ ! -e "$home_dir/.claude/MANAGED_BY_HARNESS_CONFIGS.md" && ! -L "$home_dir/.claude/MANAGED_BY_HARNESS_CONFIGS.md" ]] \
    && pass "direct Claude installer removes stale retired symlink" \
    || fail "direct Claude installer removes stale retired symlink"
}

test_verify_install_requires_active_root_configs() {
  local home_dir
  home_dir="$(make_home)"

  if ! command -v uvx >/dev/null 2>&1; then
    pass "verify-install active-root fixture skipped; uvx unavailable"
    return 0
  fi

  HOME="$home_dir" "$repo_root/scripts/install/main.sh" >"$home_dir/install.out"
  HOME="$home_dir" ROBOREPO_STATE_DIR="$home_dir/.roborepo" node "$repo_root/scripts/cli/main.mjs" bundle apply base >/dev/null
  PATH="$home_dir/.local/bin:$PATH" HOME="$home_dir" "$repo_root/scripts/verify-install.sh" --quiet >"$home_dir/verify-pass.out" 2>&1 \
    && pass "verify-install accepts copied active root configs" \
    || fail "verify-install accepts copied active root configs" "$home_dir/verify-pass.out"

  rm "$home_dir/.claude/settings.json" "$home_dir/.codex/config.toml"
  ln -s "$repo_root/globals/claude/settings.json" "$home_dir/.claude/settings.json"
  ln -s "$repo_root/globals/codex/config.toml" "$home_dir/.codex/config.toml"

  if PATH="$home_dir/.local/bin:$PATH" HOME="$home_dir" "$repo_root/scripts/verify-install.sh" --quiet >"$home_dir/verify-fail.out" 2>&1; then
    fail "verify-install rejects stale root config symlinks" "$home_dir/verify-fail.out"
  fi

  assert_file_contains "$home_dir/verify-fail.out" "base selected but not fully applied" "verify-install rejects stale selected root preset"
}

test_dry_run_collision_no_mutation() {
  local home_dir
  home_dir="$(make_home)"
  seed_user_configs "$home_dir"

  run_harness_install_args "$home_dir" "$home_dir/out" --dry-run

  assert_file_contains "$home_dir/out" "backup: $home_dir/.claude/settings.json" "dry-run previews Claude backup"
  assert_file_contains "$home_dir/out" "Merge review prompt:" "dry-run previews merge prompt"
  [[ ! -L "$home_dir/.claude/settings.json" && ! -L "$home_dir/.codex/config.toml" ]] && pass "dry-run leaves config files untouched" || fail "dry-run leaves config files untouched"
  [[ ! -e "$home_dir/.claude/settings_update_"* && ! -e "$home_dir/.roborepo-backups" ]] && pass "dry-run creates no backups or staged updates" || fail "dry-run creates no backups or staged updates"
}

test_noninteractive_block_no_mutation() {
  local home_dir
  home_dir="$(make_home)"
  seed_user_configs "$home_dir"

  if ROBOREPO_INSTALL_MODE=adopt run_harness_install_args "$home_dir" "$home_dir/out"; then
    fail "noninteractive collision blocks install" "$home_dir/out"
  fi

  assert_file_contains "$home_dir/out" "stdin is not interactive" "noninteractive collision explains failure"
  [[ ! -e "$home_dir/.claude/CLAUDE.md" && ! -e "$home_dir/.codex/AGENTS.md" ]] && pass "noninteractive block prevents partial install" || fail "noninteractive block prevents partial install"
}

test_non_root_conflict_stages_with_policy() {
  local home_dir
  home_dir="$(make_home)"
  printf 'existing agents\n' > "$home_dir/.codex/AGENTS.md"

  HOME="$home_dir" "$repo_root/scripts/install/install-codex.sh" --mode adopt --on-conflict keep >"$home_dir/out" 2>&1

  assert_file_contains "$home_dir/.codex/AGENTS.md" "existing agents" "keep policy preserves existing non-root file"
  find "$home_dir/.codex" -name 'AGENTS_update_*.md' | grep -q . \
    && pass "keep policy stages non-root repo update" \
    || fail "keep policy stages non-root repo update"
  [[ -f "$home_dir/.codex/config.toml" ]] \
    && pass "keep policy still installs missing Codex files" \
    || fail "keep policy still installs missing Codex files"
}

test_global_command_conflict_blocks_before_mutation() {
  local home_dir
  home_dir="$(make_home)"
  mkdir -p "$home_dir/.local/bin"
  # roborepo is the one managed global command; an unmanaged file at its target must block install.
  printf '#!/bin/sh\necho local\n' > "$home_dir/.local/bin/roborepo"
  chmod +x "$home_dir/.local/bin/roborepo"

  if HOME="$home_dir" "$repo_root/scripts/install/main.sh" >"$home_dir/out" 2>&1; then
    fail "global command conflict blocks install" "$home_dir/out"
  fi

  assert_file_contains "$home_dir/out" "conflict: $home_dir/.local/bin/roborepo already exists" "global command conflict is reported"
  assert_file_contains "$home_dir/out" "Default stance: preserve the existing local command" "global command prompt preserves local command"
  assert_file_contains "$home_dir/.local/bin/roborepo" "echo local" "global command conflict leaves command untouched"
  [[ ! -e "$home_dir/.gitignore_global" && ! -e "$home_dir/.claude/settings.json" && ! -e "$home_dir/.codex/config.toml" ]] \
    && pass "global command conflict prevents config mutation" \
    || fail "global command conflict prevents config mutation"
}

test_direct_harness_conflict_dry_run_reports() {
  local home_dir
  home_dir="$(make_home)"
  printf 'existing agents\n' > "$home_dir/.codex/AGENTS.md"

  ROBOREPO_INSTALL_MODE=adopt HOME="$home_dir" "$repo_root/scripts/install/install-codex.sh" --dry-run >"$home_dir/out" 2>&1

  assert_file_contains "$home_dir/out" "collision: $home_dir/.codex/AGENTS.md" "direct Codex installer reports non-root conflict"
  [[ ! -e "$home_dir/.codex/config.toml" && ! -e "$home_dir/.codex/hooks.json" ]] \
    && pass "direct Codex dry-run prevents mutation" \
    || fail "direct Codex dry-run prevents mutation"
}

test_adopt_keep_originals_prints_merge_prompt() {
  local home_dir
  home_dir="$(make_home)"
  seed_user_configs "$home_dir"

  ROBOREPO_INSTALL_MODE=adopt run_harness_install_args "$home_dir" "$home_dir/out" --on-conflict keep

  [[ ! -L "$home_dir/.claude/settings.json" ]] && pass "keep leaves Claude config as regular file" || fail "keep leaves Claude config as regular file"
  assert_file_contains "$home_dir/.claude/settings.json" '"model":"opus"' "keep preserves Claude config content"
  find "$home_dir/.claude" -name 'settings_update_*.json' | grep -q . \
    && pass "keep stages Claude root config update" \
    || fail "keep stages Claude root config update"
  [[ ! -L "$home_dir/.codex/config.toml" ]] && pass "keep leaves Codex config as regular file" || fail "keep leaves Codex config as regular file"
  assert_file_contains "$home_dir/.codex/config.toml" "\[mcp_servers.personal\]" "keep preserves Codex config content"
  find "$home_dir/.codex" -name 'config_update_*.toml' | grep -q . \
    && pass "keep stages Codex root config update" \
    || fail "keep stages Codex root config update"
  assert_file_contains "$home_dir/out" "Merge review prompt:" "keep prints merge review prompt"
}

test_adopt_overwrite_policy_backs_up_originals() {
  local home_dir
  home_dir="$(make_home)"
  seed_user_configs "$home_dir"

  ROBOREPO_INSTALL_MODE=adopt run_harness_install_args "$home_dir" "$home_dir/out" --on-conflict overwrite

  assert_file_contains "$home_dir/.claude/settings.json" "permissions" "overwrite installs Claude repo config"
  find "$home_dir/.claude" -name 'settings_original_*.json' | grep -q . \
    && pass "overwrite backs up original Claude config" \
    || fail "overwrite backs up original Claude config"
  assert_file_contains "$home_dir/.codex/config.toml" "mcp_servers.jcodemunch" "overwrite installs Codex repo config"
  find "$home_dir/.codex" -name 'config_original_*.toml' | grep -q . \
    && pass "overwrite backs up original Codex config" \
    || fail "overwrite backs up original Codex config"
  assert_file_contains "$home_dir/out" "Merge review prompt:" "overwrite prints merge review prompt"
}

test_abort_no_config_replacement() {
  local home_dir
  home_dir="$(make_home)"
  seed_user_configs "$home_dir"

  if ROBOREPO_INSTALL_MODE=adopt run_harness_install_args "$home_dir" "$home_dir/out" --on-conflict abort; then
    fail "abort exits nonzero" "$home_dir/out"
  fi

  assert_file_contains "$home_dir/out" "install canceled by user" "abort reports cancellation"
  [[ ! -L "$home_dir/.claude/settings.json" && ! -e "$home_dir/.claude/CLAUDE.md" && ! -e "$home_dir/.gitignore_global" ]] \
    && pass "abort does not replace config or continue" \
    || fail "abort does not replace config or continue"
}

test_uninstall_removes_repo_owned_links() {
  local home_dir
  home_dir="$(make_home)"

  HOME="$home_dir" "$repo_root/scripts/install/main.sh" >"$home_dir/install.out"
  HOME="$home_dir" ROBOREPO_STATE_DIR="$home_dir/.roborepo" node "$repo_root/scripts/cli/main.mjs" bundle apply base >/dev/null
  HOME="$home_dir" "$repo_root/scripts/install/uninstall.sh" >"$home_dir/uninstall.out"

  [[ ! -e "$home_dir/.claude/CLAUDE.md" && ! -L "$home_dir/.claude/CLAUDE.md" ]] \
    && pass "uninstall removes Claude repo symlink" \
    || fail "uninstall removes Claude repo symlink"
  [[ ! -e "$home_dir/.codex/AGENTS.md" && ! -L "$home_dir/.codex/AGENTS.md" ]] \
    && pass "uninstall removes Codex repo symlink" \
    || fail "uninstall removes Codex repo symlink"
  [[ -f "$home_dir/.claude/settings.json" && -f "$home_dir/.codex/config.toml" ]] \
    && pass "uninstall leaves root configs in place" \
    || fail "uninstall leaves root configs in place"
  [[ ! -f "$home_dir/.roborepo/install-state.json" ]] \
    && pass "uninstall removes install state" \
    || fail "uninstall removes install state"
}

test_idempotency_no_extra_backups() {
  local home_dir
  home_dir="$(make_home)"

  run_harness_install_args "$home_dir" "$home_dir/first.out"
  run_harness_install_args "$home_dir" "$home_dir/second.out"

  assert_file_contains "$home_dir/second.out" "ok: $home_dir/.claude/settings.json" "idempotent Claude config ok"
  assert_file_contains "$home_dir/second.out" "ok: $home_dir/.codex/config.toml" "idempotent Codex config ok"
  ! find "$home_dir/.roborepo-backups" -name settings.json -o -name config.toml 2>/dev/null | grep -q . \
    && pass "idempotent managed run creates no config backups" \
    || fail "idempotent managed run creates no config backups"
}

test_malformed_claude_config() {
  local home_dir
  home_dir="$(make_home)"
  printf '{bad json\n' > "$home_dir/.claude/settings.json"
  printf 'model = "o3"\n' > "$home_dir/.codex/config.toml"

  ROBOREPO_INSTALL_MODE=adopt HOME="$home_dir" "$repo_root/scripts/install/install-claude.sh" --dry-run >"$home_dir/out"

  assert_file_contains "$home_dir/out" "invalid JSON" "malformed Claude config is reported"
  assert_file_contains "$home_dir/out" "collision: $home_dir/.claude/settings.json" "malformed Claude config still prompts"
}

test_sync_guard() {
  local home_dir sync_repo before_hash after_hash
  home_dir="$(make_home)"
  sync_repo="$(mktemp -d)"
  seed_user_configs "$home_dir"
  mkdir -p "$sync_repo/globals/codex" "$sync_repo/globals/claude" "$sync_repo/manifests/platform" "$sync_repo/scripts/lib"
  cp "$repo_root/globals/codex/config.toml" "$sync_repo/globals/codex/config.toml"
  cp "$repo_root/globals/claude/settings.json" "$sync_repo/globals/claude/settings.json"
  # sync-from-home reads the manifest via scripts/lib/manifests-data.sh; the fake repo root
  # needs both so manifest_rows resolves against this fixture.
  cp "$repo_root/manifests/platform/manifest.tsv" "$sync_repo/manifests/platform/manifest.tsv"
  cp "$repo_root/scripts/lib/manifests-data.sh" "$sync_repo/scripts/lib/manifests-data.sh"

  before_hash="$(shasum "$sync_repo/globals/codex/config.toml" "$sync_repo/globals/claude/settings.json")"
  ROBOREPO_REPO_ROOT="$sync_repo" HOME="$home_dir" "$repo_root/scripts/sync-from-home.sh" >"$home_dir/out"
  after_hash="$(shasum "$sync_repo/globals/codex/config.toml" "$sync_repo/globals/claude/settings.json")"

  [[ "$before_hash" == "$after_hash" ]] && pass "sync guard leaves repo config baseline unchanged" || fail "sync guard leaves repo config baseline unchanged"
  assert_file_contains "$home_dir/out" "skip user-owned config: $home_dir/.codex/config.toml" "sync guard skips Codex user config"
  assert_file_contains "$home_dir/out" "skip user-owned config: $home_dir/.claude/settings.json" "sync guard skips Claude user config"

  if ROBOREPO_REPO_ROOT="$sync_repo" HOME="$home_dir" "$repo_root/scripts/sync-from-home.sh" --include-root-config >"$home_dir/include-root.out" 2>&1; then
    fail "sync include-root-config requires interactive review" "$home_dir/include-root.out"
  fi
  assert_file_contains "$home_dir/include-root.out" "stdin is not interactive" "sync include-root-config reviews user config before promoting"
}

test_sync_interactive_choices() {
  local home_dir sync_repo expect_file
  home_dir="$(make_home)"
  sync_repo="$(mktemp -d)"
  mkdir -p "$sync_repo/globals/codex" "$sync_repo/manifests/platform/prompts" "$sync_repo/scripts/lib" "$home_dir/.codex"
  cp "$repo_root/manifests/platform/manifest.tsv" "$sync_repo/manifests/platform/manifest.tsv"
  cp "$repo_root/manifests/platform/prompts/sync-merge.md" "$sync_repo/manifests/platform/prompts/sync-merge.md"
  cp "$repo_root/scripts/lib/manifests-data.sh" "$sync_repo/scripts/lib/manifests-data.sh"
  printf 'repo agents\n' > "$sync_repo/globals/codex/AGENTS.md"
  printf 'home agents\n' > "$home_dir/.codex/AGENTS.md"
  printf 'repo hooks\n' > "$sync_repo/globals/codex/hooks.json"
  printf 'home hooks\n' > "$home_dir/.codex/hooks.json"
  printf 'repo marker\n' > "$sync_repo/globals/codex/MANAGED_BY_ROBOREPO.md"
  printf 'home marker\n' > "$home_dir/.codex/MANAGED_BY_ROBOREPO.md"
  # sync processes items in manifest order; for this fixture the present items prompt as:
  #   1) AGENTS.md   2) MANAGED_BY_ROBOREPO.md   3) hooks.json
  # Answer so AGENTS is kept, hooks.json is overwritten, MANAGED_BY gets the merge prompt
  # (matches the assertions below, which are keyed by file, not by prompt order).
  expect_file="$home_dir/expect.tcl"
  cat >"$expect_file" <<'EOF'
expect "Selection*"
send "1\r"
expect "Selection*"
send "3\r"
expect "Selection*"
send "2\r"
expect eof
EOF

  command -v expect >/dev/null 2>&1 || fail "expect is required for interactive sync tests"
  HC_REPO="$repo_root" HC_HOME="$home_dir" HC_SYNC_REPO="$sync_repo" HC_EXPECT_SCRIPT="$expect_file" expect <<'EOF' >"$home_dir/out" 2>&1
set timeout 20
spawn env ROBOREPO_REPO_ROOT=$env(HC_SYNC_REPO) HOME=$env(HC_HOME) $env(HC_REPO)/scripts/sync-from-home.sh
source $env(HC_EXPECT_SCRIPT)
set wait_result [wait]
set exit_code [lindex $wait_result 3]
exit $exit_code
EOF

  assert_file_contains "$sync_repo/globals/codex/AGENTS.md" "repo agents" "sync keep repo leaves item unchanged"
  assert_file_contains "$sync_repo/globals/codex/hooks.json" "home hooks" "sync overwrite copies home item"
  assert_file_contains "$sync_repo/globals/codex/MANAGED_BY_ROBOREPO.md" "repo marker" "sync merge prompt skips item"
  assert_file_contains "$home_dir/out" "Merge review prompt:" "sync merge prompt printed"
  assert_file_contains "$home_dir/out" "Required first step: compute your own complete comparison" "sync prompt requires full comparison"
  assert_file_contains "$home_dir/out" "Default stance: keep the repo baseline" "sync prompt defaults to repo baseline"
}

test_sync_overwrite_rollback_on_replace_failure() {
  local home_dir sync_repo expect_file fake_bin
  home_dir="$(make_home)"
  sync_repo="$(mktemp -d)"
  fake_bin="$(mktemp -d)"
  mkdir -p "$sync_repo/globals/codex" "$sync_repo/manifests/platform/prompts" "$sync_repo/scripts/lib" "$home_dir/.codex"
  cp "$repo_root/manifests/platform/manifest.tsv" "$sync_repo/manifests/platform/manifest.tsv"
  cp "$repo_root/manifests/platform/prompts/sync-merge.md" "$sync_repo/manifests/platform/prompts/sync-merge.md"
  cp "$repo_root/scripts/lib/manifests-data.sh" "$sync_repo/scripts/lib/manifests-data.sh"
  printf 'repo hooks\n' > "$sync_repo/globals/codex/hooks.json"
  printf 'home hooks\n' > "$home_dir/.codex/hooks.json"
  expect_file="$home_dir/expect.tcl"
  cat >"$expect_file" <<'EOF'
expect "Selection*"
send "2\r"
expect eof
EOF
  cat >"$fake_bin/mv" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == *".sync-from-home.tmp."*"/item" ]]; then
  exit 1
fi
exec /bin/mv "$@"
EOF
  chmod +x "$fake_bin/mv"

  command -v expect >/dev/null 2>&1 || fail "expect is required for interactive sync tests"
  if HC_REPO="$repo_root" HC_HOME="$home_dir" HC_SYNC_REPO="$sync_repo" HC_EXPECT_SCRIPT="$expect_file" HC_FAKE_BIN="$fake_bin" expect <<'EOF' >"$home_dir/out" 2>&1
set timeout 20
spawn env ROBOREPO_REPO_ROOT=$env(HC_SYNC_REPO) HOME=$env(HC_HOME) PATH=$env(HC_FAKE_BIN):$env(PATH) $env(HC_REPO)/scripts/sync-from-home.sh
source $env(HC_EXPECT_SCRIPT)
set wait_result [wait]
set exit_code [lindex $wait_result 3]
exit $exit_code
EOF
  then
    fail "sync overwrite failure exits nonzero" "$home_dir/out"
  fi

  assert_file_contains "$home_dir/out" "failed to replace" "sync overwrite reports replace failure"
  assert_file_contains "$sync_repo/globals/codex/hooks.json" "repo hooks" "sync overwrite restores original repo file"
}

test_windows_installer_root_preflight_order() {
  local windows_script root_line claude_line
  windows_script="$repo_root/scripts/install/install-windows.ps1"
  root_line="$(awk '/^Invoke-RootConfigPreflight$/ { print NR; exit }' "$windows_script")"
  claude_line="$(awk '/^# Claude managed links/ { print NR; exit }' "$windows_script")"

  [[ -n "$root_line" && -n "$claude_line" && "$root_line" -lt "$claude_line" ]] \
    && pass "Windows installer resolves root config collisions before linking" \
    || fail "Windows installer resolves root config collisions before linking" "$windows_script"
  assert_file_contains "$windows_script" 'function Get-ManifestRows' "Windows installer reads manifest rows"
  assert_file_contains "$windows_script" 'Resolve-ManifestHomeRoot' "Windows installer resolves manifest home roots"
  assert_file_contains "$windows_script" 'Invoke-ManifestRows "Claude" @\("claude"\)' "Windows installer applies Claude manifest rows"
  assert_file_contains "$windows_script" 'Invoke-ManifestRows "Codex" @\("codex"\)' "Windows installer applies Codex manifest rows"
  assert_file_contains "$windows_script" 'if \(-not \$adoptRootConfig\[\$row.Harness\]\)' "Windows installer skips adopted root config from manifest"
  assert_file_not_contains "$windows_script" 'Link-Item "globals/codex/AGENTS.md"' "Windows installer does not hand-list Codex AGENTS link"
  assert_file_not_contains "$windows_script" 'Link-Item "globals/agents/skills"[[:space:]]+\(Join-Path \$agentsHome "skills"\)' "Windows installer does not hand-list canonical Codex skills link"
  assert_file_not_contains "$windows_script" 'Link-Item "globals/agents/skills"[[:space:]]+\(Join-Path \$codexHome "skills"\)' "Windows installer does not link ~/.codex/skills (Codex owns it)"
  assert_file_not_contains "$windows_script" 'Link-Item "globals/codex/skills"' "Windows installer does not reference removed globals/codex/skills source"
}

test_repo_local_codex_skill_layer_present() {
  # Repo-local skills under local/skills/ are linked into BOTH .claude/skills and .codex/skills
  # (Codex reads <repo>/.codex/skills when an agent works inside this repo, mirroring .claude).
  # link-skills.sh is the source of truth: --check must pass and both per-harness links must
  # resolve to the local source.
  "$repo_root/scripts/build/link-skills.sh" --check >/dev/null
  local name="harness-platform-dev"
  [[ "$(readlink "$repo_root/.claude/skills/$name" 2>/dev/null)" == "../../local/skills/$name" ]] \
    && pass "repo-local .claude skill link resolves to local source" \
    || fail "repo-local .claude skill link resolves to local source"
  [[ "$(readlink "$repo_root/.codex/skills/$name" 2>/dev/null)" == "../../local/skills/$name" ]] \
    && pass "repo-local .codex skill link resolves to local source" \
    || fail "repo-local .codex skill link resolves to local source"
}

test_write_guard_root_config_message() {
  local home_dir root_out skill_out
  home_dir="$(make_home)"
  root_out="$home_dir/root-guard.out"
  skill_out="$home_dir/skill-guard.out"

  printf '{"tool_input":{"file_path":"%s/.codex/config.toml"}}\n' "$home_dir" \
    | HOME="$home_dir" node "$repo_root/globals/claude/hooks/roborepo-write-guard.mjs" >"$root_out"
  printf '{"tool_input":{"file_path":"%s/.claude/skills/new-skill/SKILL.md"}}\n' "$home_dir" \
    | HOME="$home_dir" node "$repo_root/globals/claude/hooks/roborepo-write-guard.mjs" >"$skill_out"

  assert_file_contains "$root_out" "mutable active root config" "write guard identifies root config as local"
  assert_file_contains "$root_out" "not a repo symlink" "write guard does not call root config a symlink"
  assert_file_contains "$skill_out" "Create it in the repo" "write guard still redirects new symlinked assets"
}

test_fresh_managed
test_existing_root_symlinks_convert_to_local_copies
test_direct_harness_installers_export_root_configs
test_direct_harness_installers_convert_root_symlinks
test_old_repo_managed_symlinks_are_migrated
test_direct_claude_installer_removes_stale_retired_symlink
test_verify_install_requires_active_root_configs
test_dry_run_collision_no_mutation
test_noninteractive_block_no_mutation
test_non_root_conflict_stages_with_policy
test_global_command_conflict_blocks_before_mutation
test_direct_harness_conflict_dry_run_reports
test_mode_prompt_allows_adopt_on_clean_machine
test_mode_prompt_allows_managed_selection
test_onboarding_wizard_toggles_and_applies
test_managed_mode_backs_up_existing_configs
test_adopt_keep_originals_prints_merge_prompt
test_adopt_overwrite_policy_backs_up_originals
test_abort_no_config_replacement
test_uninstall_removes_repo_owned_links
test_idempotency_no_extra_backups
test_malformed_claude_config
test_sync_guard
test_sync_interactive_choices
test_sync_overwrite_rollback_on_replace_failure
test_windows_installer_root_preflight_order
test_repo_local_codex_skill_layer_present
test_write_guard_root_config_message

echo "all install collision tests passed"

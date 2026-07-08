#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ROBOREPO_UNINSTALL_PROCESS_ROOT="${TMPDIR:-/tmp}/roborepo-test-process-root-never-match-$$"

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

assert_absent() {
  local path="$1"
  local label="$2"

  [[ ! -e "$path" && ! -L "$path" ]] && pass "$label" || fail "$label"
}

assert_regular_file_contains() {
  local file="$1"
  local pattern="$2"
  local label="$3"

  [[ -f "$file" && ! -L "$file" ]] || fail "$label"
  assert_file_contains "$file" "$pattern" "$label"
}

# A roborepo-managed skill is a symlink in the harness view pointing at the machine-local cache.
# The cache copy itself carries the '.roborepo-managed' marker.
assert_managed_skill() {
  local home_dir="$1"
  local skill_path="$2"
  local source_dir="$3"
  local label="$4"

  local cache_path="${home_dir}/.roborepo/skills/$(basename "$skill_path")"
  if [[ -L "$skill_path" && "$(readlink "$skill_path")" == "$cache_path" ]] \
    && [[ -d "$cache_path" && -e "$cache_path/.roborepo-managed" ]] \
    && diff -rq -x '.roborepo-managed' "$source_dir" "$cache_path" >/dev/null 2>&1; then
    pass "$label"
  else
    fail "$label"
  fi
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
  node -e '
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.exit(state.onboardedAt ? 0 : 1);
' "$home_dir/.roborepo/presets/state.json" \
    && pass "noninteractive onboard runs headlessly" \
    || fail "noninteractive onboard runs headlessly" "$home_dir/out"
  [[ -e "$home_dir/.claude/settings.json" && -e "$home_dir/.codex/config.toml" ]] \
    && pass "main install applies harness root config automatically" \
    || fail "main install applies harness root config automatically"
}

test_conflict_policy_prompt_on_clean_machine() {
  local home_dir expect_file
  home_dir="$(make_home)"
  expect_file="$home_dir/expect.tcl"
  # Covers the conflict-policy prompt only; onboarding is skipped (see run_expect_install).
  cat >"$expect_file" <<'EOF'
expect "Welcome to roborepo"
expect "Selection*"
send "2\r"
EOF

  run_expect_install "$home_dir" "$home_dir/out" "$expect_file"

  assert_file_contains "$home_dir/out" "state: .* on-conflict=keep" "adopt keep policy is persisted"
  assert_file_contains "$home_dir/out" "Base Configuration" "install applies base configuration after core install"
  [[ -f "$home_dir/.roborepo/presets/state.json" ]] \
    && pass "post-install default apply records preset state" \
    || fail "post-install default apply records preset state" "$home_dir/out"
}

# End-to-end coverage of the interactive onboarding wizard: a real keypress toggles an item (instant
# in-memory flip), and on exit the deferred batch apply runs after raw mode is off and applies only
# the changed item. The pure diff selection is unit-tested separately (wizard-diff-check.mjs).
test_onboarding_wizard_toggles_and_applies() {
  local home_dir
  home_dir="$(make_home)"
  local claude_settings_backup
  claude_settings_backup="$(mktemp "${home_dir}/claude-settings.XXXXXX")"
  cp "$repo_root/globals/claude/settings.json" "$claude_settings_backup"
  trap 'cp "$claude_settings_backup" "$repo_root/globals/claude/settings.json" 2>/dev/null || true' RETURN
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
expect "Launch the local web portal now?"
send "n\r"
expect eof
EOF

  assert_file_contains "$home_dir/wiz.out" "Applying changes" "wizard runs deferred batch apply after a toggle"
  assert_file_not_contains "$home_dir/wiz.out" "failed:" "wizard toggle applies without error"
  assert_file_contains "$home_dir/wiz.out" "Onboarding complete" "wizard finishes cleanly"
  trap - RETURN
  cp "$claude_settings_backup" "$repo_root/globals/claude/settings.json"
}

test_overwrite_policy_backs_up_existing_configs() {
  local home_dir
  home_dir="$(make_home)"
  seed_user_configs "$home_dir"

  run_harness_install_args "$home_dir" "$home_dir/out" --on-conflict overwrite

  assert_file_contains "$home_dir/out" "backup: $home_dir/.claude/settings.json" "overwrite backs up existing Claude config"
  assert_file_contains "$home_dir/out" "backup: $home_dir/.codex/config.toml" "overwrite backs up existing Codex config"
  assert_file_contains "$home_dir/out" "Merge review prompt:" "overwrite prints merge review prompt"
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
  assert_not_symlink "$home_dir/.claude/CLAUDE.md" "direct Claude installer copies read-mostly assets (not symlinks)"
  assert_not_symlink "$home_dir/.codex/AGENTS.md" "direct Codex installer copies read-mostly assets (not symlinks)"
  assert_managed_skill "$home_dir" "$home_dir/.codex/skills/roborepo-support" "$repo_root/globals/agents/skills/roborepo-support" "direct Codex installer links base support skill through ~/.roborepo/skills"
  assert_absent "$home_dir/.codex/skills/case-study" "direct Codex installer does not copy optional skills by default"
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

  run_harness_install_args "$home_dir" "$home_dir/out" --on-conflict overwrite

  assert_regular_file_contains "$home_dir/.claude/settings.json" "permissions" "old Claude root config symlink converts to local file"
  assert_regular_file_contains "$home_dir/.codex/config.toml" "mcp_servers.jcodemunch" "old Codex root config symlink converts to local file"
  assert_not_symlink "$home_dir/.claude/CLAUDE.md" "old Claude asset symlink migrated to managed copy"
  assert_not_symlink "$home_dir/.claude/hooks" "old Claude hooks symlink migrated to managed copy"
  assert_not_symlink "$home_dir/.codex/AGENTS.md" "old Codex AGENTS symlink migrated to managed copy"
  assert_not_symlink "$home_dir/.codex/hooks.json" "old Codex hooks symlink migrated to managed copy"
  assert_not_symlink "$home_dir/.codex/rules" "old Codex rules symlink migrated to managed copy"
  # Old dir-level ~/.claude/skills symlink is cleaned up by the migration cleanup row.
  # Old ~/.agents/skills and transitional ~/.codex/skills dir-level symlinks are no longer managed.
  # After install, ~/.codex/skills/ and ~/.claude/skills/ point at the machine-local cache.
  assert_managed_skill "$home_dir" "$home_dir/.codex/skills/roborepo-support" "$repo_root/globals/agents/skills/roborepo-support" "old machine migrated: base Codex support skill cache link created"
  assert_managed_skill "$home_dir" "$home_dir/.claude/skills/roborepo-support" "$repo_root/globals/agents/skills/roborepo-support" "old machine migrated: base Claude support skill cache link created"
  assert_absent "$home_dir/.codex/skills/case-study" "old machine migrated: optional Codex skill not copied by default"
  assert_absent "$home_dir/.claude/skills/case-study" "old machine migrated: optional Claude skill not copied by default"
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
  assert_file_contains "$home_dir/out" "dry-run: would ask overwrite or keep originals" "dry-run previews collision choice"
  [[ ! -L "$home_dir/.claude/settings.json" && ! -L "$home_dir/.codex/config.toml" ]] && pass "dry-run leaves config files untouched" || fail "dry-run leaves config files untouched"
  [[ ! -e "$home_dir/.claude/settings_update_"* && ! -e "$home_dir/.roborepo-backups" ]] && pass "dry-run creates no backups or staged updates" || fail "dry-run creates no backups or staged updates"
}

test_noninteractive_block_no_mutation() {
  local home_dir
  home_dir="$(make_home)"
  seed_user_configs "$home_dir"

  if run_harness_install_args "$home_dir" "$home_dir/out"; then
    fail "noninteractive collision blocks install" "$home_dir/out"
  fi

  assert_file_contains "$home_dir/out" "stdin is not interactive" "noninteractive collision explains failure"
  [[ ! -e "$home_dir/.claude/CLAUDE.md" && ! -e "$home_dir/.codex/AGENTS.md" ]] && pass "noninteractive block prevents partial install" || fail "noninteractive block prevents partial install"
}

test_rendered_rules_backup_then_render() {
  local home_dir
  home_dir="$(make_home)"
  printf 'existing agents\n' > "$home_dir/.codex/AGENTS.md"

  HOME="$home_dir" "$repo_root/scripts/install/install-codex.sh" --on-conflict keep >"$home_dir/out" 2>&1

  assert_file_contains "$home_dir/.codex/AGENTS.md" "# Generated Harness Rules" "rendered_rules writes generated home file"
  assert_file_contains "$home_dir/out" "snapshot of 1 original config path\\(s\\)" "rendered_rules snapshots the pre-existing user file"
  pass "rendered_rules preserves pre-existing user file"
  [[ -f "$home_dir/.codex/config.toml" ]] \
    && pass "rendered_rules install still installs missing Codex files" \
    || fail "rendered_rules install still installs missing Codex files"
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

  HOME="$home_dir" "$repo_root/scripts/install/install-codex.sh" --dry-run >"$home_dir/out" 2>&1

  assert_file_contains "$home_dir/out" "would snapshot 1 original config path\\(s\\)" "direct Codex dry-run reports rendered rules backup"
  assert_file_contains "$home_dir/out" "would render: $home_dir/.codex/AGENTS.md" "direct Codex dry-run reports rendered rules output"
  [[ ! -e "$home_dir/.codex/config.toml" && ! -e "$home_dir/.codex/hooks.json" ]] \
    && pass "direct Codex dry-run prevents mutation" \
    || fail "direct Codex dry-run prevents mutation"
}

test_adopt_keep_originals_prints_merge_prompt() {
  local home_dir
  home_dir="$(make_home)"
  seed_user_configs "$home_dir"

  run_harness_install_args "$home_dir" "$home_dir/out" --on-conflict keep

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

  run_harness_install_args "$home_dir" "$home_dir/out" --on-conflict overwrite

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

  if run_harness_install_args "$home_dir" "$home_dir/out" --on-conflict abort; then
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
    && pass "uninstall removes Claude managed copy" \
    || fail "uninstall removes Claude managed copy"
  [[ ! -e "$home_dir/.codex/AGENTS.md" && ! -L "$home_dir/.codex/AGENTS.md" ]] \
    && pass "uninstall removes Codex managed copy" \
    || fail "uninstall removes Codex managed copy"
  [[ ! -e "$home_dir/.claude/settings.json" && ! -e "$home_dir/.codex/config.toml" ]] \
    && pass "uninstall removes roborepo-created root configs" \
    || fail "uninstall removes roborepo-created root configs"
  [[ ! -f "$home_dir/.roborepo/install-state.json" ]] \
    && pass "uninstall removes install state" \
    || fail "uninstall removes install state"
}

test_uninstall_reclaims_repo_copies_and_restores_originals() {
  local home_dir
  home_dir="$(make_home)"

  # User-authored CLAUDE.md present before install — must come back verbatim after uninstall.
  printf 'my own claude rules\n' > "$home_dir/.claude/CLAUDE.md"

  # Install with overwrite: managed_copy rows are installed as REAL copies; the pre-existing CLAUDE.md
  # is persisted to the pre-install backup.
  run_harness_install_args "$home_dir" "$home_dir/install.out" --on-conflict overwrite

  assert_not_symlink "$home_dir/.codex/AGENTS.md" "install writes AGENTS.md as a real copy"
  assert_file_contains "$home_dir/install.out" "snapshot of 1 original config path\\(s\\)" "install persists pre-existing CLAUDE.md to pre-install backup"

  HOME="$home_dir" "$repo_root/scripts/install/uninstall.sh" >"$home_dir/uninstall.out"

  # AGENTS.md was a roborepo copy with no user original underneath -> reclaimed entirely.
  [[ ! -e "$home_dir/.codex/AGENTS.md" && ! -L "$home_dir/.codex/AGENTS.md" ]] \
    && pass "uninstall reclaims AGENTS.md managed copy" \
    || fail "uninstall reclaims AGENTS.md managed copy" "$home_dir/uninstall.out"
  # CLAUDE.md had a user original -> restored verbatim.
  assert_regular_file_contains "$home_dir/.claude/CLAUDE.md" "my own claude rules" "uninstall restores user's original CLAUDE.md"
}

test_uninstall_preserves_user_modified_copy() {
  local home_dir
  home_dir="$(make_home)"

  run_harness_install_args "$home_dir" "$home_dir/install.out" --on-conflict overwrite
  # User edits the installed copy after install — content now diverges from the repo source.
  printf 'user edit\n' >> "$home_dir/.codex/AGENTS.md"

  HOME="$home_dir" "$repo_root/scripts/install/uninstall.sh" >"$home_dir/uninstall.out"

  [[ -f "$home_dir/.codex/AGENTS.md" && ! -L "$home_dir/.codex/AGENTS.md" ]] \
    && grep -q "user edit" "$home_dir/.codex/AGENTS.md" \
    && pass "uninstall keeps a user-modified copy (content diverged from repo)" \
    || fail "uninstall keeps a user-modified copy (content diverged from repo)" "$home_dir/uninstall.out"
}

test_uninstall_reclaims_real_dir_link_remnant() {
  local home_dir
  home_dir="$(make_home)"

  # Simulate a legacy/materialized link: a REAL ~/.codex/hooks dir holding roborepo's own content
  # (the bug we found — uninstall's symlink-only pass used to skip it).
  cp -R "$repo_root/globals/codex/hooks" "$home_dir/.codex/hooks"
  HOME="$home_dir" "$repo_root/scripts/install/uninstall.sh" >"$home_dir/uninstall.out"

  [[ ! -e "$home_dir/.codex/hooks" ]] \
    && pass "uninstall reclaims a real-dir roborepo copy left at a link path" \
    || fail "uninstall reclaims a real-dir roborepo copy left at a link path" "$home_dir/uninstall.out"
}

test_uninstall_removes_runtime_state_and_backups() {
  local home_dir
  home_dir="$(make_home)"

  run_harness_install_args "$home_dir" "$home_dir/install.out" --on-conflict overwrite
  mkdir -p \
    "$home_dir/.roborepo/telemetry/spool" \
    "$home_dir/.roborepo/telemetry-backups/telemetry-old" \
    "$home_dir/.roborepo/backups/pre-install/claude" \
    "$home_dir/.local/state/roborepo" \
    "$home_dir/.roborepo-backups/20260621-174033"
  printf '{"behaviors":{"delete-files":"allow"},"commands":{}}\n' > "$home_dir/.roborepo/command-overrides.json"
  printf '{"packages":["jcodemunch"]}\n' > "$home_dir/.roborepo/enabled-packages.json"
  printf '{"enabled":true}\n' > "$home_dir/.roborepo/telemetry/state.json"
  printf 'event\n' > "$home_dir/.roborepo/telemetry/spool/claude.jsonl"
  printf '12345\n' > "$home_dir/.local/state/roborepo/portal-server.pid"
  printf '12345\n' > "$home_dir/.local/state/roborepo/telemetry-server.pid"
  printf 'backup\n' > "$home_dir/.roborepo-backups/20260621-174033/file"

  HOME="$home_dir" "$repo_root/scripts/install/uninstall.sh" >"$home_dir/uninstall.out"

  assert_absent "$home_dir/.roborepo/command-overrides.json" "uninstall removes command override state"
  assert_absent "$home_dir/.roborepo/enabled-packages.json" "uninstall removes enabled packages state"
  assert_absent "$home_dir/.roborepo/telemetry" "uninstall removes telemetry data"
  assert_absent "$home_dir/.roborepo/telemetry-backups" "uninstall removes telemetry backups"
  assert_absent "$home_dir/.local/state/roborepo/portal-server.pid" "uninstall removes portal PID file"
  assert_absent "$home_dir/.local/state/roborepo/telemetry-server.pid" "uninstall removes legacy telemetry PID file"
  assert_absent "$home_dir/.roborepo-backups" "uninstall removes durable install backups"
  HOME="$home_dir" "$repo_root/scripts/install/uninstall.sh" --check-clean >"$home_dir/check.out" \
    && pass "check-clean passes after uninstall" \
    || fail "check-clean passes after uninstall" "$home_dir/check.out"
}

test_uninstall_check_clean_reports_remnant() {
  local home_dir
  home_dir="$(make_home)"
  mkdir -p "$home_dir/.roborepo/telemetry"
  printf '{"enabled":true}\n' > "$home_dir/.roborepo/telemetry/state.json"

  if HOME="$home_dir" "$repo_root/scripts/install/uninstall.sh" --check-clean >"$home_dir/check.out" 2>&1; then
    fail "check-clean fails when telemetry state remains" "$home_dir/check.out"
  fi
  assert_file_contains "$home_dir/check.out" "remnant: $home_dir/.roborepo/telemetry" "check-clean names telemetry remnant"
}

test_uninstall_stops_repo_owned_processes() {
  local home_dir pid process_root
  home_dir="$(make_home)"
  process_root="$home_dir/process-root"

  if ! ps -ax -o pid=,command= >/dev/null 2>&1; then
    pass "uninstall stops repo-owned serve process (skipped: process list unavailable)"
    return
  fi

  bash -c "exec -a '$process_root/scripts/cli/main.mjs serve --no-open --port 19999' sleep 30" &
  pid=$!
  ROBOREPO_UNINSTALL_PROCESS_ROOT="$process_root" HOME="$home_dir" "$repo_root/scripts/install/uninstall.sh" >"$home_dir/uninstall.out"
  sleep 0.3

  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    fail "uninstall stops repo-owned serve process" "$home_dir/uninstall.out"
  fi
  pass "uninstall stops repo-owned serve process"
}

test_install_writes_durable_original_snapshot() {
  local home_dir archive
  home_dir="$(make_home)"
  archive="$home_dir/.roborepo-backups/pre-roborepo-original.tar.gz"

  # Genuine pre-roborepo originals the snapshot must capture.
  seed_user_configs "$home_dir"
  printf 'my own claude rules\n' > "$home_dir/.claude/CLAUDE.md"
  printf '# my shell\n' > "$home_dir/.zshrc"

  run_harness_install_args "$home_dir" "$home_dir/install.out" --on-conflict keep

  [[ -f "$archive" ]] \
    && pass "install writes durable pre-roborepo snapshot" \
    || fail "install writes durable pre-roborepo snapshot" "$home_dir/install.out"
  local listing
  listing="$(tar tzf "$archive" 2>/dev/null)"
  grep -q '\.claude/CLAUDE.md$' <<<"$listing" && grep -q '\.claude/settings.json$' <<<"$listing" \
    && grep -q '\.codex/config.toml$' <<<"$listing" && grep -q '\.zshrc$' <<<"$listing" \
    && pass "snapshot bundles the originals roborepo can touch" \
    || { echo "$listing" >&2; fail "snapshot bundles the originals roborepo can touch"; }

  # The captured CLAUDE.md is the user's original, not roborepo's.
  mkdir -p "$home_dir/extract"
  tar xzf "$archive" -C "$home_dir/extract"
  assert_file_contains "$home_dir/extract/.claude/CLAUDE.md" "my own claude rules" "snapshot preserves the user's original CLAUDE.md"

  # Once-only: a second install must not rewrite the pristine image.
  local before after
  before="$(stat -f %m "$archive" 2>/dev/null || stat -c %Y "$archive")"
  printf 'roborepo changed this later\n' > "$home_dir/.zshrc"
  run_harness_install_args "$home_dir" "$home_dir/install2.out" --on-conflict keep
  after="$(stat -f %m "$archive" 2>/dev/null || stat -c %Y "$archive")"
  [[ "$before" == "$after" ]] \
    && pass "durable snapshot is written once and never overwritten" \
    || fail "durable snapshot is written once and never overwritten"
}

test_idempotency_no_extra_backups() {
  local home_dir
  home_dir="$(make_home)"

  run_harness_install_args "$home_dir" "$home_dir/first.out"
  run_harness_install_args "$home_dir" "$home_dir/second.out"

  assert_file_contains "$home_dir/second.out" "ok: $home_dir/.claude/settings.json" "idempotent Claude config ok"
  assert_file_contains "$home_dir/second.out" "ok: $home_dir/.codex/config.toml" "idempotent Codex config ok"
  ! find "$home_dir/.roborepo-backups" -name settings.json -o -name config.toml 2>/dev/null | grep -q . \
    && pass "idempotent re-install creates no config backups" \
    || fail "idempotent re-install creates no config backups"
}

# Root config drift detection (scripts/cli/root-config-state.mjs, wired into export_user_config in
# install-lib.sh): a byte mismatch against the repo baseline should only be treated as a user
# collision when the file also drifted from what roborepo itself last wrote. A baseline change
# alone (simulated here by editing the local root config to something roborepo did NOT write, using
# a fresh state dir so no prior write is recorded) must still hit the ordinary collision path —
# this test's job is the opposite case: a file matching roborepo's last recorded write updates
# silently even though it no longer matches the *current* repo source.
test_root_config_drift_silent_update_vs_real_collision() {
  local home_dir
  home_dir="$(make_home)"

  run_harness_install_args "$home_dir" "$home_dir/first.out"
  [[ -f "$home_dir/.roborepo/config-state/root-config.json" ]] \
    && pass "install records root-config-state sidecar" \
    || fail "install records root-config-state sidecar"

  # Simulate the repo baseline changing between installs without the user touching the local file:
  # append a byte to the *local* file's content is indistinguishable from a user edit, so instead
  # directly assert the recorded hash matches what's on disk right now (this is what "clean" means).
  HOME="$home_dir" node "$repo_root/scripts/cli/root-config-state.mjs" check claude "$home_dir/.claude/settings.json" \
    | grep -q "^clean$" \
    && pass "freshly installed root config reports clean drift status" \
    || fail "freshly installed root config reports clean drift status"

  # A genuine user edit after install must be detected as drift, not silently overwritten or folded
  # into a "baseline changed" no-op on the next install/update.
  printf '\n' >> "$home_dir/.claude/settings.json"
  echo '// user note' >> "$home_dir/.claude/settings.json" 2>/dev/null || true
  HOME="$home_dir" node "$repo_root/scripts/cli/root-config-state.mjs" check claude "$home_dir/.claude/settings.json" \
    | grep -q "^drifted$" \
    && pass "user edit after install is reported as drift" \
    || fail "user edit after install is reported as drift"

  run_harness_install_args "$home_dir" "$home_dir/second.out" --on-conflict overwrite
  assert_file_contains "$home_dir/second.out" "backup: $home_dir/.claude/settings.json" \
    "drifted root config still goes through the ordinary collision path on next install"
}

# Regression test: export_user_config must NOT record a write when install_copy_item took the
# "keep" branch, since "keep" leaves home_path exactly as the user had it (stages the repo
# candidate as a *_update_TIMESTAMP sibling instead). Recording a write there would falsely mark a
# drifted, user-owned file as roborepo-clean, permanently hiding the drift on the next check.
test_root_config_keep_policy_does_not_record_false_clean() {
  local home_dir
  home_dir="$(make_home)"

  run_harness_install_args "$home_dir" "$home_dir/first.out" --on-conflict overwrite
  HOME="$home_dir" node "$repo_root/scripts/cli/root-config-state.mjs" check claude "$home_dir/.claude/settings.json" \
    | grep -q "^clean$" \
    && pass "fresh install records a clean baseline" \
    || fail "fresh install records a clean baseline"

  # User edits the file after install — this is real drift.
  printf '{"user":"drifted edit"}\n' > "$home_dir/.claude/settings.json"
  HOME="$home_dir" node "$repo_root/scripts/cli/root-config-state.mjs" check claude "$home_dir/.claude/settings.json" \
    | grep -q "^drifted$" \
    && pass "user edit is detected as drift before reinstall" \
    || fail "user edit is detected as drift before reinstall"

  # Reinstall with --on-conflict keep: home_path must stay untouched, and the drift status must
  # NOT reset to clean, since roborepo did not actually (re)write home_path on this path.
  run_harness_install_args "$home_dir" "$home_dir/second.out" --on-conflict keep
  assert_file_contains "$home_dir/.claude/settings.json" "user.*drifted edit" \
    "keep policy leaves the user's drifted file untouched"
  HOME="$home_dir" node "$repo_root/scripts/cli/root-config-state.mjs" check claude "$home_dir/.claude/settings.json" \
    | grep -q "^drifted$" \
    && pass "keep policy does not falsely clear drift status" \
    || fail "keep policy does not falsely clear drift status"
}

# Uninstall drift-awareness (docs/plans/root-config-layered-inheritance.md, "Uninstall", step 5):
# a root_config the user hand-edited after roborepo's last write (sidecar hash no longer matches)
# must be left in place with its path reported, not deleted — even though is_roborepo_authored still
# matches the markers underneath the edit. A clean roborepo-written root_config is still removed.
test_uninstall_preserves_drifted_root_config() {
  local home_dir
  home_dir="$(make_home)"

  run_harness_install_args "$home_dir" "$home_dir/install.out" --on-conflict overwrite
  HOME="$home_dir" node "$repo_root/scripts/cli/root-config-state.mjs" check claude "$home_dir/.claude/settings.json" \
    | grep -q "^clean$" \
    && pass "install records a clean root-config baseline" \
    || fail "install records a clean root-config baseline"

  # User edits the installed Claude config after install — real drift against the sidecar hash. The
  # edit keeps a roborepo marker so is_roborepo_authored still matches, isolating the drift gate as
  # the only reason the file survives. Codex config is left untouched (stays clean) as the control.
  printf '{"MANAGED_BY_ROBOREPO":true,"user":"edited after install"}\n' > "$home_dir/.claude/settings.json"
  HOME="$home_dir" node "$repo_root/scripts/cli/root-config-state.mjs" check claude "$home_dir/.claude/settings.json" \
    | grep -q "^drifted$" \
    && pass "user edit to root config is detected as drift before uninstall" \
    || fail "user edit to root config is detected as drift before uninstall"

  HOME="$home_dir" "$repo_root/scripts/install/uninstall.sh" >"$home_dir/uninstall.out"

  [[ -f "$home_dir/.claude/settings.json" ]] \
    && grep -q "edited after install" "$home_dir/.claude/settings.json" \
    && pass "uninstall preserves a drifted root config" \
    || fail "uninstall preserves a drifted root config" "$home_dir/uninstall.out"
  assert_file_contains "$home_dir/uninstall.out" "skip drifted root_config.*$home_dir/.claude/settings.json" \
    "uninstall reports the drifted root config path it left in place"
  # The clean Codex config (never edited) is still removed — drift-awareness must not block ordinary
  # cleanup of files roborepo's own last write still owns.
  assert_absent "$home_dir/.codex/config.toml" "uninstall still removes a clean roborepo root config"
}

# After a real uninstall that deliberately leaves a drifted root config behind, --check-clean must
# still pass: the runtime-state cleanup has removed the sidecar, so drift now reports "unwritten"
# for the kept file, and the root_config remnant branch only flags a "clean" leftover — a drifted
# (unwritten-after-cleanup) file is correctly not counted as an active remnant.
test_uninstall_check_clean_tolerates_drifted_root_config() {
  local home_dir
  home_dir="$(make_home)"

  run_harness_install_args "$home_dir" "$home_dir/install.out" --on-conflict overwrite
  # Drift the Claude config; keep a roborepo marker so is_roborepo_authored still matches (that is
  # what would otherwise make check-clean call it a remnant).
  printf '{"MANAGED_BY_ROBOREPO":true,"user":"edited after install"}\n' > "$home_dir/.claude/settings.json"

  HOME="$home_dir" "$repo_root/scripts/install/uninstall.sh" >"$home_dir/uninstall.out"
  [[ -f "$home_dir/.claude/settings.json" ]] \
    && pass "uninstall left the drifted root config in place" \
    || fail "uninstall left the drifted root config in place" "$home_dir/uninstall.out"

  HOME="$home_dir" "$repo_root/scripts/install/uninstall.sh" --check-clean >"$home_dir/check.out" 2>&1 \
    && pass "check-clean passes with a drifted root config left in place" \
    || fail "check-clean passes with a drifted root config left in place" "$home_dir/check.out"
}

test_malformed_claude_config() {
  local home_dir
  home_dir="$(make_home)"
  printf '{bad json\n' > "$home_dir/.claude/settings.json"
  printf 'model = "o3"\n' > "$home_dir/.codex/config.toml"

  HOME="$home_dir" "$repo_root/scripts/install/install-claude.sh" --dry-run >"$home_dir/out"

  assert_file_contains "$home_dir/out" "invalid JSON" "malformed Claude config is reported"
  assert_file_contains "$home_dir/out" "collision: $home_dir/.claude/settings.json" "malformed Claude config still prompts"
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

# The Windows installer's root_config collision menu lives in ONE shared helper
# (Invoke-RootConfigCollisionPrompt), called by both the preflight (Resolve-UserConfigCollision) and
# Export-UserConfig's fallback — no second hand-maintained copy of the adopt/merge/quit prompt. And
# the preflight is drift-aware: a clean baseline change (drift status "clean") must NOT be treated as
# a collision, matching install-lib.sh so a routine baseline update doesn't wrongly prompt on Windows.
# Static assertions (no PowerShell runtime on the test host), the same style as the preflight-order test.
test_windows_installer_root_collision_dedup_and_drift() {
  local windows_script prompt_defs preflight_body
  windows_script="$repo_root/scripts/install/install-windows.ps1"

  # Exactly one function defines the interactive collision menu.
  prompt_defs="$(grep -c '^function Invoke-RootConfigCollisionPrompt' "$windows_script")"
  [[ "$prompt_defs" -eq 1 ]] \
    && pass "Windows installer defines one shared root-config collision prompt" \
    || fail "Windows installer defines one shared root-config collision prompt" "$windows_script"

  # Both entry points call the shared helper rather than inlining the menu. The menu's distinctive
  # "1) adopt" line must appear only inside the shared helper (one occurrence total).
  assert_file_contains "$windows_script" 'Invoke-RootConfigCollisionPrompt \$Harness \$RepoRel \$HomePath' \
    "Windows installer routes collisions through the shared prompt helper"
  local adopt_lines
  adopt_lines="$(grep -c '1) adopt' "$windows_script")"
  [[ "$adopt_lines" -eq 1 ]] \
    && pass "Windows installer no longer duplicates the collision menu text" \
    || fail "Windows installer no longer duplicates the collision menu text ($adopt_lines copies)" "$windows_script"

  # Preflight consults drift and skips clean baseline changes.
  preflight_body="$(awk '/^function Resolve-UserConfigCollision/{f=1} f{print} /^}/{if(f)exit}' "$windows_script")"
  grep -q 'Get-RootConfigDriftStatus' <<<"$preflight_body" \
    && grep -q 'driftStatus -eq "clean"' <<<"$preflight_body" \
    && pass "Windows preflight treats a clean baseline change as no collision" \
    || fail "Windows preflight treats a clean baseline change as no collision" "$windows_script"
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
test_rendered_rules_backup_then_render
test_global_command_conflict_blocks_before_mutation
test_direct_harness_conflict_dry_run_reports
test_conflict_policy_prompt_on_clean_machine
test_onboarding_wizard_toggles_and_applies
test_overwrite_policy_backs_up_existing_configs
test_adopt_keep_originals_prints_merge_prompt
test_adopt_overwrite_policy_backs_up_originals
test_abort_no_config_replacement
test_uninstall_removes_repo_owned_links
test_install_writes_durable_original_snapshot
test_uninstall_reclaims_repo_copies_and_restores_originals
test_uninstall_preserves_user_modified_copy
test_uninstall_reclaims_real_dir_link_remnant
test_uninstall_removes_runtime_state_and_backups
test_uninstall_check_clean_reports_remnant
test_uninstall_stops_repo_owned_processes
test_idempotency_no_extra_backups
test_root_config_drift_silent_update_vs_real_collision
test_root_config_keep_policy_does_not_record_false_clean
test_uninstall_preserves_drifted_root_config
test_uninstall_check_clean_tolerates_drifted_root_config
test_malformed_claude_config
test_windows_installer_root_preflight_order
test_windows_installer_root_collision_dedup_and_drift
test_repo_local_codex_skill_layer_present
test_write_guard_root_config_message

echo "all install collision tests passed"

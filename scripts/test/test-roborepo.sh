#!/usr/bin/env bash
set -euo pipefail

# Functional smoke tests for roborepo (skill export-to-project/link-project/sync-global, rules, run,
# lifecycle dispatch).
# Runs subcommands against throwaway temp repos and fake HOME roots, then asserts on results.
#
# Usage: scripts/test/test-roborepo.sh

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cli="${repo_root}/scripts/cli/main.mjs"
pass=0
fail=0
quiet=0
cfg_srv=""

# --quiet|-q : suppress per-test "ok:" lines; still print every FAIL + the summary.
for arg in "$@"; do
  case "${arg}" in
    --quiet|-q) quiet=1 ;;
    *) echo "usage: $0 [--quiet|-q]" >&2; exit 2 ;;
  esac
done

work="$(mktemp -d "${TMPDIR:-/tmp}/roborepo-test.XXXXXX")"
# Cleanup must never change the suite's exit status: some tests chmod dirs to 000 (permission
# checks), so `rm -rf` can hit "Directory not empty". Restore write perms, ignore rm errors, and
# preserve the real exit code (the pass/fail tally) so CI reflects the tests, not the cleanup.
cleanup() {
  local status=$?
  if [[ -n "${cfg_srv:-}" ]]; then
    kill "${cfg_srv}" 2>/dev/null || true
  fi
  chmod -R u+rwx "${work}" 2>/dev/null || true
  rm -rf "${work}" 2>/dev/null || true
  exit "${status}"
}
trap cleanup EXIT
export ROBOREPO_PRESETS_ONBOARD=skip

assert() {
  local label="$1"; shift
  if "$@"; then
    [[ "${quiet}" -eq 0 ]] && echo "ok: ${label}"
    pass=$((pass + 1))
  else
    echo "FAIL: ${label}" >&2
    fail=$((fail + 1))
  fi
}

assert "source layout: globals shared skills exist" test -d "${repo_root}/globals/agents/skills"
assert "source layout: globals Claude source exists" test -d "${repo_root}/globals/claude"
assert "source layout: globals Codex source exists" test -d "${repo_root}/globals/codex"
assert "source layout: globals Codex commands exist" test -d "${repo_root}/globals/codex/commands"
assert "source layout: local internal skills exist" test -d "${repo_root}/local/skills"
assert "source layout: legacy agents root absent" bash -c "! test -e '${repo_root}/agents'"
assert "source layout: legacy claude root absent" bash -c "! test -e '${repo_root}/claude'"
assert "source layout: legacy codex root absent" bash -c "! test -e '${repo_root}/codex'"
assert "source layout: legacy skills-local root absent" bash -c "! test -e '${repo_root}/skills-local'"

mk_skill() {
  local dir="$1" name="$2"
  mkdir -p "${dir}/${name}"
  printf -- '---\nname: %s\ndescription: test\n---\n' "${name}" > "${dir}/${name}/SKILL.md"
}

assert_skill_cache_link() {
  local home_dir="$1" harness="$2" skill="$3" source_dir="$4" label="$5"
  local view="${home_dir}/.${harness}/skills/${skill}"
  local cache="${home_dir}/.roborepo/skills/${skill}"

  if [[ -L "${view}" && "$(realpath "${view}")" == "$(realpath "${cache}")" ]] \
    && [[ -d "${cache}" && -e "${cache}/.roborepo-managed" ]] \
    && diff -rq -x '.roborepo-managed' "${source_dir}" "${cache}" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------
# roborepo skill link-project
# ---------------------------------------------------------------------------
local_repo="${work}/local"
mkdir -p "${local_repo}/.claude" "${local_repo}/.codex"
mk_skill "${local_repo}/.codex/skills" "app-deploy"
mk_skill "${local_repo}/.codex/skills" "app-test"

( cd "${local_repo}" && node "${cli}" skill link-project >/dev/null )
assert "skill link-project: .claude link created" test -L "${local_repo}/.claude/skills/app-deploy"
assert "skill link-project: link points into .codex/skills source" \
  test "$(readlink "${local_repo}/.claude/skills/app-deploy")" = "../../.codex/skills/app-deploy"
assert "skill link-project: no circular .codex link created" \
  bash -c "! test -L '${local_repo}/.codex/skills/app-deploy'"

rerun="$( cd "${local_repo}" && node "${cli}" skill link-project )"
assert "skill link-project: idempotent re-run reports already ok" \
  bash -c "echo '${rerun}' | grep -q 'already ok'"

# Prune: delete a source skill, re-run, stale .claude link removed.
rm -rf "${local_repo}/.codex/skills/app-test"
( cd "${local_repo}" && node "${cli}" skill link-project >/dev/null )
assert "skill link-project: orphan .claude link pruned" \
  bash -c "! test -e '${local_repo}/.claude/skills/app-test'"
assert "skill link-project: live link kept after prune" test -L "${local_repo}/.claude/skills/app-deploy"

# Uninstall: removes only owned links.
( cd "${local_repo}" && node "${cli}" skill link-project --uninstall >/dev/null )
assert "skill link-project: uninstall removes owned links" \
  bash -c "! test -e '${local_repo}/.claude/skills/app-deploy'"

# Dry-run: reports planned links without creating harness skill dirs.
dry_repo="${work}/dry-link"
mkdir -p "${dry_repo}/.claude" "${dry_repo}/.codex"
mk_skill "${dry_repo}/.codex/skills" "app-deploy"
( cd "${dry_repo}" && node "${cli}" skill link-project --dry-run >/dev/null )
assert "skill link-project: dry-run does not create .claude link" \
  bash -c "! test -e '${dry_repo}/.claude/skills/app-deploy'"

no_claude_repo="${work}/no-claude-target"
mk_skill "${no_claude_repo}/.codex/skills" "app-deploy"
( cd "${no_claude_repo}" && node "${cli}" skill link-project >/dev/null )
assert "skill link-project: skips .claude link when .claude root is absent" \
  bash -c "! test -L '${no_claude_repo}/.claude/skills/app-deploy'"
assert "skill link-project: .codex source untouched when no .claude" \
  bash -c "test -d '${no_claude_repo}/.codex/skills/app-deploy'"

# Conflict: a real (non-symlink) dir at the target is never clobbered.
conflict_repo="${work}/conflict"
mk_skill "${conflict_repo}/.codex/skills" "app-deploy"
mkdir -p "${conflict_repo}/.claude/skills/app-deploy"
echo "REAL" > "${conflict_repo}/.claude/skills/app-deploy/marker"
( cd "${conflict_repo}" && node "${cli}" skill link-project >/dev/null 2>&1 ) || true
assert "skill link-project: real dir at target left intact (conflict)" \
  test -f "${conflict_repo}/.claude/skills/app-deploy/marker"

foreign_repo="${work}/foreign-link"
mk_skill "${foreign_repo}/.codex/skills" "app-deploy"
mkdir -p "${foreign_repo}/elsewhere" "${foreign_repo}/.claude" "${foreign_repo}/.claude/skills"
ln -s "../../elsewhere/app-deploy" "${foreign_repo}/.claude/skills/app-deploy"
( cd "${foreign_repo}" && node "${cli}" skill link-project --uninstall >/dev/null 2>&1 ) || true
assert "skill link-project: uninstall leaves foreign .claude symlink intact" \
  test "$(readlink "${foreign_repo}/.claude/skills/app-deploy")" = "../../elsewhere/app-deploy"

# Missing .codex/skills dir: clear error, non-zero exit.
empty_repo="${work}/empty"
mkdir -p "${empty_repo}"
assert "skill link-project: missing .codex exits non-zero" \
  bash -c "cd '${empty_repo}' && ! node '${cli}' skill link-project >/dev/null 2>&1"

empty_codex_repo="${work}/empty-codex"
mkdir -p "${empty_codex_repo}/.codex"
assert "skill link-project: missing .codex/skills exits non-zero" \
  bash -c "cd '${empty_codex_repo}' && ! node '${cli}' skill link-project >/dev/null 2>&1"

assert "skill link-project: re-run after missing-source checks works" \
  bash -c "cd '${local_repo}' && node '${cli}' skill link-project >/dev/null"

assert "skill install: removed alias rejected" \
  bash -c "cd '${local_repo}' && ! node '${cli}' skill install >/dev/null 2>&1"
assert "skill link: removed alias rejected" \
  bash -c "cd '${local_repo}' && ! node '${cli}' skill link >/dev/null 2>&1"
assert "skill link-local: removed alias rejected" \
  bash -c "cd '${local_repo}' && ! node '${cli}' skill link-local >/dev/null 2>&1"
assert "skill symlink-repo: removed name rejected" \
  bash -c "cd '${local_repo}' && ! node '${cli}' skill symlink-repo >/dev/null 2>&1"

sync_home="${work}/sync-global-home"
mkdir -p "${sync_home}/.claude" "${sync_home}/.codex"
assert "skill sync-global: refreshes cache and harness links" \
  bash -c "cd '${repo_root}' && HOME='${sync_home}' ROBOREPO_STATE_DIR='${sync_home}/.roborepo' node '${cli}' skill sync-global >/dev/null"
assert "skill sync-global: Claude skill cache link created" \
  assert_skill_cache_link "${sync_home}" "claude" "case-study" "${repo_root}/globals/agents/skills/case-study" "skill sync-global: Claude skill cache link created"
assert "skill sync-global: Codex skill cache link created" \
  assert_skill_cache_link "${sync_home}" "codex" "case-study" "${repo_root}/globals/agents/skills/case-study" "skill sync-global: Codex skill cache link created"
assert "skill inspect: reports managed source and harness state" \
  bash -c "HOME='${sync_home}' ROBOREPO_STATE_DIR='${sync_home}/.roborepo' node '${cli}' skill inspect case-study >'${work}/inspect-managed.out' && grep -q 'ownership: managed' '${work}/inspect-managed.out' && grep -q 'claude: managed' '${work}/inspect-managed.out' && grep -q 'codex: managed' '${work}/inspect-managed.out'"
mkdir -p "${sync_home}/.claude/skills/native-only/agents"
printf -- '---\nname: native-only\ndescription: native-only skill\n---\n' > "${sync_home}/.claude/skills/native-only/SKILL.md"
printf 'model: test\n' > "${sync_home}/.claude/skills/native-only/agents/openai.yaml"
assert "skill inspect: reports native-only unmanaged metadata" \
  bash -c "HOME='${sync_home}' ROBOREPO_STATE_DIR='${sync_home}/.roborepo' node '${cli}' skill inspect native-only >'${work}/inspect-native.out' && grep -q 'ownership: unmanaged' '${work}/inspect-native.out' && grep -q 'claude: unmanaged' '${work}/inspect-native.out' && grep -q 'native metadata: agents/openai.yaml' '${work}/inspect-native.out'"
rm "${sync_home}/.claude/skills/case-study"
mkdir -p "${sync_home}/.claude/skills/case-study/agents"
printf -- '---\nname: case-study\ndescription: local collision\n---\n' > "${sync_home}/.claude/skills/case-study/SKILL.md"
printf 'model: collision\n' > "${sync_home}/.claude/skills/case-study/agents/openai.yaml"
assert "skill inspect: reports native collision without flattening metadata" \
  bash -c "HOME='${sync_home}' ROBOREPO_STATE_DIR='${sync_home}/.roborepo' node '${cli}' skill inspect case-study >'${work}/inspect-collision.out' && grep -q 'native collision: claude' '${work}/inspect-collision.out' && grep -q 'claude: unmanaged' '${work}/inspect-collision.out' && grep -q 'native metadata: agents/openai.yaml' '${work}/inspect-collision.out'"
assert "skill inspect: unknown skill exits non-zero" \
  bash -c "! env HOME='${sync_home}' ROBOREPO_STATE_DIR='${sync_home}/.roborepo' node '${cli}' skill inspect does-not-exist >/dev/null 2>&1"
assert "skill sync: removed alias rejected" \
  bash -c "cd '${repo_root}' && ! node '${cli}' skill sync --check >/dev/null 2>&1"
assert "skill link-global: removed alias rejected" \
  bash -c "cd '${repo_root}' && ! node '${cli}' skill link-global --check >/dev/null 2>&1"
assert "skill symlink-globals: removed name rejected" \
  bash -c "cd '${repo_root}' && ! node '${cli}' skill symlink-globals >/dev/null 2>&1"
native_bin="${work}/native-bin"
mkdir -p "${native_bin}"
node_path="$(command -v node)"
cat > "${native_bin}/claude" <<'EOF'
#!/usr/bin/env bash
[[ "$*" == "plugin --help" ]] || exit 2
printf 'Usage: claude plugin\n\nCommands:\n  alpha      CLAUDE_DYNAMIC_PLUGIN_HELP\n  beta       second command\n\nOptions:\n  -h, --help\n'
EOF
cat > "${native_bin}/codex" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  "plugin --help") printf 'Usage: codex plugin\n\nCommands:\n  gamma      CODEX_DYNAMIC_PLUGIN_HELP\n  marketplace  marketplace commands\n\nOptions:\n  -h, --help\n' ;;
  "plugin marketplace --help") printf 'Usage: codex plugin marketplace\n\nCommands:\n  delta      CODEX_DYNAMIC_MARKETPLACE_HELP\n\nOptions:\n  -h, --help\n' ;;
  *) exit 2 ;;
esac
EOF
chmod +x "${native_bin}/claude" "${native_bin}/codex"
assert "skill native: shows curated summary without probing native CLIs" \
  bash -c "PATH='${native_bin}':\"\${PATH}\" '${node_path}' '${cli}' skill native >'${work}/native.out' && grep -q 'Native CLI Summary' '${work}/native.out' && grep -q 'Claude plugins.*list, install' '${work}/native.out' && grep -q 'roborepo skill native --full' '${work}/native.out' && ! grep -q 'CLAUDE_DYNAMIC_PLUGIN_HELP' '${work}/native.out'"
assert "skill native --full: prints installed native help" \
  bash -c "PATH='${native_bin}':\"\${PATH}\" '${node_path}' '${cli}' skill native --full >'${work}/native-full.out' && grep -q 'CLAUDE_DYNAMIC_PLUGIN_HELP' '${work}/native-full.out' && grep -q 'CODEX_DYNAMIC_PLUGIN_HELP' '${work}/native-full.out' && grep -q 'CODEX_DYNAMIC_MARKETPLACE_HELP' '${work}/native-full.out'"
mkdir -p "${work}/empty-native-bin"
assert "skill native --full: prints fallback when native help unavailable" \
  bash -c "PATH='${work}/empty-native-bin' '${node_path}' '${cli}' skill native --full >'${work}/native-fallback.out' && grep -q 'claude not found on PATH' '${work}/native-fallback.out' && grep -q 'codex not found on PATH' '${work}/native-fallback.out'"

assert "skill render-commands: check dispatches generated command verifier" \
  bash -c "cd '${repo_root}' && node '${cli}' skill render-commands --check >/dev/null"
assert "skill render-commands: generated Claude wrapper exists" \
  grep -q 'Use the `technical-planning-docs` skill' "${repo_root}/globals/claude/commands/technical-planning.md"
assert "skill render-commands: generated Codex wrapper uses codex skill path" \
  grep -q '~/.codex/skills/technical-planning-docs/SKILL.md' "${repo_root}/globals/codex/commands/technical-planning.md"
assert "skill render-commands: capture observer has no slash command" \
  bash -c "! test -e '${repo_root}/globals/claude/commands/capture-convention.md'"
assert "skill render-commands: capture observer absent from Codex commands" \
  bash -c "! test -e '${repo_root}/globals/codex/commands/capture-convention.md'"
assert "skill render-commands: implicit helper did not get command wrapper" \
  bash -c "! test -e '${repo_root}/globals/claude/commands/javascript-typescript.md'"
assert "skill audit: generated audit is current" \
  bash -c "cd '${repo_root}' && node '${cli}' skill audit --check >/dev/null"
assert "skill triggers: medium-risk trigger fixtures pass" \
  bash -c "cd '${repo_root}' && node '${cli}' skill triggers --check >/dev/null"
assert "skill invocation: manual-only policy requires explicit command" \
  bash -c "node -e \"import('${repo_root}/scripts/cli/slash-command-validation.mjs').then(m=>{try{m.validateSkillManifest({skills:[{skill:'demo',risk:'medium',invocation:'manual',explicit_command:false}]},new Set(['demo']));process.exit(1)}catch(e){process.exit(String(e.message).includes('requires explicit_command=true')?0:1)}})\""

# skill new: scaffold shared skills/commands against a throwaway harness root, never this repo.
new_harness="${work}/new-harness"
mkdir -p \
  "${new_harness}/scripts/cli" \
  "${new_harness}/scripts/build" \
  "${new_harness}/manifests/inventory" \
  "${new_harness}/manifests/platform" \
  "${new_harness}/globals/agents/skills" \
  "${new_harness}/globals/claude/commands" \
  "${new_harness}/globals/codex/commands" \
  "${new_harness}/local/skills"
cp "${repo_root}"/scripts/cli/*.mjs "${new_harness}/scripts/cli/"
cp "${repo_root}/scripts/build/link-skills.sh" "${new_harness}/scripts/build/link-skills.sh"
cp "${repo_root}/scripts/build/link-global-skills.sh" "${new_harness}/scripts/build/link-global-skills.sh"
cp "${repo_root}/scripts/build/skill-lib.sh" "${new_harness}/scripts/build/skill-lib.sh"
cp "${repo_root}/scripts/build/render-slash-commands.mjs" "${new_harness}/scripts/build/render-slash-commands.mjs"
printf '{"skills":[]}\n' > "${new_harness}/manifests/inventory/skill-invocation.json"
printf '{"commands":[]}\n' > "${new_harness}/manifests/inventory/slash-commands.json"
cp "${repo_root}/manifests/platform/cli-commands.json" "${new_harness}/manifests/platform/cli-commands.json"
cp "${repo_root}/manifests/inventory/mcp-presets.json" "${new_harness}/manifests/inventory/mcp-presets.json"
cat > "${new_harness}/README.md" <<'EOF_README'
# Test Harness

### Automatic Helpers

##### Repo

| | |
| --- | --- |

### Commands

| | | |
| --- | --- | --- |
EOF_README

( cd "${work}" && node "${new_harness}/scripts/cli/main.mjs" skill new --kind=auto --name=demo-helper --description="Demo helper workflow." --category=repo >/dev/null )
assert "skill new: auto helper creates skill" \
  test -f "${new_harness}/globals/agents/skills/demo-helper/SKILL.md"
assert "skill new: auto helper updates policy manifest" \
  grep -q '"explicit_command": false' "${new_harness}/manifests/inventory/skill-invocation.json"
assert "skill new: auto helper updates README Automatic Helpers" \
  grep -q 'demo-helper' "${new_harness}/README.md"

( cd "${work}" && node "${new_harness}/scripts/cli/main.mjs" skill new --kind=skill-command --name=demo-plan --command=demo-plan --description="Demo planning workflow." --risk=medium >/dev/null )
assert "skill new: skill-command creates command wrapper" \
  grep -q 'Use the `demo-plan` skill' "${new_harness}/globals/claude/commands/demo-plan.md"
assert "skill new: skill-command updates slash manifest" \
  grep -q '"kind": "skill-backed"' "${new_harness}/manifests/inventory/slash-commands.json"

( cd "${work}" && node "${new_harness}/scripts/cli/main.mjs" skill new --kind=standalone --name=demo-command --description="Demo command workflow." --harnesses=claude >/dev/null )
assert "skill new: standalone creates shared command source" \
  test -f "${new_harness}/globals/commands/demo-command.md"
assert "skill new: standalone renders selected harness only" \
  bash -c "test -f '${new_harness}/globals/claude/commands/demo-command.md' && ! test -e '${new_harness}/globals/codex/commands/demo-command.md'"
assert "skill new: duplicate harness rejected" \
  bash -c "cd '${work}' && ! node '${new_harness}/scripts/cli/main.mjs' skill new --kind=standalone --name=dupe-harness --description='Duplicate harness workflow.' --harnesses=claude,claude >/dev/null 2>&1"
assert "skill new: duplicate command rejected before partial skill write" \
  bash -c "cd '${work}' && ! node '${new_harness}/scripts/cli/main.mjs' skill new --kind=skill-command --name=partial-skill --command=demo-command --description='Partial write guard.' >/dev/null 2>&1 && ! test -e '${new_harness}/globals/agents/skills/partial-skill'"
assert "skill new: standalone rejects irrelevant risk flag" \
  bash -c "cd '${work}' && ! node '${new_harness}/scripts/cli/main.mjs' skill new --kind=standalone --name=bad-risk --description='Bad risk workflow.' --risk=medium >/dev/null 2>&1"
assert "skill new: skill-command rejects irrelevant category flag" \
  bash -c "cd '${work}' && ! node '${new_harness}/scripts/cli/main.mjs' skill new --kind=skill-command --name=bad-category --description='Bad category workflow.' --category=repo >/dev/null 2>&1"
assert "skill new: auto rejects irrelevant harnesses flag" \
  bash -c "cd '${work}' && ! node '${new_harness}/scripts/cli/main.mjs' skill new --kind=auto --name=bad-harnesses --description='Bad harness workflow.' --harnesses=claude >/dev/null 2>&1"
assert "skill new: auto rejects irrelevant command flag" \
  bash -c "cd '${work}' && ! node '${new_harness}/scripts/cli/main.mjs' skill new --kind=auto --name=bad-command-auto --command=ignored --description='Bad command workflow.' >/dev/null 2>&1"
assert "skill new: standalone rejects irrelevant command flag" \
  bash -c "cd '${work}' && ! node '${new_harness}/scripts/cli/main.mjs' skill new --kind=standalone --name=bad-command-standalone --command=ignored --description='Bad command workflow.' >/dev/null 2>&1"
mkdir -p "${new_harness}/globals/agents/skills/existing-dir"
printf 'support only\n' > "${new_harness}/globals/agents/skills/existing-dir/notes.txt"
assert "skill new: refuses existing skill dir without partial write" \
  bash -c "cd '${work}' && ! node '${new_harness}/scripts/cli/main.mjs' skill new --kind=auto --name=existing-dir --description='Existing dir guard.' >/dev/null 2>&1 && ! test -e '${new_harness}/globals/agents/skills/existing-dir/SKILL.md'"

# ---------------------------------------------------------------------------
# roborepo skill export-to-project
# ---------------------------------------------------------------------------
export_repo="${work}/export"
mkdir -p "${export_repo}"
( cd "${export_repo}" && node "${cli}" skill export-to-project --yes >/dev/null )
assert "skill export-to-project: .claude/skills created and populated" \
  test -f "${export_repo}/.claude/skills/test-harness/SKILL.md"
assert "skill export-to-project: fresh repo creates .codex/skills for Codex" \
  test -f "${export_repo}/.codex/skills/test-harness/SKILL.md"
assert "skill export-to-project: shareable zip produced" \
  bash -c "ls '${export_repo}'/global_agent_skills_*.zip >/dev/null 2>&1"
if command -v unzip >/dev/null 2>&1; then
  assert "skill export-to-project: zip integrity (unzip -t)" \
    bash -c "unzip -tq '${export_repo}'/global_agent_skills_*.zip >/dev/null"
fi

( cd "${export_repo}" && node "${cli}" skill export-to-project --yes --on-conflict=override >/dev/null )
assert "skill export-to-project: override moves old skill to archived/" \
  bash -c "ls '${export_repo}'/.claude/skills/archived/test-harness_backup_* >/dev/null 2>&1"

skip_repo="${work}/export-skip"
mkdir -p "${skip_repo}/.claude/skills/test-harness" "${skip_repo}/.codex/skills"
echo "LOCAL" > "${skip_repo}/.claude/skills/test-harness/local.txt"
( cd "${skip_repo}" && node "${cli}" skill export-to-project --yes --on-conflict=skip >/dev/null )
assert "skill export-to-project: skip preserves existing skill content" \
  grep -q "LOCAL" "${skip_repo}/.claude/skills/test-harness/local.txt"
assert "skill export-to-project: existing .codex/skills is populated" \
  test -f "${skip_repo}/.codex/skills/test-harness/SKILL.md"
assert "skill export-to-project: invalid on-conflict rejected" \
  bash -c "cd '${skip_repo}' && ! node '${cli}' skill export-to-project --yes --on-conflict=merge >/dev/null 2>&1"

claude_only_repo="${work}/export-claude-only"
mkdir -p "${claude_only_repo}/.claude/skills"
( cd "${claude_only_repo}" && node "${cli}" skill export-to-project --yes >/dev/null )
assert "skill export-to-project: creates .codex/skills even when only .claude exists" \
  test -f "${claude_only_repo}/.codex/skills/test-harness/SKILL.md"

assert "skill export-to-project: internal skill NOT exported (firewall)" \
  bash -c "! test -e '${export_repo}/.claude/skills/harness-platform-dev'"

assert "skill export-to-project: refuses to run in source repo" \
  bash -c "cd '${repo_root}' && ! node '${cli}' skill export-to-project --yes >/dev/null 2>&1"

assert "skill export-to-project: unknown flag rejected" \
  bash -c "cd '${export_repo}' && ! node '${cli}' skill export-to-project --yes --nonsense >/dev/null 2>&1"
assert "skill export: removed alias rejected" \
  bash -c "cd '${export_repo}' && ! node '${cli}' skill export --yes >/dev/null 2>&1"
assert "skill export-to-local: removed name rejected" \
  bash -c "cd '${export_repo}' && ! node '${cli}' skill export-to-local --yes >/dev/null 2>&1"

# ---------------------------------------------------------------------------
# roborepo run
# ---------------------------------------------------------------------------
assert "run: success exits 0" \
  bash -c "node '${cli}' run true >/dev/null"
assert "run: failure propagates non-zero exit" \
  bash -c "! node '${cli}' run false >/dev/null 2>&1"
assert "run: no command exits non-zero" \
  bash -c "! node '${cli}' run >/dev/null 2>&1"

# ---------------------------------------------------------------------------
# roborepo project-context
# ---------------------------------------------------------------------------
pc_repo="${work}/project-context"
mkdir -p "${pc_repo}/src" "${pc_repo}/docs/project-context"
printf '{"name":"pc-demo","scripts":{"test":"node --test"}}\n' > "${pc_repo}/package.json"
printf 'export function demo() { return true; }\n' > "${pc_repo}/src/demo.js"
printf '# Project Context\n' > "${pc_repo}/docs/project-context/README.md"
printf '# Glossary\n' > "${pc_repo}/docs/project-context/glossary.md"
printf '# Inventory\n' > "${pc_repo}/docs/project-context/inventory.md"
assert "project-context inventory: writes generated facts and summary" \
  bash -c "cd '${pc_repo}' && node '${cli}' project-context inventory . --summary >/dev/null && test -f docs/project-context/generated/repo-scan.json && test -f docs/project-context/generated/repo-summary.md"
assert "project-context check: validates generated facts and curated docs" \
  bash -c "cd '${pc_repo}' && node '${cli}' project-context check . >/dev/null"
printf '{"schemaVersion":999}\n' > "${pc_repo}/docs/project-context/generated/repo-scan.json"
assert "project-context check: fails stale generated schema" \
  bash -c "cd '${pc_repo}' && ! node '${cli}' project-context check . >/dev/null 2>&1"

# ---------------------------------------------------------------------------
# roborepo bundles / telemetry
# ---------------------------------------------------------------------------
presets_home="${work}/presets-home"
mkdir -p "${presets_home}/.claude" "${presets_home}/.codex"
assert "bundle apply: selected bundles apply into harness homes" \
  bash -c "HOME='${presets_home}' ROBOREPO_STATE_DIR='${presets_home}/.roborepo' node '${cli}' bundle apply base hooks commands >/dev/null"
assert "bundle check: selected bundles verify" \
  bash -c "HOME='${presets_home}' ROBOREPO_STATE_DIR='${presets_home}/.roborepo' node '${cli}' bundle check >/dev/null"
assert "bundle remove: unlinks owned link bundle" \
  bash -c "HOME='${presets_home}' ROBOREPO_STATE_DIR='${presets_home}/.roborepo' node '${cli}' bundle remove hooks >/dev/null && ! test -e '${presets_home}/.claude/hooks'"
assert "telemetry enable: creates local state dirs" \
  bash -c "HOME='${presets_home}' ROBOREPO_STATE_DIR='${presets_home}/.roborepo' node '${cli}' telemetry enable >/dev/null && test -d '${presets_home}/.roborepo/telemetry/spool'"
assert "package snapshot: direct service state is external until package desired state is set" \
  bash -c "HOME='${presets_home}' ROBOREPO_STATE_DIR='${presets_home}/.roborepo' node -e \"import('${repo_root}/scripts/cli/config.mjs').then(c=>{const p=c.readConfigSnapshot().packages.find(x=>x.id==='telemetry');process.exit(p?.enabled===false&&p?.desired===false&&p?.status==='external'&&p.componentStatus?.[0]?.state==='external'?0:1)})\""

# ---------------------------------------------------------------------------
# Phase 1: interactive config controls — enable/disable package round-trip,
# skill install/remove into both harnesses, and the dashboard POST endpoints.
# Runs against a throwaway harness root so it never touches the real ~/.claude.
# ---------------------------------------------------------------------------
cfg_home="${work}/config-home"
mkdir -p "${cfg_home}/.claude/skills" "${cfg_home}/.codex/skills"
echo '{}' > "${cfg_home}/.claude/settings.json"
# ROBOREPO_SKIP_MCP=1: `enable` would otherwise shell out to `roborepo mcp add`, which writes
# TRACKED repo source (globals/claude/settings.json + manifests/inventory/mcp-servers.json) and the
# real `claude` CLI. Skip that step so the test exercises perms/hooks/rules without polluting the
# working tree or depending on global mcp state.
cfg_env="HOME='${cfg_home}' ROBOREPO_STATE_DIR='${cfg_home}/.roborepo' ROBOREPO_SKIP_MCP=1"

# Guard: enabling a package must not mutate tracked repo source (it writes the consumer's home only).
cfg_settings_before="$(git -C "${repo_root}" status --porcelain globals/claude/settings.json manifests/inventory/mcp-servers.json)"

# disable on a fresh home is a clean no-op (idempotent); dry-run never writes.
assert "config: disable dry-run does not write settings" \
  bash -c "${cfg_env} node '${cli}' disable jcodemunch --dry-run >/dev/null && [ \"\$(node -e \"console.log((require('${cfg_home}/.claude/settings.json').permissions?.allow||[]).length)\")\" = 0 ]"
assert "config: disable unknown package exits non-zero" \
  bash -c "! ${cfg_env} node '${cli}' disable nope-pkg >/dev/null 2>&1"

# enable writes perms+hooks+rules; disable reverses them. (mcp add fails gracefully w/o claude CLI.)
bash -c "${cfg_env} node '${cli}' enable jcodemunch >/dev/null 2>&1" || true
assert "config: enable wires package permissions" \
  bash -c "[ \"\$(node -e \"console.log((require('${cfg_home}/.claude/settings.json').permissions?.allow||[]).length)\")\" -gt 0 ]"
assert "config: enable wires CLAUDE.md rules" test -f "${cfg_home}/.claude/CLAUDE.md"
assert "config: Claude rules use managed inline block" \
  bash -c "grep -q 'BEGIN managed:roborepo-code-style' '${cfg_home}/.claude/CLAUDE.md' && grep -q 'Generated Harness Rules' '${cfg_home}/.claude/CLAUDE.md'"
assert "config: Claude rules no longer use managed import block" \
  bash -c "! grep -q 'BEGIN managed:roborepo-agents-import' '${cfg_home}/.claude/CLAUDE.md' && ! test -e '${cfg_home}/.roborepo/rules/generated-rules.md'"
assert "config: package snapshot includes runtime status and component status" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config.mjs').then(c=>{const p=c.readConfigSnapshot().packages.find(x=>x.id==='jcodemunch');process.exit(p?.enabled===true&&p?.status==='partial'&&Array.isArray(p.componentStatus)&&p.componentStatus.some(x=>x.type==='mcp'&&x.state==='missing')?0:1)})\""
bash -c "${cfg_env} node '${cli}' disable jcodemunch >/dev/null 2>&1" || true
assert "config: disable removes package permissions" \
  bash -c "[ \"\$(node -e \"console.log((require('${cfg_home}/.claude/settings.json').permissions?.allow||[]).length)\")\" = 0 ]"
assert "config: disable removes package hooks" \
  bash -c "[ \"\$(node -e \"console.log(Object.keys(require('${cfg_home}/.claude/settings.json').hooks||{}).length)\")\" = 0 ]"
assert "config: enable/disable did not mutate tracked repo source" \
  bash -c "[ \"\$(git -C '${repo_root}' status --porcelain globals/claude/settings.json manifests/inventory/mcp-servers.json)\" = '${cfg_settings_before}' ]"

# Plugin component type (caveman package): enable writes enabledPlugins bool + marketplace entry,
# disable removes both. The harness performs the actual fetch on next launch — not asserted here.
bash -c "${cfg_env} node '${cli}' enable caveman >/dev/null 2>&1" || true
assert "config: enable plugin sets enabledPlugins bool + marketplace" \
  bash -c "node -e \"const s=require('${cfg_home}/.claude/settings.json');process.exit(s.enabledPlugins?.['caveman@caveman']===true&&!!s.extraKnownMarketplaces?.caveman?0:1)\""
assert "config: caveman package reports enabled in snapshot" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config.mjs').then(c=>{const p=c.readConfigSnapshot().packages.find(x=>x.id==='caveman');process.exit(p&&p.enabled?0:1)})\""
bash -c "${cfg_env} node '${cli}' disable caveman >/dev/null 2>&1" || true
assert "config: disable plugin removes bool + marketplace" \
  bash -c "node -e \"const s=require('${cfg_home}/.claude/settings.json');process.exit(!s.enabledPlugins?.['caveman@caveman']&&!s.extraKnownMarketplaces?.caveman?0:1)\""
assert "config: caveman package reports disabled after removal" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config.mjs').then(c=>{const p=c.readConfigSnapshot().packages.find(x=>x.id==='caveman');process.exit(p&&!p.enabled?0:1)})\""

# Chat-Time Output: rules-only packages with harness "both" — enable merges rules inline into both
# CLAUDE.md and AGENTS.md; snapshot reports enabled; toggles are independent; disable removes from
# both paths. The throwaway home has .claude and .codex dirs, so "both" targets both harnesses.
printf 'override custom\n' > "${cfg_home}/.codex/AGENTS.override.md"
bash -c "${cfg_env} node '${cli}' enable impact-awareness >/dev/null 2>&1" || true
assert "config: rules pkg merges into Claude CLAUDE.md" \
  bash -c "grep -q 'Impact Awareness' '${cfg_home}/.claude/CLAUDE.md'"
assert "config: rules pkg merges into Codex AGENTS.md (both-harness parity)" \
  bash -c "grep -q 'Impact Awareness' '${cfg_home}/.codex/AGENTS.md'"
assert "config: Codex rules use managed inline block" \
  bash -c "grep -q 'BEGIN managed:roborepo-code-style' '${cfg_home}/.codex/AGENTS.md'"
assert "config: existing Codex override also gets managed rules without losing user text" \
  bash -c "grep -q 'Impact Awareness' '${cfg_home}/.codex/AGENTS.override.md' && grep -q 'override custom' '${cfg_home}/.codex/AGENTS.override.md'"
assert "config: rules pkg reports enabled in snapshot" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config.mjs').then(c=>{const p=c.readConfigSnapshot().packages.find(x=>x.id==='impact-awareness');process.exit(p&&p.enabled?0:1)})\""
# Independence: enabling a second behavior must not disturb the first; disabling the first must leave
# the second in place in both harnesses.
bash -c "${cfg_env} node '${cli}' enable skill-visibility >/dev/null 2>&1" || true
bash -c "${cfg_env} node '${cli}' disable impact-awareness >/dev/null 2>&1" || true
assert "config: disable rules pkg removes its block from both harnesses" \
  bash -c "! grep -q 'Impact Awareness' '${cfg_home}/.claude/CLAUDE.md' && ! grep -q 'Impact Awareness' '${cfg_home}/.codex/AGENTS.md'"
assert "config: disabling one rules pkg leaves the others (Claude)" \
  bash -c "grep -q 'Skill Visibility' '${cfg_home}/.claude/CLAUDE.md'"
assert "config: disabling one rules pkg leaves the others (Codex)" \
  bash -c "grep -q 'Skill Visibility' '${cfg_home}/.codex/AGENTS.md'"
assert "config: existing Codex override keeps user text after rerender" \
  bash -c "grep -q 'Skill Visibility' '${cfg_home}/.codex/AGENTS.override.md' && grep -q 'override custom' '${cfg_home}/.codex/AGENTS.override.md'"
bash -c "${cfg_env} node '${cli}' disable skill-visibility >/dev/null 2>&1" || true

broken_home="${work}/broken-rules-home"
mkdir -p "${broken_home}/.codex"
printf '<!-- BEGIN managed:roborepo-code-style -->\n' > "${broken_home}/.codex/AGENTS.md"
assert "config: managed rules fail safely on broken marker" \
  bash -c "! HOME='${broken_home}' ROBOREPO_STATE_DIR='${broken_home}/.roborepo' node '${cli}' enable impact-awareness >'${broken_home}/out' 2>&1 && grep -q 'incomplete Roborepo managed block' '${broken_home}/out'"
printf '<!-- END managed:roborepo-code-style -->\nuser text\n<!-- BEGIN managed:roborepo-code-style -->\n' > "${broken_home}/.codex/AGENTS.md"
assert "config: managed rules fail safely on reversed markers" \
  bash -c "! HOME='${broken_home}' ROBOREPO_STATE_DIR='${broken_home}/.roborepo' node '${cli}' enable impact-awareness >'${broken_home}/out-reversed' 2>&1 && grep -q 'incomplete Roborepo managed block' '${broken_home}/out-reversed'"

legacy_import_home="${work}/legacy-import-home"
mkdir -p "${legacy_import_home}/.claude" "${legacy_import_home}/.roborepo/rules"
printf '<!-- BEGIN managed:roborepo-agents-import -->\n@~/.roborepo/rules/generated-rules.md\n<!-- END managed:roborepo-agents-import -->\nuser text\n' > "${legacy_import_home}/.claude/CLAUDE.md"
printf '# Generated Harness Rules\n\nold render\n' > "${legacy_import_home}/.roborepo/rules/generated-rules.md"
assert "config: Claude legacy import block migrates to inline rules" \
  bash -c "HOME='${legacy_import_home}' ROBOREPO_STATE_DIR='${legacy_import_home}/.roborepo' node '${cli}' rules render >/dev/null && grep -q 'BEGIN managed:roborepo-code-style' '${legacy_import_home}/.claude/CLAUDE.md' && ! grep -q 'BEGIN managed:roborepo-agents-import' '${legacy_import_home}/.claude/CLAUDE.md' && grep -q 'user text' '${legacy_import_home}/.claude/CLAUDE.md' && ! test -e '${legacy_import_home}/.roborepo/rules/generated-rules.md'"

# Service component (telemetry as a package): enable via the generic package path flips its state +
# snapshot, disable reverses. The service handler owns telemetry's bespoke install (hooks + spool).
bash -c "${cfg_env} node '${cli}' enable telemetry >/dev/null 2>&1" || true
assert "config: enable service package flips telemetry state" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config.mjs').then(c=>{const s=c.readConfigSnapshot();const p=s.packages.find(x=>x.id==='telemetry');process.exit(s.telemetry.enabled&&p?.enabled&&p?.desired&&p?.status==='enabled'?0:1)})\""
bash -c "${cfg_env} node '${cli}' disable telemetry >/dev/null 2>&1" || true
assert "config: disable service package clears telemetry state" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config.mjs').then(c=>{const s=c.readConfigSnapshot();process.exit(!s.telemetry.enabled&&!s.packages.find(p=>p.id==='telemetry')?.enabled?0:1)})\""

# Skill component: a package whose payload is a shared-skill copy. Enable copies it into both harness
# skill dirs via the machine-local cache; disable removes the owned cache entry and views. Reuses
# the same skill materializer as the Code Conventions toggles.
bash -c "${cfg_env} node '${cli}' enable case-study-pack >/dev/null 2>&1" || true
assert "config: enabling a skill-component package links the Claude view" \
  assert_skill_cache_link "${cfg_home}" "claude" "case-study" "${repo_root}/globals/agents/skills/case-study" "config: Claude skill cache link created"
assert "config: enabling a skill-component package links the Codex view" \
  assert_skill_cache_link "${cfg_home}" "codex" "case-study" "${repo_root}/globals/agents/skills/case-study" "config: Codex skill cache link created"
assert "config: skill-component package reports enabled" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config.mjs').then(c=>{process.exit(c.readConfigSnapshot().packages.find(p=>p.id==='case-study-pack')?.enabled?0:1)})\""
bash -c "${cfg_env} node '${cli}' disable case-study-pack >/dev/null 2>&1" || true
assert "config: disabling a skill-component package removes the skill links" \
  bash -c "! test -e '${cfg_home}/.claude/skills/case-study' && ! test -e '${cfg_home}/.codex/skills/case-study' && ! test -e '${cfg_home}/.roborepo/skills/case-study'"

# /inventory is a pending package-owned command: default config hides it, and the CLI refuses
# mutation until the hidden experimental switch is enabled. Once enabled, toggling it controls both
# the project-context skill and the Project Context rules slice.
assert "config: pending /inventory package hidden by default" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config.mjs').then(c=>{const s=c.readConfigSnapshot();const inv=s.behaviorView.find(x=>x.category==='Commands').items.find(x=>x.label==='/inventory');const pkg=s.packages.find(x=>x.id==='project-context');process.exit(!inv&&!pkg?0:1)})\""
assert "config: pending package enable rejected without experimental flag" \
  bash -c "! ${cfg_env} node '${cli}' enable project-context >'${cfg_home}/pending.out' 2>&1 && grep -q 'roborepo experimental enable' '${cfg_home}/pending.out'"
assert "config: experimental enable exposes pending packages" \
  bash -c "${cfg_env} node '${cli}' experimental enable >/dev/null && [ \"\$(${cfg_env} node '${cli}' experimental status)\" = enabled ]"
assert "config: pending /inventory package visible with experimental flag" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config.mjs').then(c=>{const s=c.readConfigSnapshot();const inv=s.behaviorView.find(x=>x.category==='Commands').items.find(x=>x.label==='/inventory');const pkg=s.packages.find(x=>x.id==='project-context');process.exit(inv&&inv.id==='project-context'&&inv.toggle==='package'&&inv.badges.includes('pending')&&pkg?.catalogStatus==='pending'?0:1)})\""
bash -c "${cfg_env} node '${cli}' enable project-context >/dev/null 2>&1" || true
assert "config: enabling pending project-context links the command skill when experimental" \
  assert_skill_cache_link "${cfg_home}" "codex" "project-context" "${repo_root}/globals/agents/skills/project-context" "config: project-context skill cache link created"
assert "config: enabling pending project-context merges its rules when experimental" \
  bash -c "grep -q '## Project Context' '${cfg_home}/.claude/CLAUDE.md' && grep -q '## Project Context' '${cfg_home}/.codex/AGENTS.md'"
assert "config: pending rules are skipped again without experimental flag" \
  bash -c "${cfg_env} node '${cli}' experimental disable >/dev/null && ${cfg_env} node '${cli}' rules render >/dev/null && ! grep -q '## Project Context' '${cfg_home}/.codex/AGENTS.md'"
bash -c "${cfg_env} node '${cli}' experimental enable >/dev/null && ${cfg_env} node '${cli}' disable project-context >/dev/null 2>&1" || true
assert "config: disabling pending project-context removes skill and rules" \
  bash -c "! test -e '${cfg_home}/.codex/skills/project-context' && ! test -e '${cfg_home}/.roborepo/skills/project-context' && ! grep -q '## Project Context' '${cfg_home}/.codex/AGENTS.md'"

# Composite package: a package that `requires` others. Enabling it enables every dependency (deps
# first), and the composite reports enabled iff all deps are.
bash -c "${cfg_env} node '${cli}' enable code-intel >/dev/null 2>&1" || true
assert "config: enabling a composite package enables its required packages" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config.mjs').then(c=>{const s=c.readConfigSnapshot();const e=id=>s.packages.find(p=>p.id===id)?.enabled;process.exit(e('jcodemunch')&&e('jdocmunch')&&e('code-intel')?0:1)})\""
bash -c "${cfg_env} node '${cli}' disable jdocmunch >/dev/null 2>&1" || true
assert "config: composite reports disabled when a dependency is disabled" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config.mjs').then(c=>{const s=c.readConfigSnapshot();process.exit(s.packages.find(p=>p.id==='code-intel')?.enabled===false?0:1)})\""
assert "config: snapshot exposes a package's requires list" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config.mjs').then(c=>{const p=c.readConfigSnapshot().packages.find(x=>x.id==='code-intel');process.exit(Array.isArray(p.requires)&&p.requires.includes('jcodemunch')&&p.requires.includes('jdocmunch')?0:1)})\""

# Skill toggle links into the machine-local cache plus both harness views, then removes only owned links.
cfg_skill="$(ls "${repo_root}/globals/agents/skills" | head -1)"
assert "config: setSkillInstalled links both harness views" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config-mutate.mjs').then(m=>{const r=m.setSkillInstalled('${cfg_skill}',true);process.exit(r.ok?0:1)})\" && test -d '${cfg_home}/.roborepo/skills/${cfg_skill}' && test -e '${cfg_home}/.roborepo/skills/${cfg_skill}/.roborepo-managed'"
assert "package snapshot: direct skill install is external until package desired state is set" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config.mjs').then(c=>{const p=c.readConfigSnapshot().packages.find(x=>x.id==='case-study-pack');process.exit(p?.enabled===false&&p?.desired===false&&p?.status==='external'&&p.componentStatus?.[0]?.state==='external'?0:1)})\""
assert "config: Claude skill view points at the cache" \
  assert_skill_cache_link "${cfg_home}" "claude" "${cfg_skill}" "${repo_root}/globals/agents/skills/${cfg_skill}" "config: Claude skill cache link created"
assert "config: Codex skill view points at the cache" \
  assert_skill_cache_link "${cfg_home}" "codex" "${cfg_skill}" "${repo_root}/globals/agents/skills/${cfg_skill}" "config: Codex skill cache link created"
assert "config: setSkillInstalled removes owned links" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config-mutate.mjs').then(m=>{const r=m.setSkillInstalled('${cfg_skill}',false);process.exit(r.ok?0:1)})\" && ! test -e '${cfg_home}/.claude/skills/${cfg_skill}' && ! test -e '${cfg_home}/.codex/skills/${cfg_skill}' && ! test -e '${cfg_home}/.roborepo/skills/${cfg_skill}'"
assert "config: setSkillInstalled rejects unknown skill" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config-mutate.mjs').then(m=>{const r=m.setSkillInstalled('zzz-not-real',true);process.exit(r.ok?1:0)})\""
assert "config: setSkillInstalled skips native skill dir (real dir collision)" \
  bash -c "mkdir -p '${cfg_home}/.claude/skills/${cfg_skill}' && ${cfg_env} node -e \"import('${repo_root}/scripts/cli/config-mutate.mjs').then(m=>{const r=m.setSkillInstalled('${cfg_skill}',true);process.exit(r.ok&&!require('fs').lstatSync('${cfg_home}/.claude/skills/${cfg_skill}').isSymbolicLink()?0:1)})\"; rm -rf '${cfg_home}/.claude/skills/${cfg_skill}'"

if node -e 'const s=require("node:net").createServer();s.once("error",()=>process.exit(1));s.listen(0,"127.0.0.1",()=>s.close(()=>process.exit(0)))'; then
  # Dashboard POST endpoints: start the loopback server, exercise both routes, assert JSON contract.
  cfg_ready="${cfg_home}/portal.ready"
  env HOME="${cfg_home}" ROBOREPO_STATE_DIR="${cfg_home}/.roborepo" ROBOREPO_PORTAL_READY_FILE="${cfg_ready}" \
    node "${cli}" serve --no-open --port 0 --allow-zero-port >"${cfg_home}/portal.log" 2>&1 &
  cfg_srv=$!
  cfg_port=""
  for _ in $(seq 1 50); do
    if [[ -f "${cfg_ready}" ]]; then
      cfg_port="$(sed -n 's/^ready://p' "${cfg_ready}")"
      break
    fi
    if ! kill -0 "${cfg_srv}" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done
  assert "config: portal server starts on an allocated port" \
    bash -c "test -n '${cfg_port}' && curl -s 'http://127.0.0.1:${cfg_port}/api/config' >/dev/null"
  # Capture the JSON to a file so the snapshot body (which contains apostrophes in skill descriptions)
  # never has to round-trip through a shell-quoted string.
  curl -s -X POST "http://127.0.0.1:${cfg_port}/api/config/skills" -H 'Content-Type: application/json' \
    -d "{\"id\":\"${cfg_skill}\",\"enabled\":true}" > "${cfg_home}/post-skill.json"
  assert "config: POST /api/config/skills installs and returns snapshot" \
    bash -c "node -e \"const j=require('${cfg_home}/post-skill.json');process.exit(j.ok&&j.config&&Array.isArray(j.config.tools)?0:1)\" && test -d '${cfg_home}/.claude/skills/${cfg_skill}' && test -e '${cfg_home}/.claude/skills/${cfg_skill}/.roborepo-managed'"
  assert "config: POST with bad body returns 400" \
    bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST 'http://127.0.0.1:${cfg_port}/api/config/skills' -H 'Content-Type: application/json' -d '{\"id\":123}')\" = 400 ]"
  assert "config: POST unknown skill returns ok:false" \
    bash -c "curl -s -X POST 'http://127.0.0.1:${cfg_port}/api/config/skills' -H 'Content-Type: application/json' -d '{\"id\":\"zzz\",\"enabled\":true}' | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.exit(j.ok===false?0:1)})\""
  assert "config: GET /config still served" \
    bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:${cfg_port}/config')\" = 200 ]"
  # The /config page JS must parse — a syntax error there crashes the whole dashboard at load (no
  # panels render) and is invisible to HTTP-status checks. Guards the template-literal trap (a literal
  # newline inside a JS string, etc.).
  assert "config: served /config dashboard JS parses" \
    bash -c "dashjs=\"${cfg_home}/dash.js\"; curl -s 'http://127.0.0.1:${cfg_port}/portal/config/app.js' > \"\${dashjs}\" && node --check \"\${dashjs}\""
else
  [[ "${quiet}" -eq 0 ]] && echo "skip: config portal HTTP tests (loopback bind unavailable)"
fi

# Phase 2: flat permission model — named behaviors (write-files, delete-files, go-online,
# commit-code, push-pull-prs) and arbitrary commands are each independently deny/ask/allow, with
# personal overrides layered on top of the manifest at render time. No profile bundles, no
# project scope (global only — see manifests/inventory/agent-permissions.json).
# Seed a codex config.toml so the renderer has a marker block to merge into.
cp "${repo_root}/globals/codex/config.toml" "${cfg_home}/.codex/config.toml"
assert "config: setBehaviorBucket rewrites live home config + preserves other keys" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config-mutate.mjs').then(m=>{const fs=require('fs');const before=JSON.parse(fs.readFileSync('${cfg_home}/.claude/settings.json'));const r=m.setBehaviorBucket('write-files','deny');const after=JSON.parse(fs.readFileSync('${cfg_home}/.claude/settings.json'));const codex=fs.readFileSync('${cfg_home}/.codex/config.toml','utf8');process.exit(r.ok&&/sandbox_mode = .read-only./.test(codex)&&!after.permissions.allow.includes('Write')?0:1)})\""
assert "config: setBehaviorBucket rejects unknown behavior" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config-mutate.mjs').then(m=>{const r=m.setBehaviorBucket('bogus-behavior','deny');process.exit(r.ok?1:0)})\""
assert "config: setBehaviorBucket rejects unknown bucket" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config-mutate.mjs').then(m=>{const r=m.setBehaviorBucket('write-files','bogus');process.exit(r.ok?1:0)})\""
assert "config: setBehaviorBucket default reverts to manifest default" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config-mutate.mjs').then(m=>{m.setBehaviorBucket('write-files','default');const eff=m.effectivePermissions();const wf=eff.behaviors.find(b=>b.id==='write-files');process.exit(wf.bucket==='allow'&&!wf.overridden?0:1)})\""
assert "config: setCommandBucket tracks a new arbitrary command" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config-mutate.mjs').then(m=>{m.setCommandBucket(['docker','run'],'ask');const eff=m.effectivePermissions();const c=eff.arbitrary.find(a=>a.id==='docker run');process.exit(c&&c.bucket==='ask'&&c.overridden?0:1)})\""
assert "config: setCommandBucket rejects empty tokens" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config-mutate.mjs').then(m=>{const r=m.setCommandBucket([],'ask');process.exit(r.ok?1:0)})\""
assert "config: snapshot reports behaviors + arbitrary commands" \
  bash -c "${cfg_env} node -e \"import('${repo_root}/scripts/cli/config.mjs').then(c=>{const s=c.readConfigSnapshot();const p=s.permissions;process.exit(Array.isArray(p.behaviors)&&p.behaviors.length===5&&Array.isArray(p.arbitrary)?0:1)})\""

if [[ -n "${cfg_port:-}" ]]; then
  # Permission POST endpoint: named behavior (200), arbitrary command (200), invalid bucket (400),
  # missing identifier (400).
  assert "config: POST /api/config/permissions sets a named behavior (200)" \
    bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST 'http://127.0.0.1:${cfg_port}/api/config/permissions' -H 'Content-Type: application/json' -d '{\"behaviorId\":\"go-online\",\"bucket\":\"allow\"}')\" = 200 ]"
  assert "config: POST /api/config/permissions sets an arbitrary command (200)" \
    bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST 'http://127.0.0.1:${cfg_port}/api/config/permissions' -H 'Content-Type: application/json' -d '{\"tokens\":[\"curl\"],\"bucket\":\"ask\"}')\" = 200 ]"
  assert "config: POST permissions invalid bucket returns 400" \
    bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST 'http://127.0.0.1:${cfg_port}/api/config/permissions' -H 'Content-Type: application/json' -d '{\"behaviorId\":\"go-online\",\"bucket\":\"bogus\"}')\" = 400 ]"
  assert "config: POST permissions missing identifier returns 400" \
    bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST 'http://127.0.0.1:${cfg_port}/api/config/permissions' -H 'Content-Type: application/json' -d '{\"bucket\":\"allow\"}')\" = 400 ]"

  # Telemetry is a package via a service component: it toggles through the generic package endpoint.
  assert "config: POST package telemetry (service component) enables + flips snapshot" \
    bash -c "curl -s -X POST 'http://127.0.0.1:${cfg_port}/api/config/packages' -H 'Content-Type: application/json' -d '{\"id\":\"telemetry\",\"enabled\":true}' | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.exit(j.ok&&j.config?.telemetry?.enabled===true&&j.config?.packages?.find(p=>p.id==='telemetry')?.enabled===true?0:1)})\""
  assert "config: POST package telemetry disable flips snapshot" \
    bash -c "curl -s -X POST 'http://127.0.0.1:${cfg_port}/api/config/packages' -H 'Content-Type: application/json' -d '{\"id\":\"telemetry\",\"enabled\":false}' | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.exit(j.ok&&j.config?.telemetry?.enabled===false?0:1)})\""

  kill "${cfg_srv}" 2>/dev/null || true
  cfg_srv=""
fi

# Token capture reads the harness transcript (transcript_path on hook stdin) and records cumulative
# token totals + a per-session delta. These tests use a fixture transcript so they never depend on a
# live agent session.
tele_home="${work}/telemetry-home"
mkdir -p "${tele_home}/.roborepo"
tele_env=( "HOME=${tele_home}" "ROBOREPO_STATE_DIR=${tele_home}/.roborepo" )
tele_transcript="${tele_home}/transcript.jsonl"
cat > "${tele_transcript}" <<'TRANSCRIPT'
{"type":"assistant","message":{"model":"claude-opus-4-8","usage":{"input_tokens":1000,"output_tokens":200,"cache_creation_input_tokens":500,"cache_read_input_tokens":300},"content":[{"type":"tool_use","id":"tu_read","name":"Read"}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_read","content":"a small read result"}]}}
{"type":"assistant","message":{"model":"claude-opus-4-8","usage":{"input_tokens":5000,"output_tokens":800,"cache_creation_input_tokens":40000,"cache_read_input_tokens":20000},"content":[{"type":"tool_use","id":"tu_mcp","name":"mcp__jcodemunch__search_text"}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_mcp","content":"MCPRESULTPADDING"}]}}
TRANSCRIPT
env "${tele_env[@]}" node "${cli}" telemetry enable >/dev/null
echo "{\"session_id\":\"sess-x\",\"cwd\":\"${repo_root}\",\"transcript_path\":\"${tele_transcript}\"}" \
  | env "${tele_env[@]}" node "${cli}" telemetry capture --harness claude --event Stop
assert "telemetry capture: records token totals from transcript" \
  bash -c "grep -q '\"total\":67800' '${tele_home}/.roborepo/telemetry/spool/claude.jsonl'"
assert "telemetry capture: marks mcp tool metadata" \
  bash -c "grep -q '\"schema\":2' '${tele_home}/.roborepo/telemetry/spool/claude.jsonl'"
# Spike attribution: capture sizes the tool result that most recently entered context (last_result)
# and the heaviest result of the session (biggest_result), tying a spike back to what caused it.
assert "telemetry capture: records last tool result for spike attribution" \
  bash -c "grep -q '\"last_result\":{\"tool\":\"mcp__jcodemunch__search_text\"' '${tele_home}/.roborepo/telemetry/spool/claude.jsonl'"
# spikeCause classifies a heavy MCP result into the mcp-bundle bucket with an actionable hint.
assert "telemetry analyze: classifies spike cause from result size" \
  bash -c "node -e 'import(\"${repo_root}/scripts/cli/telemetry-analyze.mjs\").then(m=>{const r=m.spikeCause({last_result:{tool:\"mcp__jcodemunch__get_context_bundle\",chars:500000},tool:{is_mcp:true},delta_tokens:900000});process.exit(r.cause===\"mcp-bundle\"?0:1)})'"
assert "telemetry report: shows token sections when token data exists" \
  bash -c "env ${tele_env[*]} node '${cli}' telemetry report | grep -q 'token spikes'"
assert "telemetry report: legacy metadata-only records still report" \
  bash -c "printf '%s\n' '{\"ts\":\"2026-06-10T01:00:00Z\",\"harness\":\"claude\",\"event\":\"Stop\",\"repo\":{\"label\":\"legacy\"},\"tool\":{\"name\":\"Read\"}}' >> '${tele_home}/.roborepo/telemetry/spool/claude.jsonl' && env ${tele_env[*]} node '${cli}' telemetry report | grep -q 'legacy'"
assert "serve: top-level alias rejects invalid port" \
  bash -c "! env ${tele_env[*]} node '${cli}' serve --port 0 >/dev/null 2>&1"
assert "telemetry start: removed" \
  bash -c "! env ${tele_env[*]} node '${cli}' telemetry start >/dev/null 2>&1"
assert "telemetry serve: removed" \
  bash -c "! env ${tele_env[*]} node '${cli}' telemetry serve --port 14317 >/dev/null 2>&1"
# Reset must be able to snapshot first: purge --backup copies the spool to a backup that lives
# outside telemetryDir, then removes telemetryDir. The backup (and its spool) must survive.
assert "telemetry purge --backup: snapshots spool before reset, backup survives purge" \
  bash -c "env ${tele_env[*]} node '${cli}' telemetry purge --all --backup >/dev/null && ! test -d '${tele_home}/.roborepo/telemetry' && ls '${tele_home}/.roborepo/telemetry-backups'/*/spool/claude.jsonl >/dev/null 2>&1"
assert "telemetry purge: rejects missing --all" \
  bash -c "! env ${tele_env[*]} node '${cli}' telemetry purge >/dev/null 2>&1"

adopt_keep_home="${work}/adopt-keep-home"
mkdir -p "${adopt_keep_home}/.claude" "${adopt_keep_home}/.roborepo"
printf 'local hooks\n' > "${adopt_keep_home}/.claude/hooks"
node -e 'const fs = require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({ repo: process.argv[2], onConflict: "keep" }));' \
  "${adopt_keep_home}/.roborepo/install-state.json" "${repo_root}"
assert "bundle apply: adopt keep policy stages repo item" \
  bash -c "HOME='${adopt_keep_home}' ROBOREPO_STATE_DIR='${adopt_keep_home}/.roborepo' ROBOREPO_INSTALL_TIMESTAMP=20260615-101500 node '${cli}' bundle apply hooks >'${adopt_keep_home}/out' && grep -q 'local hooks' '${adopt_keep_home}/.claude/hooks' && test -d '${adopt_keep_home}/.claude/hooks_update_20260615-101500' && grep -q 'stage: .*hooks_update_20260615-101500' '${adopt_keep_home}/out'"
assert "bundle remove: adopt keep policy removes staged item only" \
  bash -c "HOME='${adopt_keep_home}' ROBOREPO_STATE_DIR='${adopt_keep_home}/.roborepo' node '${cli}' bundle remove hooks >/dev/null && grep -q 'local hooks' '${adopt_keep_home}/.claude/hooks' && ! test -e '${adopt_keep_home}/.claude/hooks_update_20260615-101500'"

root_keep_home="${work}/root-keep-home"
mkdir -p "${root_keep_home}/.claude" "${root_keep_home}/.codex" "${root_keep_home}/.roborepo"
node -e 'const fs = require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({ repo: process.argv[2], onConflict: "keep" }));' \
  "${root_keep_home}/.roborepo/install-state.json" "${repo_root}"
assert "bundle apply: records root-config writes" \
  bash -c "HOME='${root_keep_home}' ROBOREPO_STATE_DIR='${root_keep_home}/.roborepo' node '${cli}' bundle apply base >/dev/null && HOME='${root_keep_home}' ROBOREPO_STATE_DIR='${root_keep_home}/.roborepo' node '${repo_root}/scripts/cli/root-config-state.mjs' check claude '${root_keep_home}/.claude/settings.json' | grep -q '^clean$'"
printf '{"MANAGED_BY_ROBOREPO":true,"user":"drifted edit"}\n' > "${root_keep_home}/.claude/settings.json"
assert "bundle apply: root-config keep policy does not clear drift" \
  bash -c "HOME='${root_keep_home}' ROBOREPO_STATE_DIR='${root_keep_home}/.roborepo' node '${repo_root}/scripts/cli/root-config-state.mjs' check claude '${root_keep_home}/.claude/settings.json' | grep -q '^drifted$' && HOME='${root_keep_home}' ROBOREPO_STATE_DIR='${root_keep_home}/.roborepo' ROBOREPO_INSTALL_TIMESTAMP=20260615-101500 node '${cli}' bundle apply base >'${root_keep_home}/out' && grep -q 'drifted edit' '${root_keep_home}/.claude/settings.json' && test -f '${root_keep_home}/.claude/settings_update_20260615-101500.json' && HOME='${root_keep_home}' ROBOREPO_STATE_DIR='${root_keep_home}/.roborepo' node '${repo_root}/scripts/cli/root-config-state.mjs' check claude '${root_keep_home}/.claude/settings.json' | grep -q '^drifted$'"

adopt_overwrite_home="${work}/adopt-overwrite-home"
mkdir -p "${adopt_overwrite_home}/.claude" "${adopt_overwrite_home}/.roborepo"
printf 'local hooks\n' > "${adopt_overwrite_home}/.claude/hooks"
node -e 'const fs = require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({ repo: process.argv[2], onConflict: "overwrite" }));' \
  "${adopt_overwrite_home}/.roborepo/install-state.json" "${repo_root}"
assert "bundle apply: adopt overwrite policy backs up local item" \
  bash -c "HOME='${adopt_overwrite_home}' ROBOREPO_STATE_DIR='${adopt_overwrite_home}/.roborepo' ROBOREPO_INSTALL_TIMESTAMP=20260615-101500 node '${cli}' bundle apply hooks >'${adopt_overwrite_home}/out' && grep -q 'local hooks' '${adopt_overwrite_home}/.claude/hooks_original_20260615-101500' && test -d '${adopt_overwrite_home}/.claude/hooks' && grep -q 'backup: .*hooks_original_20260615-101500' '${adopt_overwrite_home}/out'"
assert "bundle remove: adopt overwrite policy restores backed up item" \
  bash -c "HOME='${adopt_overwrite_home}' ROBOREPO_STATE_DIR='${adopt_overwrite_home}/.roborepo' node '${cli}' bundle remove hooks >/dev/null && grep -q 'local hooks' '${adopt_overwrite_home}/.claude/hooks' && ! test -e '${adopt_overwrite_home}/.claude/hooks_original_20260615-101500'"

# Onboarding gate disabled (in-progress feature): install auto-applies defaults, so no command is
# gated on onboarding. These two assertions are kept here, disabled, for reinstatement — see
# docs/plans/completed/onboarding-reinstatement.md §5. They test the forced gate that no longer exists.
# gate_home="${work}/gate-home"
# mkdir -p "${gate_home}/.roborepo"
# node -e 'const fs = require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({ repo: process.argv[2], mode: "managed" }));' \
#   "${gate_home}/.roborepo/install-state.json" "${repo_root}"
# assert "onboard gate: noninteractive command fails before onboarding" \
#   bash -c "cd '${repo_root}' && HOME='${gate_home}' ROBOREPO_STATE_DIR='${gate_home}/.roborepo' ROBOREPO_PRESETS_ONBOARD= node '${cli}' run true >/dev/null 2>&1; test \$? -eq 2"
# assert "onboard gate: explicit bypass allows command" \
#   bash -c "cd '${repo_root}' && HOME='${gate_home}' ROBOREPO_STATE_DIR='${gate_home}/.roborepo' ROBOREPO_PRESETS_ONBOARD= node '${cli}' --no-presets-onboard run true >/dev/null"

# ---------------------------------------------------------------------------
# roborepo mcp add
# ---------------------------------------------------------------------------
mcp_jdoc="$( node "${cli}" mcp add jdocmunch --dry-run )"
assert "mcp add: jdocmunch preset maps to Claude user-scope uvx command" \
  test "${mcp_jdoc}" = $'claude mcp add --scope user jdocmunch -- uvx jdocmunch-mcp\nwould add permission: mcp__jdocmunch -> globals/claude/settings.json\ncodex MCP already present: jdocmunch'

mcp_jcode="$( node "${cli}" mcp add jcodemunch --dry-run )"
assert "mcp add: jcodemunch preset maps to Claude user-scope uvx command" \
  test "${mcp_jcode}" = $'claude mcp add --scope user jcodemunch -- uvx jcodemunch-mcp\nwould add permission: mcp__jcodemunch -> globals/claude/settings.json\ncodex MCP already present: jcodemunch'

assert "mcp add: addMCP alias removed" \
  bash -c "! node '${cli}' addMCP jdocmunch --dry-run >/dev/null 2>&1"

mcp_pkg="$( node "${cli}" mcp add example-mcp --name=example --dry-run -- --flag value )"
assert "mcp add: generic package supports name override and passthrough args" \
  test "${mcp_pkg}" = $'claude mcp add --scope user example -- uvx example-mcp --flag value\nwould add permission: mcp__example -> globals/claude/settings.json\nwould add Codex MCP: example -> globals/codex/config.toml\n[mcp_servers.example]\ncommand = "uvx"\nargs = ["example-mcp", "--flag", "value"]'

mcp_url="$( node "${cli}" mcp add https://mcp.example.com/mcp --name=example --dry-run )"
assert "mcp add: URL defaults to http transport" \
  test "${mcp_url}" = $'claude mcp add --scope user --transport http example https://mcp.example.com/mcp\nwould add permission: mcp__example -> globals/claude/settings.json\nwould add Codex MCP: example -> globals/codex/config.toml\n[mcp_servers.example]\nurl = "https://mcp.example.com/mcp"'

mcp_skip_permission="$( node "${cli}" mcp add jdocmunch --dry-run --skip-claude-permission )"
assert "mcp add: --skip-claude-permission skips settings update" \
  test "${mcp_skip_permission}" = $'claude mcp add --scope user jdocmunch -- uvx jdocmunch-mcp\ncodex MCP already present: jdocmunch'

mcp_only_claude="$( node "${cli}" mcp add jdocmunch --dry-run --only-claude )"
assert "mcp add: --only-claude skips Codex config update" \
  test "${mcp_only_claude}" = $'claude mcp add --scope user jdocmunch -- uvx jdocmunch-mcp\nwould add permission: mcp__jdocmunch -> globals/claude/settings.json'

mcp_only_codex="$( node "${cli}" mcp add jdocmunch --dry-run --only-codex )"
assert "mcp add: --only-codex skips Claude registration and settings update" \
  test "${mcp_only_codex}" = "codex MCP already present: jdocmunch"

assert "mcp add: only flags are mutually exclusive" \
  bash -c "! node '${cli}' mcp add jdocmunch --only-claude --only-codex --dry-run >/dev/null 2>&1"

assert "mcp add: invalid scope rejected" \
  bash -c "! node '${cli}' mcp add jdocmunch --scope=team --dry-run >/dev/null 2>&1"

assert "mcp add: invalid transport rejected" \
  bash -c "! node '${cli}' mcp add https://mcp.example.com/mcp --transport=websocket --dry-run >/dev/null 2>&1"

# ---------------------------------------------------------------------------
# roborepo package-owned commands
# ---------------------------------------------------------------------------
command_home="${work}/command-home"
mkdir -p "${command_home}/.claude" "${command_home}/.codex"
mkdir -p "${command_home}/repo" "${command_home}/docs"
printf 'file\n' > "${command_home}/repo/file.ts"
command_bin="${work}/fake-uvx-bin"
mkdir -p "${command_bin}"
cat > "${command_bin}/uvx" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "--version" ]]; then
  echo "uvx 0.0"
  exit 0
fi
printf '%s\n' "$*" > "$UVX_ARGS_FILE"
EOF
chmod +x "${command_bin}/uvx"

assert "package command: duplicate command ownership in same enable set is rejected" \
  bash -c "cd '${repo_root}' && node -e \"import('./scripts/cli/package-commands.mjs').then(m=>{const pkg={id:'alpha',components:[{type:'command',name:'index code'}],requires:['beta']}; const catalog=[pkg,{id:'beta',components:[{type:'command',name:'index code'}]}]; const r=m.validatePackageCommandOwnership(pkg,{catalog,enabledIds:[]}); process.exit(r.ok?1:0)})\""

bash -c "HOME='${command_home}' ROBOREPO_STATE_DIR='${command_home}/.roborepo' ROBOREPO_SKIP_MCP=1 node '${cli}' enable jcodemunch >/dev/null 2>&1" || true
bash -c "HOME='${command_home}' ROBOREPO_STATE_DIR='${command_home}/.roborepo' ROBOREPO_SKIP_MCP=1 node '${cli}' enable jdocmunch >/dev/null 2>&1" || true

UVX_ARGS_FILE="${command_home}/index-args.txt" PATH="${command_bin}:$PATH" HOME="${command_home}" ROBOREPO_STATE_DIR="${command_home}/.roborepo" node "${cli}" index code "${command_home}/repo/file.ts" >/dev/null
assert "package command: index code uses package-owned command recipe" \
  grep -Fq "jcodemunch-mcp index-file --no-ai-summaries" "${command_home}/index-args.txt"

UVX_ARGS_FILE="${command_home}/watch-args.txt" PATH="${command_bin}:$PATH" HOME="${command_home}" ROBOREPO_STATE_DIR="${command_home}/.roborepo" node "${cli}" watch code "${command_home}/repo" >/dev/null
assert "package command: watch code uses package-owned command recipe" \
  grep -Fq -- "--with watchfiles jcodemunch-mcp watch" "${command_home}/watch-args.txt"

UVX_ARGS_FILE="${command_home}/docs-args.txt" PATH="${command_bin}:$PATH" HOME="${command_home}" ROBOREPO_STATE_DIR="${command_home}/.roborepo" node "${cli}" index docs "${command_home}/docs" >/dev/null
assert "package command: index docs uses package-owned command recipe" \
  grep -Fq "jdocmunch-mcp index-local --path" "${command_home}/docs-args.txt"
assert "package command: index docs preserves marker contract" \
  test -f "${command_home}/docs/.jdm-indexed"

# Real write tests run against a throwaway harness root. roborepo derives repoRoot from
# scripts/cli/paths.mjs (two levels up), so copying scripts/cli/ (which holds the entry main.mjs
# plus every module) lets us test writes without touching this repo. main.mjs imports every
# cli/ module at load time.
mcp_harness="${work}/mcp-harness"
mkdir -p "${mcp_harness}/scripts/cli" "${mcp_harness}/globals/codex" "${mcp_harness}/globals/claude" "${mcp_harness}/manifests/inventory" "${mcp_harness}/manifests/platform"
cp "${repo_root}"/scripts/cli/*.mjs "${mcp_harness}/scripts/cli/"
cp "${repo_root}/manifests/inventory/mcp-presets.json" "${mcp_harness}/manifests/inventory/mcp-presets.json"
cp "${repo_root}/manifests/platform/cli-commands.json" "${mcp_harness}/manifests/platform/cli-commands.json"
printf '[features]\nhooks = true\n' > "${mcp_harness}/globals/codex/config.toml"
printf '{"permissions":{"allow":["Read"]}}\n' > "${mcp_harness}/globals/claude/settings.json"

( cd "${work}" && node "${mcp_harness}/scripts/cli/main.mjs" mcp add https://mcp.example.com/mcp --name=example --only-codex >/dev/null )
assert "mcp add: writes Codex HTTP url block" \
  grep -q 'url = "https://mcp.example.com/mcp"' "${mcp_harness}/globals/codex/config.toml"

( cd "${work}" && node "${mcp_harness}/scripts/cli/main.mjs" mcp add example-mcp --name=stdio-example --only-codex -- --flag value >/dev/null )
assert "mcp add: writes Codex stdio command block" \
  grep -q 'command = "uvx"' "${mcp_harness}/globals/codex/config.toml"
assert "mcp add: writes Codex stdio args block" \
  grep -q 'args = \["example-mcp", "--flag", "value"\]' "${mcp_harness}/globals/codex/config.toml"

( cd "${work}" && node "${mcp_harness}/scripts/cli/main.mjs" mcp add https://mcp.example.com/mcp --name=example --only-codex >/dev/null )
assert "mcp add: Codex write is idempotent" \
  bash -c "test \"\$(grep -c '^\\[mcp_servers.example\\]' '${mcp_harness}/globals/codex/config.toml')\" = 1"

fake_bin="${work}/fake-bin"
mkdir -p "${fake_bin}"
{
  printf '#!/usr/bin/env bash\n'
  printf 'printf "%%s\\n" "$*" > "%s"\n' "${work}/fake-claude-args.txt"
} > "${fake_bin}/claude"
chmod +x "${fake_bin}/claude"
( cd "${work}" && PATH="${fake_bin}:${PATH}" node "${mcp_harness}/scripts/cli/main.mjs" mcp add perm-mcp --name=permtest --only-claude >/dev/null )
assert "mcp add: Claude registration command invoked" \
  grep -q 'mcp add --scope user permtest -- uvx perm-mcp' "${work}/fake-claude-args.txt"
assert "mcp add: Claude permission written after successful registration" \
  grep -q '"mcp__permtest"' "${mcp_harness}/globals/claude/settings.json"

( cd "${work}" && PATH="${fake_bin}:${PATH}" node "${mcp_harness}/scripts/cli/main.mjs" mcp add all-mcp --name=alltest -- --all-flag >/dev/null )
assert "mcp add: default target invokes Claude registration" \
  grep -q 'mcp add --scope user alltest -- uvx all-mcp --all-flag' "${work}/fake-claude-args.txt"
assert "mcp add: default target writes Claude permission" \
  grep -q '"mcp__alltest"' "${mcp_harness}/globals/claude/settings.json"
assert "mcp add: default target writes Codex config" \
  grep -q 'args = \["all-mcp", "--all-flag"\]' "${mcp_harness}/globals/codex/config.toml"

{
  printf '#!/usr/bin/env bash\n'
  printf 'exit 37\n'
} > "${fake_bin}/claude"
chmod +x "${fake_bin}/claude"
assert "mcp add: Claude registration failure exits non-zero" \
  bash -c "cd '${work}' && ! env PATH='${fake_bin}':\"\${PATH}\" node '${mcp_harness}/scripts/cli/main.mjs' mcp add fail-mcp --name=failtest >/dev/null 2>&1"
assert "mcp add: Claude failure does not write permission" \
  bash -c "! grep -q '\"mcp__failtest\"' '${mcp_harness}/globals/claude/settings.json'"
assert "mcp add: Claude failure does not write Codex config" \
  bash -c "! grep -q '^\\[mcp_servers.failtest\\]' '${mcp_harness}/globals/codex/config.toml'"

# ---------------------------------------------------------------------------
# roborepo lifecycle dispatch (doctor + update --dry-run, both read-only)
# ---------------------------------------------------------------------------
update_home="${work}/update-home"
mkdir -p "${update_home}/.claude" "${update_home}/.codex"
cp "${repo_root}/globals/claude/settings.json" "${update_home}/.claude/settings.json"
cp "${repo_root}/globals/codex/config.toml" "${update_home}/.codex/config.toml"
ln -s "${repo_root}/globals/claude/CLAUDE.md" "${update_home}/.claude/CLAUDE.md"
ln -s "${repo_root}/globals/claude/MANAGED_BY_ROBOREPO.md" "${update_home}/.claude/MANAGED_BY_ROBOREPO.md"
ln -s "${repo_root}/globals/claude/commands" "${update_home}/.claude/commands"
ln -s "${repo_root}/globals/claude/hooks" "${update_home}/.claude/hooks"
ln -s "${repo_root}/globals/codex/AGENTS.md" "${update_home}/.codex/AGENTS.md"
ln -s "${repo_root}/globals/codex/commands" "${update_home}/.codex/commands"
ln -s "${repo_root}/globals/codex/hooks.json" "${update_home}/.codex/hooks.json"
ln -s "${repo_root}/globals/codex/MANAGED_BY_ROBOREPO.md" "${update_home}/.codex/MANAGED_BY_ROBOREPO.md"
ln -s "${repo_root}/globals/codex/rules" "${update_home}/.codex/rules"
# Skills are linked per-skill by the installer's enumerate-step, not as dir-level links.

# The mcp-add tests above intentionally exercise source mutation for Claude permissions. Normalize
# generated permission output before lifecycle doctor, which checks generated source drift.
node "${repo_root}/scripts/build/render-agent-permissions.mjs" >/dev/null

assert "lifecycle: roborepo doctor dispatches and passes" \
  bash -c "node '${cli}' doctor >/dev/null 2>&1"
update_out="${work}/update-report.out"
assert "lifecycle: roborepo update --dry-run dispatches and reports changes" \
  bash -c "HOME='${update_home}' node '${cli}' update --dry-run >'${update_out}' 2>&1 && grep -q 'Update change report:' '${update_out}' && grep -q 'unchanged: package registry' '${update_out}'"

update_legacy_home="${work}/update-legacy-home"
mkdir -p "${update_legacy_home}/.claude" "${update_legacy_home}/.codex" "${update_legacy_home}/.roborepo/rules"
cp "${repo_root}/globals/claude/settings.json" "${update_legacy_home}/.claude/settings.json"
cp "${repo_root}/globals/codex/config.toml" "${update_legacy_home}/.codex/config.toml"
printf '<!-- BEGIN managed:roborepo-agents-import -->\n@~/.roborepo/rules/generated-rules.md\n<!-- END managed:roborepo-agents-import -->\n' > "${update_legacy_home}/.claude/CLAUDE.md"
printf '# Generated Harness Rules\n\nlegacy render\n' > "${update_legacy_home}/.roborepo/rules/generated-rules.md"
assert "lifecycle: roborepo update rewrites legacy Claude import wrapper" \
  bash -c "HOME='${update_legacy_home}' ROBOREPO_STATE_DIR='${update_legacy_home}/.roborepo' node '${cli}' update >/dev/null 2>&1 && grep -q 'BEGIN managed:roborepo-code-style' '${update_legacy_home}/.claude/CLAUDE.md' && ! grep -q 'BEGIN managed:roborepo-agents-import' '${update_legacy_home}/.claude/CLAUDE.md' && ! test -e '${update_legacy_home}/.roborepo/rules/generated-rules.md'"
assert "lifecycle: roborepo sync alias removed" \
  bash -c "! HOME='${update_home}' node '${cli}' sync --bad-flag >/dev/null 2>&1"
assert "lifecycle: roborepo install verb removed (first install is the shell bootstrap)" \
  bash -c "! node '${cli}' install --dry-run >/dev/null 2>&1"
assert "lifecycle: roborepo verify dispatches and exits non-zero when not installed" \
  bash -c "! HOME='${work}/not-installed-home' node '${cli}' verify >/dev/null 2>&1"
assert "lifecycle: roborepo rules --check dispatches render verifier" \
  bash -c "cd '${repo_root}' && node '${cli}' rules --check >/dev/null"

# ---------------------------------------------------------------------------
# roborepo menu (numbered fallback via pipe)
# ---------------------------------------------------------------------------
# Capture to a file and grep the file — output contains apostrophes/parens that would break
# quoting if interpolated into `bash -c`.
menu_out="${work}/menu.txt"
printf '\n' | node "${cli}" > "${menu_out}" 2>&1 || true
assert "menu: shows web section header" grep -q "^  web$" "${menu_out}"
assert "menu: shows File Indexing section header" grep -q "File Indexing" "${menu_out}"
assert "menu: shows Add packages section header" grep -q "Add packages" "${menu_out}"
assert "menu: shows Skills section header" grep -q "Skills" "${menu_out}"
assert "menu: shows Telemetry section header" grep -q "Telemetry" "${menu_out}"
assert "menu: shows Maintenance section header" grep -q "Maintenance" "${menu_out}"
assert "menu: shows Other section header" grep -q "Other" "${menu_out}"
assert "menu: numbers actions but not headers (web is 1)" grep -qE "1\) web" "${menu_out}"
assert "menu: items have descriptions" grep -q "health check" "${menu_out}"
assert "menu: numbered fallback cancels on out-of-range/blank" \
  bash -c "printf '99\n' | node '${cli}' 2>&1 | grep -q 'cancelled'"

# ---------------------------------------------------------------------------
# install-global-commands.sh PATH wiring (isolated via a fake HOME under the temp dir,
# never touching the real ~). Verifies: profile chosen by SHELL, PATH line appended once,
# and the unknown-shell branch warns instead of writing a profile the shell won't read.
# ---------------------------------------------------------------------------
igc="${repo_root}/scripts/install/install-global-commands.sh"

# zsh: writes ~/.zshrc (created if missing) with the PATH line.
zhome="${work}/home-zsh"
mkdir -p "${zhome}"
SHELL=/bin/zsh HOME="${zhome}" ROBOREPO_SHELL_PROFILE="" bash "${igc}" >/dev/null 2>&1 || true
assert "install: zsh profile gets PATH line" \
  bash -c "grep -q '.local/bin' '${zhome}/.zshrc'"

# Re-run is idempotent: the PATH line is not duplicated.
SHELL=/bin/zsh HOME="${zhome}" ROBOREPO_SHELL_PROFILE="" bash "${igc}" >/dev/null 2>&1 || true
assert "install: PATH line not duplicated on re-run" \
  bash -c "test \"\$(grep -c 'export PATH=\"\${HOME}/.local/bin' '${zhome}/.zshrc')\" = 1"

# bash: the PATH line lands in the file the current OS's login/interactive shell actually reads —
# ~/.bash_profile on macOS, ~/.bashrc on Linux. Test the OS-appropriate target.
bhome="${work}/home-bash"
mkdir -p "${bhome}"
if [[ "$(uname -s)" == "Darwin" ]]; then bash_profile="${bhome}/.bash_profile"; else bash_profile="${bhome}/.bashrc"; fi
SHELL=/bin/bash HOME="${bhome}" ROBOREPO_SHELL_PROFILE="" bash "${igc}" >/dev/null 2>&1 || true
assert "install: bash PATH line lands in the OS-correct profile" \
  grep -q ".local/bin" "${bash_profile}"

# Unknown shell (fish) with no ~/.profile: warn + don't write a profile file.
fhome="${work}/home-fish"
mkdir -p "${fhome}"
fish_out="${work}/fish.txt"
SHELL=/usr/bin/fish HOME="${fhome}" ROBOREPO_SHELL_PROFILE="" bash "${igc}" > "${fish_out}" 2>&1 || true
assert "install: unknown shell warns instead of guessing" \
  grep -qi "could not determine a shell profile" "${fish_out}"
assert "install: unknown shell does not create ~/.zshrc" \
  bash -c "! test -e '${fhome}/.zshrc'"

# ---------------------------------------------------------------------------
# Prune pass: a prior install left stale ~/.zshrc `source` lines for removed shell helpers.
# Re-running install-shell-snippets.sh should remove them and preserve the user's own content.
# Isolated via a fake HOME.
# ---------------------------------------------------------------------------
# Stale ~/.zshrc snippet source lines for removed helpers.
iss="${repo_root}/scripts/install/install-shell-snippets.sh"
shome="${work}/home-snip"
mkdir -p "${shome}"
{
  echo "# my own stuff"
  echo "alias ll='ls -la'"
  echo ""
  echo "# Harness config shell helpers"
  echo "source \"${repo_root}/shell/jcodemunch.zsh\""
  echo ""
  echo "# Harness config shell helpers"
  echo "source \"${repo_root}/shell/jdocmunch.zsh\""
} > "${shome}/.zshrc"
HOME="${shome}" bash "${iss}" >/dev/null 2>&1 || true
assert "prune: stale jcodemunch.zsh source line removed" \
  bash -c "! grep -q 'shell/jcodemunch.zsh' '${shome}/.zshrc'"
assert "prune: stale jdocmunch.zsh source line removed" \
  bash -c "! grep -q 'shell/jdocmunch.zsh' '${shome}/.zshrc'"
assert "prune: user's own .zshrc content preserved" \
  grep -q "alias ll='ls -la'" "${shome}/.zshrc"

empty_shome="${work}/home-empty-snip"
mkdir -p "${empty_shome}"
HOME="${empty_shome}" bash "${iss}" >/dev/null 2>&1 || true
assert "snippets: no configured snippets does not create ~/.zshrc" \
  bash -c "! test -e '${empty_shome}/.zshrc'"

# ---------------------------------------------------------------------------
# repair + relocation-resilient uninstall (isolated fake HOME + two checkout paths).
# Reproduces the moved/renamed-repo failure: install from an "old" checkout path, rename the
# checkout, then assert that (a) uninstall reclaims the now-dangling prior-path links, and
# (b) `roborepo repair` relinks everything against the new checkout and rewrites install state.
# Real /tmp is a symlink to /private/tmp on macOS; resolve to a real path so manifest targets
# and realpath-based doctor agree.
# ---------------------------------------------------------------------------
reloc_root="$(cd "${work}" && pwd -P)"

# -- relocation-resilient uninstall --
un_home="${reloc_root}/reloc-uninstall/home"
un_old="${reloc_root}/reloc-uninstall/harness_configs"
un_new="${reloc_root}/reloc-uninstall/roborepo"
mkdir -p "${un_home}/.claude" "${un_home}/.codex" "${un_home}/.local/bin"
cp -R "${repo_root}" "${un_old}"
HOME="${un_home}" ROBOREPO_STATE_DIR="${un_home}/.roborepo" ROBOREPO_ASSUME_INTERACTIVE=0 \
  ROBOREPO_ON_CONFLICT=overwrite bash "${un_old}/scripts/install/main.sh" >/dev/null 2>&1 || true
mv "${un_old}" "${un_new}"   # rename -> all managed links now dangle to the old path
HOME="${un_home}" ROBOREPO_STATE_DIR="${un_home}/.roborepo" \
  bash "${un_new}/scripts/install/uninstall.sh" >/dev/null 2>&1 || true
assert "repair: stale uninstall removes dangling prior-path managed links" \
  bash -c "test \"\$(find '${un_home}/.claude' '${un_home}/.codex' '${un_home}/.local/bin' -maxdepth 2 -type l 2>/dev/null | wc -l | tr -d ' ')\" = 0"

# -- repair after relocation --
rp_home="${reloc_root}/reloc-repair/home"
rp_old="${reloc_root}/reloc-repair/harness_configs"
rp_new="${reloc_root}/reloc-repair/roborepo"
rp_state="${rp_home}/.roborepo"
mkdir -p "${rp_home}/.claude" "${rp_home}/.codex" "${rp_home}/.local/bin"
cp -R "${repo_root}" "${rp_old}"
HOME="${rp_home}" ROBOREPO_STATE_DIR="${rp_state}" ROBOREPO_ASSUME_INTERACTIVE=0 \
  ROBOREPO_ON_CONFLICT=overwrite bash "${rp_old}/scripts/install/main.sh" >/dev/null 2>&1 || true
mv "${rp_old}" "${rp_new}"
assert "repair: bin link dangles after relocation (precondition)" \
  bash -c "! test -e '${rp_home}/.local/bin/roborepo'"
HOME="${rp_home}" ROBOREPO_STATE_DIR="${rp_state}" \
  bash "${rp_new}/scripts/install/repair.sh" >/dev/null 2>&1 || true
assert "repair: bin link healed to new checkout" \
  bash -c "test \"\$(readlink '${rp_home}/.local/bin/roborepo')\" = '${rp_new}/bin/roborepo'"
assert "repair: base Claude support skill cache link created after repair" \
  bash -c "test -L '${rp_home}/.claude/skills/roborepo-support' && test \"\$(readlink '${rp_home}/.claude/skills/roborepo-support')\" = '${rp_home}/.roborepo/skills/roborepo-support' && test -d '${rp_home}/.roborepo/skills/roborepo-support' && test -e '${rp_home}/.roborepo/skills/roborepo-support/.roborepo-managed' && diff -rq -x .roborepo-managed '${rp_new}/globals/agents/skills/roborepo-support' '${rp_home}/.roborepo/skills/roborepo-support' >/dev/null 2>&1 && ! test -e '${rp_home}/.claude/skills/case-study'"
assert "repair: base Codex support skill cache link created after repair" \
  bash -c "test -L '${rp_home}/.codex/skills/roborepo-support' && test \"\$(readlink '${rp_home}/.codex/skills/roborepo-support')\" = '${rp_home}/.roborepo/skills/roborepo-support' && test -d '${rp_home}/.roborepo/skills/roborepo-support' && test -e '${rp_home}/.roborepo/skills/roborepo-support/.roborepo-managed' && diff -rq -x .roborepo-managed '${rp_new}/globals/agents/skills/roborepo-support' '${rp_home}/.roborepo/skills/roborepo-support' >/dev/null 2>&1 && ! test -e '${rp_home}/.codex/skills/case-study'"
assert "repair: install state records the new checkout path" \
  grep -q "\"repo\": \"${rp_new}\"" "${rp_state}/install-state.json"
# Idempotent: a second repair reclaims nothing (everything already points at the new checkout).
reclaim2="$(HOME="${rp_home}" ROBOREPO_STATE_DIR="${rp_state}" bash "${rp_new}/scripts/install/repair.sh" 2>&1 | grep -cE '^reclaim' || true)"
assert "repair: idempotent re-run reclaims nothing" test "${reclaim2}" = "0"

# -- repair ignores copied content dirs and still heals the moved checkout --
rp_keep_home="${reloc_root}/reloc-repair-keep/home"
rp_keep_old="${reloc_root}/reloc-repair-keep/harness_configs"
rp_keep_new="${reloc_root}/reloc-repair-keep/roborepo"
rp_keep_state="${rp_keep_home}/.roborepo"
mkdir -p "${rp_keep_home}/.claude" "${rp_keep_home}/.codex" "${rp_keep_home}/.local/bin"
cp -R "${repo_root}" "${rp_keep_old}"
HOME="${rp_keep_home}" ROBOREPO_STATE_DIR="${rp_keep_state}" ROBOREPO_ASSUME_INTERACTIVE=0 \
  ROBOREPO_ON_CONFLICT=overwrite bash "${rp_keep_old}/scripts/install/main.sh" >/dev/null 2>&1 || true
mv "${rp_keep_old}" "${rp_keep_new}"
mkdir -p "${rp_keep_home}/.claude/commands"
echo "local command" > "${rp_keep_home}/.claude/commands/local.txt"
repair_keep_out="$(HOME="${rp_keep_home}" ROBOREPO_STATE_DIR="${rp_keep_state}" \
  bash "${rp_keep_new}/scripts/install/repair.sh" 2>&1 || true)"
assert "repair: copied commands dir survives a repair run" \
  bash -c "test -d '${rp_keep_home}/.claude/commands' && test -f '${rp_keep_home}/.claude/commands/local.txt'"
assert "repair: copied commands dir does not trigger a prompt" \
  bash -c "! echo '${repair_keep_out}' | grep -q 'Choose:' && ! echo '${repair_keep_out}' | grep -q 'Merge review prompt:'"
assert "repair: keep-run still heals bin link" \
  bash -c "test \"\$(readlink '${rp_keep_home}/.local/bin/roborepo')\" = '${rp_keep_new}/bin/roborepo'"

# -- install heals a dangling bin link instead of erroring --
heal_home="${reloc_root}/heal-bin/home"
mkdir -p "${heal_home}/.local/bin"
ln -s "${reloc_root}/heal-bin/gone/bin/roborepo" "${heal_home}/.local/bin/roborepo"  # dangling
heal_out="$(HOME="${heal_home}" bash "${repo_root}/scripts/install/install-global-commands.sh" --dry-run 2>&1 || true)"
assert "install: dangling bin link is reclaimed, not a conflict" \
  bash -c "echo '${heal_out}' | grep -q 'was dangling' && ! echo '${heal_out}' | grep -q 'conflict:'"

# ---------------------------------------------------------------------------
# legacy ~/.agents/skills teardown (native-alignment item 0.5 migration).
# Pre-native-alignment installs fanned skills via a dir-level ~/.agents/skills managed symlink that
# Codex also scanned. After migrating to cache-backed skill views, that leftover causes duplicate
# discovery. install must reclaim the managed legacy link (and only the managed one).
# Copy-free: the checkout never moves here, so install runs against the real repo_root into an
# isolated HOME (no repo copy needed, unlike the relocation tests above).
# ---------------------------------------------------------------------------
la_home="${reloc_root}/legacy-agents/home"
mkdir -p "${la_home}/.claude" "${la_home}/.codex" "${la_home}/.local/bin" "${la_home}/.agents"
ln -s "${repo_root}/globals/agents/skills" "${la_home}/.agents/skills"  # the old dir-level managed link
HOME="${la_home}" ROBOREPO_STATE_DIR="${la_home}/.roborepo" ROBOREPO_ASSUME_INTERACTIVE=0 \
  ROBOREPO_ON_CONFLICT=overwrite bash "${repo_root}/scripts/install/main.sh" >/dev/null 2>&1 || true
assert "legacy: managed ~/.agents/skills link removed after install" \
  bash -c "! test -L '${la_home}/.agents/skills'"
assert "legacy: base Codex support skill cache link created in place of the legacy dir link" \
  bash -c "test -d '${la_home}/.codex/skills/roborepo-support' && test -e '${la_home}/.codex/skills/roborepo-support/.roborepo-managed' && diff -rq -x .roborepo-managed '${repo_root}/globals/agents/skills/roborepo-support' '${la_home}/.codex/skills/roborepo-support' >/dev/null 2>&1 && ! test -e '${la_home}/.codex/skills/case-study'"

# A user's real ~/.agents/skills (not a managed symlink) must be left untouched.
lu_home="${reloc_root}/legacy-agents-userdir/home"
mkdir -p "${lu_home}/.claude" "${lu_home}/.codex" "${lu_home}/.local/bin" "${lu_home}/.agents/skills/mine"
HOME="${lu_home}" ROBOREPO_STATE_DIR="${lu_home}/.roborepo" ROBOREPO_ASSUME_INTERACTIVE=0 \
  ROBOREPO_ON_CONFLICT=overwrite bash "${repo_root}/scripts/install/main.sh" >/dev/null 2>&1 || true
assert "legacy: real ~/.agents/skills user dir is preserved, not reclaimed" \
  bash -c "test -d '${lu_home}/.agents/skills/mine'"

# --------------------------------------------------------------------------- onboarding / defaults
# Minimal default: install seeds only the `base` bundle; everything else is opt-in via the wizard.
assert "onboard: presets.json default is base-only" \
  bash -c "node -e 'const d=require(\"${repo_root}/manifests/platform/presets.json\"); process.exit(JSON.stringify(d.default)===JSON.stringify([\"base\"])?0:1)'"

# Non-TTY `onboard` takes the headless path: applies the default + records onboardedAt (no prompt,
# no hang). Run in an isolated HOME/state so it never touches the real machine.
ob_home="$(mktemp -d "${work}/onboard-home.XXXXXX")"
mkdir -p "${ob_home}/.claude" "${ob_home}/.codex"
HOME="${ob_home}" ROBOREPO_STATE_DIR="${ob_home}/.roborepo" \
  node "${cli}" onboard < /dev/null > "${ob_home}/out.txt" 2>&1 || true
assert "onboard: non-TTY reports headless apply" \
  grep -q "applying the default configuration" "${ob_home}/out.txt"
assert "onboard: non-TTY records onboardedAt in preset state" \
  bash -c "test -f '${ob_home}/.roborepo/presets/state.json' && grep -q onboardedAt '${ob_home}/.roborepo/presets/state.json'"

# The wizard flips item.active in memory during the keypress loop, then applies only the changed rows
# on exit. Unit-test that deferred-apply selection directly (pure, fast); the pty/keypress path is
# covered by test-install-collisions.sh.
assert "onboard: wizard diff selects only changed toggleable items" \
  node "${repo_root}/scripts/test/wizard-diff-check.mjs"

# Root config drift detection (scripts/cli/root-config-state.mjs): a hash sidecar tells "roborepo's
# baseline changed" apart from "something else touched the file since roborepo's last write."
assert "root-config-state: drift detection distinguishes baseline changes from user edits" \
  node "${repo_root}/scripts/test/root-config-state-check.mjs"

# Root config drift VIEW (buildRootConfigView in config.mjs): the per-harness state the terminal
# `config root inspect` report and the web /config drift chip both render from — not-installed /
# unwritten / in-sync / drifted / staged-pending.
assert "root-config-view: per-harness drift state covers every user-facing case" \
  node "${repo_root}/scripts/test/root-config-view-check.mjs"

# ---------------------------------------------------------------------------
echo ""
echo "roborepo tests: ${pass} passed, ${fail} failed"
[[ "${fail}" -eq 0 ]]

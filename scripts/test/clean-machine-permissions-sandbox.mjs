#!/usr/bin/env node

import {
  dockerSandboxConfig,
  packageName,
  requireDockerOrSkip,
  runDockerScript,
  withPackedPackage,
} from "./lib/docker-sandbox.mjs";

const label = "clean-machine permissions sandbox";
const { image, strict } = dockerSandboxConfig();
if (!requireDockerOrSkip({ label, image, strict })) {
  process.exit(0);
}

await withPackedPackage(({ packDest, tarballName }) => {
  const script = permissionsScript({ packageName, tarballName });
  return runDockerScript({ label, packDest, script });
});

function permissionsScript({ packageName, tarballName }) {
  return `
set -eu

label="permissions"
home="/tmp/rr-\${label}-home"
state="/tmp/rr-\${label}-state"
workspace="/tmp/rr-\${label}-workspace"
cache="/tmp/rr-\${label}-npm-cache"
prefix="/tmp/rr-\${label}-prefix"
fakebin="/tmp/rr-\${label}-fakebin"

rm -rf "$home" "$state" "$workspace" "$cache" "$prefix" "$fakebin"
mkdir -p "$home" "$state" "$workspace" "$cache" "$prefix" "$fakebin"
mkdir -p "$home/.claude" "$home/.codex" "$home/.gemini"

for harness in claude codex gemini; do
  cat > "$fakebin/$harness" <<'SH'
#!/bin/sh
echo "fake harness"
SH
  chmod +x "$fakebin/$harness"
done

export HOME="$home"
export ROBOREPO_MODE=package
export ROBOREPO_STATE_ROOT="$state"
export ROBOREPO_WORKSPACE_ROOT="$workspace"
export ROBOREPO_PRESETS_ONBOARD=skip
export PATH="$fakebin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

echo "clean-machine[$label]: npm install"
npm install -g --prefix "$prefix" --cache "$cache" --no-audit --no-fund "/artifacts/${tarballName}"
export PATH="$prefix/bin:$PATH"

echo "clean-machine[$label]: roborepo init"
roborepo init
echo "clean-machine[$label]: roborepo config permissions"
roborepo config permissions

claude_settings="$HOME/.claude/settings.json"
codex_config="$HOME/.codex/config.toml"
gemini_policy="$HOME/.gemini/policies/roborepo-permissions.toml"

test -f "$claude_settings"
test -f "$codex_config"
test -f "$gemini_policy"

assert_contains() {
  needle="$1"
  file="$2"
  if grep -F "$needle" "$file" >/dev/null; then
    return 0
  fi
  echo "FAIL: expected $file to contain: $needle" >&2
  echo "----- $file -----" >&2
  sed -n '1,160p' "$file" >&2
  echo "-----------------" >&2
  exit 1
}

echo "clean-machine[$label]: assert Claude permissions"
assert_contains 'Read(~/.ssh/**)' "$claude_settings"
assert_contains '"matcher": "Read|Write|Edit"' "$claude_settings"
assert_contains 'repo-write-scope.mjs' "$claude_settings"
test -f "$HOME/.claude/hooks/provider/repo-write-scope.mjs"

echo "clean-machine[$label]: assert Codex permissions"
assert_contains 'default_permissions = "roborepo-workspace"' "$codex_config"
assert_contains '[permissions.roborepo-workspace]' "$codex_config"
assert_contains '[permissions.roborepo-workspace.workspace_roots]' "$codex_config"
assert_contains '"~/.worktrees/roborepo" = true' "$codex_config"
assert_contains 'enabled = false' "$codex_config"
if grep -F 'sandbox_mode = "workspace-write"' "$codex_config" >/dev/null; then
  echo "FAIL: Codex permissions still use legacy sandbox_mode instead of profile roots" >&2
  exit 1
fi

echo "clean-machine[$label]: assert Gemini permissions"
assert_contains 'toolName = ["write_file", "replace"]' "$gemini_policy"
assert_contains 'toolName = "read_file"' "$gemini_policy"

echo "clean-machine[$label]: assert no stale personal path scopes"
for file in "$claude_settings" "$codex_config" "$gemini_policy"; do
  if grep -F "$HOME" "$file" >/dev/null; then
    echo "FAIL: projected permissions contain expanded sandbox HOME in $file" >&2
    exit 1
  fi
  if grep -F '~/projects/**' "$file" >/dev/null; then
    echo "FAIL: projected permissions contain stale ~/projects scope in $file" >&2
    exit 1
  fi
done

echo "clean-machine[$label]: roborepo uninstall"
roborepo uninstall --yes

echo "clean-machine[$label]: npm uninstall"
npm uninstall -g --prefix "$prefix" --no-audit --no-fund "${packageName}"
if [ -e "$prefix/bin/roborepo" ]; then
  echo "FAIL: roborepo binary survived npm uninstall on disk at $prefix/bin/roborepo" >&2
  exit 1
fi

echo "clean-machine permissions sandbox passed"
`;
}

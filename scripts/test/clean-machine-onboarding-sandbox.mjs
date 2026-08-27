#!/usr/bin/env node

// Onboarding/init-lifecycle machine shapes that a redirected-HOME unit test cannot produce: a real
// npm-installed binary and a real clean PATH. See docs/internal/docker-test-sandboxes.md.
//
// initialization-lifecycle-check.mjs already proves the state machine itself (missing/in-progress/
// complete, corrupt-record tolerance, schema validation, downgrade guard, routing, startedAt
// preservation across resume) in-process. This script does not re-prove that logic — it proves the
// real installed CLI reaches the same behavior, and covers a shape that in-process coverage cannot
// reach at all: a harness home directory with no root config file underneath it yet.
//
// Cases here use one fake harness (claude) except the root-config-missing case, which needs one
// case per provider adapter — the config file shape differs per provider (settings.json vs
// config.toml vs policies/*.toml), and that boundary is exactly what the provider/adapter split is
// for. Harness-count/detection-matrix coverage across all three providers already lives in
// clean-machine-container-check.mjs; this file does not duplicate it.

import {
  dockerSandboxConfig,
  packageName,
  requireDockerOrSkip,
  runDockerScript,
  withPackedPackage,
} from "./lib/docker-sandbox.mjs";

const label = "clean-machine onboarding sandbox";
const { image, strict } = dockerSandboxConfig();
if (!requireDockerOrSkip({ label, image, strict })) {
  process.exit(0);
}

await withPackedPackage(({ packDest, tarballName }) => {
  const script = onboardingScript({ packageName, tarballName });
  return runDockerScript({ label, packDest, script });
});

function onboardingScript({ packageName, tarballName }) {
  return `
set -eu

fresh_env() {
  label="$1"
  home="/tmp/rr-\${label}-home"
  state="/tmp/rr-\${label}-state"
  workspace="/tmp/rr-\${label}-workspace"

  rm -rf "$home" "$state" "$workspace"
  mkdir -p "$home" "$state" "$workspace"

  export HOME="$home"
  export ROBOREPO_STATE_ROOT="$state"
  export ROBOREPO_WORKSPACE_ROOT="$workspace"
  export ROBOREPO_PRESETS_ONBOARD=skip
  export PATH="$install_prefix/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
}

echo "onboarding-sandbox: npm install (shared across cases)"
install_prefix="/tmp/rr-onboarding-prefix"
install_cache="/tmp/rr-onboarding-npm-cache"
rm -rf "$install_prefix" "$install_cache"
mkdir -p "$install_prefix" "$install_cache"
npm install -g --prefix "$install_prefix" --cache "$install_cache" --no-audit --no-fund "/artifacts/${tarballName}" >/dev/null 2>&1

# --- Case 2: installed but never initialized. A bare non-interactive invocation must not force
# init and must not crash; explicit commands (doctor, version) must work pre-init. ---
echo "case 2: installed, not initialized"
fresh_env case2
if [ -e "$state/initialization.json" ]; then
  echo "FAIL: fresh install must not have an initialization record" >&2
  exit 1
fi
roborepo doctor --quiet
roborepo version >/dev/null
if [ -e "$state/initialization.json" ]; then
  echo "FAIL: doctor/version must not implicitly initialize" >&2
  exit 1
fi
echo "case 2: OK"

# --- Case 5: harness home directory exists (so discovery/config code sees a real dir), but its
# root config file is absent. One sub-case per provider: the file each expects differs by adapter. ---
echo "case 5: harness home exists, root config missing"
fresh_env case5
mkdir -p "/tmp/rr-case5-fakebin"
for harness in claude codex gemini; do
  cat > "/tmp/rr-case5-fakebin/$harness" <<'SH'
#!/bin/sh
echo "fake harness"
SH
  chmod +x "/tmp/rr-case5-fakebin/$harness"
done
export PATH="/tmp/rr-case5-fakebin:$PATH"
mkdir -p "$HOME/.claude" "$HOME/.codex" "$HOME/.gemini"
# Deliberately no settings.json / config.toml / policies dir underneath any of them.
roborepo init
roborepo doctor --quiet
roborepo config permissions
test -f "$HOME/.claude/settings.json" || { echo "FAIL: claude root config not created from a home-without-config start" >&2; exit 1; }
test -f "$HOME/.codex/config.toml" || { echo "FAIL: codex root config not created from a home-without-config start" >&2; exit 1; }
test -f "$HOME/.gemini/policies/roborepo-permissions.toml" || { echo "FAIL: gemini root config not created from a home-without-config start" >&2; exit 1; }
echo "case 5: OK"

# --- Case 6: a state directory shaped like an older roborepo release left it -- an
# initialization.json missing fields the current build expects (pre-migration shape), rather than
# the "newer schema" direction already covered in-process. Must not crash; must be treated as
# unreadable/incomplete rather than trusted as complete. ---
echo "case 6: prior roborepo state from an older version"
fresh_env case6
mkdir -p "$state"
# An older, pre-schemaVersion record shape: no schemaVersion/workflowVersion fields at all.
printf '{"initialized": true, "version": "0.1.0"}' > "$state/initialization.json"
roborepo doctor --quiet
roborepo init
test -f "$state/initialization.json" || { echo "FAIL: init did not (re)write an initialization record" >&2; exit 1; }
grep -q '"schemaVersion"' "$state/initialization.json" || { echo "FAIL: legacy-shaped record was not normalized to the current schema" >&2; exit 1; }
echo "case 6: OK"

# --- Case 7: partial/corrupt initialization state, resumed by a real installed binary.
#
# Killing a real \`roborepo init\` mid-flight was tried and dropped: inside this container, a
# zero-harness init with presets skipped completes in single-digit milliseconds -- faster than any
# shell-level polling loop can observe and react to, so there is no reliable window to kill into.
# initialization-lifecycle-check.mjs already proves malformed/corrupt JSON tolerance in-process;
# what that suite cannot prove is that the real installed CLI resumes an in-progress record left on
# disk rather than replaying the wizard from scratch. This constructs the record an interrupted run
# would have left (status in-progress, no completedAt, a real past startedAt) and asserts the real
# \`roborepo init\` resumes it: reaches complete, and preserves the original startedAt rather than
# resetting it -- the same preservation rule testResumePreservesStartedAt asserts in-process, now
# checked through the actual CLI end to end. ---
echo "case 7: partial initialization state, resumed by the real CLI"
fresh_env case7
original_started_at="2020-01-01T00:00:00.000Z"
cat > "$state/initialization.json" <<JSON
{
  "schemaVersion": 1,
  "workflowVersion": 1,
  "status": "in-progress",
  "startedAt": "$original_started_at",
  "completedAt": null
}
JSON
roborepo init
grep -q '"status": "complete"' "$state/initialization.json" || { echo "FAIL: resumed init did not reach complete" >&2; exit 1; }
grep -q '"startedAt": "'"$original_started_at"'"' "$state/initialization.json" || { echo "FAIL: resume must preserve the original startedAt, not reset it" >&2; exit 1; }
roborepo doctor --quiet
echo "case 7: OK"

echo "clean-machine onboarding sandbox passed"
`;
}

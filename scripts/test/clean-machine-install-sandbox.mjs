#!/usr/bin/env node

import {
  dockerSandboxConfig,
  packageName,
  requireDockerOrSkip,
  runDockerScript,
  withPackedPackage,
} from "./lib/docker-sandbox.mjs";

const label = "clean-machine install sandbox";
const { image, strict } = dockerSandboxConfig();
if (!requireDockerOrSkip({ label, image, strict })) {
  process.exit(0);
}

await withPackedPackage(({ packDest, tarballName }) => {
  const script = cleanMachineScript({ packageName, tarballName });
  return runDockerScript({ label, packDest, script });
});

function cleanMachineScript({ packageName, tarballName }) {
  return `
set -eu

run_case() {
  label="$1"
  prefix="$2"
  home="/tmp/rr-\${label}-home"
  state="\${3:-/tmp/rr-\${label}-state}"
  workspace="\${4:-/tmp/rr-\${label}-workspace}"
  cache="/tmp/rr-\${label}-npm-cache"
  cwd="/tmp/rr-\${label}-cwd"
  if [ "$prefix" = "__HOME_LOCAL__" ]; then
    prefix="$home/.local"
  fi

  rm -rf "$home" "$state" "$workspace" "$cache" "$cwd" "$prefix"
  mkdir -p "$home" "$state" "$workspace" "$cache" "$cwd" "$prefix"

  export HOME="$home"
  export ROBOREPO_MODE=package
  export ROBOREPO_STATE_ROOT="$state"
  export ROBOREPO_WORKSPACE_ROOT="$workspace"
  export ROBOREPO_PRESETS_ONBOARD=skip
  export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

  for harness in claude codex gemini; do
    if command -v "$harness" >/dev/null 2>&1; then
      echo "FAIL: clean PATH unexpectedly exposes $harness at $(command -v "$harness")" >&2
      exit 1
    fi
  done

  echo "clean-machine[$label]: npm install"
  npm install -g --prefix "$prefix" --cache "$cache" --no-audit --no-fund "/artifacts/${tarballName}"
  export PATH="$prefix/bin:$PATH"

  echo "clean-machine[$label]: roborepo version"
  roborepo version | grep -q 'mode: package'
  echo "clean-machine[$label]: roborepo init"
  roborepo init
  echo "clean-machine[$label]: roborepo doctor"
  roborepo doctor --quiet
  echo "clean-machine[$label]: roborepo uninstall"
  roborepo uninstall --yes
  test -d "$workspace"

  echo "clean-machine[$label]: npm uninstall"
  npm uninstall -g --prefix "$prefix" --no-audit --no-fund "${packageName}"
  if [ -e "$prefix/bin/roborepo" ]; then
    echo "FAIL: roborepo binary survived npm uninstall on disk at $prefix/bin/roborepo" >&2
    exit 1
  fi
  hash -r 2>/dev/null || true
  if command -v roborepo >/dev/null 2>&1; then
    echo "FAIL: roborepo binary survived npm uninstall at $(command -v roborepo)" >&2
    exit 1
  fi
}

run_case standard /tmp/rr-standard-prefix
run_case colliding __HOME_LOCAL__

# Case 8: package-mode state/workspace roots in unusual filesystem shapes -- a path with spaces,
# deep nesting, and a symlinked root. A temp-dir unit test would not naturally land on any of these.
mkdir -p "/tmp/rr with spaces/deep/nested/target"
ln -sfn "/tmp/rr with spaces/deep/nested/target" /tmp/rr-unusual-roots-link
run_case unusual-roots /tmp/rr-unusual-roots-prefix "/tmp/rr with spaces/state" "/tmp/rr-unusual-roots-link/workspace"

echo "clean-machine install sandbox passed"
`;
}

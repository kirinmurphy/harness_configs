#!/usr/bin/env bash
# Shared install-state helpers. Source this file, do not execute directly.

roborepo_state_dir() {
  echo "${ROBOREPO_STATE_DIR:-${HOME}/.roborepo}"
}

roborepo_state_file() {
  echo "$(roborepo_state_dir)/install-state.json"
}

read_install_repo() {
  local state_file
  state_file="$(roborepo_state_file)"
  [[ -f "${state_file}" ]] || return 1

  node -e '
const fs = require("fs");
try {
  const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (state && typeof state.repo === "string" && state.repo.length > 0) {
    console.log(state.repo);
    process.exit(0);
  }
} catch {}
process.exit(1);
' "${state_file}"
}

read_install_on_conflict() {
  local state_file
  state_file="$(roborepo_state_file)"
  [[ -f "${state_file}" ]] || return 1

  node -e '
const fs = require("fs");
try {
  const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (state && (state.onConflict === "overwrite" || state.onConflict === "keep")) {
    console.log(state.onConflict);
    process.exit(0);
  }
} catch {}
process.exit(1);
' "${state_file}"
}

write_install_state() {
  local on_conflict="${1:-}"
  local state_file state_dir
  state_dir="$(roborepo_state_dir)"
  state_file="$(roborepo_state_file)"

  if [[ "${dry_run:-0}" -eq 1 ]]; then
    echo "state: would record install state at ${state_file}"
    return 0
  fi

  mkdir -p "${state_dir}"
  node -e '
const fs = require("fs");
const path = require("path");
const [stateFile, repoRoot, onConflict] = process.argv.slice(1);
const persistedOnConflict = onConflict === "overwrite" || onConflict === "keep" ? onConflict : undefined;
const state = {
  repo: repoRoot,
  onConflict: persistedOnConflict,
  updatedAt: new Date().toISOString(),
  harnesses: {
    claude: { onConflict: persistedOnConflict },
    codex: { onConflict: persistedOnConflict },
  },
};
fs.mkdirSync(path.dirname(stateFile), { recursive: true });
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n");
' "${state_file}" "${repo_root}" "${on_conflict}"
  if [[ -n "${on_conflict}" ]]; then
    echo "state: ${state_file} on-conflict=${on_conflict}"
  else
    echo "state: ${state_file}"
  fi
}

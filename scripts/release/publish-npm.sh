#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"

tag="beta"
preid="beta"
explicit_version=""
dry_run=0
next_release_info=0
yes=0
allow_latest=0
backup_dir=""
version_written=0
publish_started=0

cleanup() {
  local status=$?
  if [[ "${status}" -ne 0 && "${version_written}" -eq 1 && "${publish_started}" -eq 0 ]]; then
    if [[ -n "${backup_dir}" && -f "${backup_dir}/package.json" ]]; then
      cp "${backup_dir}/package.json" package.json
      echo "restored package.json after failed pre-publish check" >&2
    fi
  fi
  if [[ -n "${backup_dir}" ]]; then
    rm -rf "${backup_dir}"
  fi
}
trap cleanup EXIT

usage() {
  cat <<'EOF'
usage: scripts/release/publish-npm.sh [options]

Options:
  --version <version>      Publish this exact version instead of bumping prerelease.
  --preid <id>            Prerelease id for automatic bump (default: beta).
  --tag <tag>             npm dist-tag to publish (default: beta).
  --latest                Allow publishing with --tag latest.
  --dry-run               Run preflight/checks and print publish command, but do not bump or publish.
  --next-release-info     Show next version/install command without git, npm, or network checks.
  --yes                   Do not prompt before publish.
  -h, --help              Show this help.

Default target is the next prerelease for package.json's current version.
EOF
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --version)
      explicit_version="${2:-}"
      [[ -n "${explicit_version}" ]] || { echo "error: --version requires a value" >&2; exit 2; }
      shift 2
      ;;
    --preid)
      preid="${2:-}"
      [[ -n "${preid}" ]] || { echo "error: --preid requires a value" >&2; exit 2; }
      shift 2
      ;;
    --tag)
      tag="${2:-}"
      [[ -n "${tag}" ]] || { echo "error: --tag requires a value" >&2; exit 2; }
      shift 2
      ;;
    --latest)
      allow_latest=1
      tag="latest"
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --next-release-info)
      next_release_info=1
      shift
      ;;
    --yes|-y)
      yes=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "${tag}" == "latest" && "${allow_latest}" -ne 1 ]]; then
  echo "error: refusing --tag latest without --latest" >&2
  exit 2
fi

require_clean_worktree() {
  local status
  status="$(git status --porcelain)"
  if [[ -n "${status}" ]]; then
    echo "error: worktree is not clean; commit or stash changes before publishing" >&2
    git status --short >&2
    exit 1
  fi
}

pkg_field() {
  node -e "const p=require('./package.json'); console.log(p[process.argv[1]] || '')" "$1"
}

next_prerelease() {
  node -e '
const current = process.argv[1];
const preid = process.argv[2];
const m = current.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
if (!m) throw new Error(`unsupported semver: ${current}`);
let [major, minor, patch] = [m[1], m[2], m[3]];
const prerelease = m[4] || "";
const parts = prerelease ? prerelease.split(".") : [];
let n = 0;
if (parts[0] === preid && /^\d+$/.test(parts[1] || "")) {
  n = Number(parts[1]) + 1;
} else if (!prerelease) {
  patch = String(Number(patch) + 1);
}
console.log(`${major}.${minor}.${patch}-${preid}.${n}`);
' "$1" "$2"
}

version_exists() {
  local name="$1"
  local version="$2"
  local output
  local status
  set +e
  output="$(npm view "${name}@${version}" version 2>&1)"
  status=$?
  set -e
  if [[ "${status}" -eq 0 ]]; then
    return 0
  fi
  if [[ "${output}" == *"E404"* || "${output}" == *"404 Not Found"* ]]; then
    return 1
  fi
  echo "error: could not query npm for ${name}@${version}" >&2
  echo "${output}" >&2
  exit 1
}

run_check() {
  echo "==> $*"
  "$@"
}

package_name="$(pkg_field name)"
current_version="$(pkg_field version)"
if [[ -z "${package_name}" || -z "${current_version}" ]]; then
  echo "error: package.json must contain name and version" >&2
  exit 1
fi

target_version="${explicit_version}"
if [[ -z "${target_version}" ]]; then
  target_version="$(next_prerelease "${current_version}" "${preid}")"
fi

if [[ "${target_version}" == "${current_version}" ]]; then
  echo "error: target version equals current version (${current_version})" >&2
  exit 1
fi

echo "Package: ${package_name}"
echo "Current: ${current_version}"
echo "Target:  ${target_version}"
echo "Tag:     ${tag}"

if [[ "${next_release_info}" -eq 1 ]]; then
  echo "Next release info only. No git, npm, network, or package checks were run."
  echo "Publish command:"
  echo "npm publish --access public --tag ${tag}"
  echo "Install after publish:"
  echo "npm install -g ${package_name}@${target_version} --tag ${tag}"
  exit 0
fi

require_clean_worktree

echo "==> npm auth"
npm whoami >/dev/null

echo "==> npm registry package check"
if version_exists "${package_name}" "${target_version}"; then
  echo "error: ${package_name}@${target_version} already exists on npm; refusing double publish" >&2
  exit 1
fi

if [[ "${dry_run}" -eq 1 ]]; then
  echo "==> dry-run: skip package.json version write"
else
  backup_dir="$(mktemp -d "${TMPDIR:-/tmp}/roborepo-publish-npm.XXXXXX")"
  cp package.json "${backup_dir}/package.json"
  run_check npm version "${target_version}" --no-git-tag-version
  version_written=1
fi

run_check npm test
run_check npm run pack:dry-run
run_check npm run test:package-install
run_check bash scripts/doctor.sh --quiet

if [[ "${dry_run}" -eq 1 ]]; then
  echo "Dry run complete. Publish command would be:"
  echo "npm publish --access public --tag ${tag}"
  echo "Install after publish:"
  echo "npm install -g ${package_name}@${target_version} --tag ${tag}"
  exit 0
fi

if [[ "${yes}" -ne 1 ]]; then
  printf 'Publish %s@%s with dist-tag %s? [y/N] ' "${package_name}" "${target_version}" "${tag}"
  read -r answer
  case "${answer}" in
    y|Y|yes|YES) ;;
    *) echo "aborted"; exit 1 ;;
  esac
fi

publish_started=1
run_check npm publish --access public --tag "${tag}"

echo "Published ${package_name}@${target_version} with dist-tag ${tag}"
echo "Install on another machine:"
echo "npm install -g ${package_name}@${target_version} --tag ${tag}"

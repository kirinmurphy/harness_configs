#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"

tag="latest"
dry_run=0
package_name=""

usage() {
  cat <<'EOF'
usage: scripts/release/promote-npm-latest.sh [options]

Moves an npm dist-tag to the newest published semver version for this package.

Options:
  --tag <tag>             Dist-tag to move (default: latest).
  --package <name>        Package name (default: package.json name).
  --dry-run               Print the dist-tag command without changing npm.
  -h, --help              Show this help.
EOF
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --tag)
      tag="${2:-}"
      [[ -n "${tag}" ]] || { echo "error: --tag requires a value" >&2; exit 2; }
      shift 2
      ;;
    --package)
      package_name="${2:-}"
      [[ -n "${package_name}" ]] || { echo "error: --package requires a value" >&2; exit 2; }
      shift 2
      ;;
    --dry-run)
      dry_run=1
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

if [[ -z "${package_name}" ]]; then
  package_name="$(node -e "const p=require('./package.json'); console.log(p.name || '')")"
fi

if [[ -z "${package_name}" ]]; then
  echo "error: package.json must contain a package name" >&2
  exit 1
fi

echo "Package: ${package_name}"
echo "Tag:     ${tag}"

echo "==> npm auth"
npm whoami >/dev/null

echo "==> npm registry versions"
versions_json="$(npm view "${package_name}" versions --json)"
target_version="$(node -e '
const input = JSON.parse(process.argv[1]);
const versions = (Array.isArray(input) ? input : [input]).filter(Boolean);
if (versions.length === 0) throw new Error("no published versions found");

function parse(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) throw new Error(`unsupported semver: ${version}`);
  return {
    raw: version,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split(".") : [],
  };
}

function compareIdentifier(a, b) {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return Number(a) - Number(b);
  if (an) return -1;
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compare(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.pre.length === 0 && b.pre.length > 0) return 1;
  if (a.pre.length > 0 && b.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] == null) return -1;
    if (b.pre[i] == null) return 1;
    const id = compareIdentifier(a.pre[i], b.pre[i]);
    if (id !== 0) return id;
  }
  return 0;
}

console.log(versions.map(parse).sort(compare).at(-1).raw);
' "${versions_json}")"

echo "Target:  ${target_version}"

if [[ "${dry_run}" -eq 1 ]]; then
  echo "Dry run complete. Dist-tag command would be:"
  echo "npm dist-tag add ${package_name}@${target_version} ${tag}"
  exit 0
fi

echo "==> npm dist-tag add"
npm dist-tag add "${package_name}@${target_version}" "${tag}"

echo "Promoted ${package_name}@${target_version} to dist-tag ${tag}"
echo "Verify:"
echo "npm dist-tag ls ${package_name}"

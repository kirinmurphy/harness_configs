#!/usr/bin/env bash
# Live fixture for the `shared` Compose-ownership verdict (localhoster-workspace-model Phase 4).
#
# Why this exists: the classifier's `shared` path cannot be exercised by the repositories on a
# typical dev machine, because they each have exactly one checkout — every real stack classifies
# `owned`. This builds the missing shape: ONE repository, TWO checkouts, and ONE stack that bind
# mounts both, which is the configuration whose misplacement the whole plan exists to fix.
#
# Deliberately NOT built against a real project. An earlier attempt would have started a second
# stack inside the live traefik_vps repo, which serves production on ports 80/443 — a container
# name or port collision there takes down the reverse proxy. A scratch repo exercises the identical
# code path with no blast radius.
#
# Usage:
#   scripts/test/fixtures/shared-compose-stack.sh up     # create repo + worktree, start stack
#   scripts/test/fixtures/shared-compose-stack.sh down   # stop stack, remove everything
#
# The stack is `sleep`-based alpine: no ports published, no network exposure, no data written
# outside the scratch directory.

set -euo pipefail

PROJECT="fixture_shared"
CONTAINER="fixture_sharedb"
STATE_FILE="${TMPDIR:-/tmp}/roborepo-shared-stack-fixture.path"

up() {
  local dir
  dir="$(mktemp -d "${TMPDIR:-/tmp}/shared-stack-fixture.XXXXXX")"
  echo "$dir" > "$STATE_FILE"

  git init -q "$dir"
  git -C "$dir" config user.email fixture@example.invalid
  git -C "$dir" config user.name fixture
  mkdir -p "$dir/data"
  echo "seed" > "$dir/data/seed.sql"
  git -C "$dir" add -A
  git -C "$dir" commit -qm "fixture"
  # A remote makes this resolve to a git: repository id rather than a path-derived local: one, which
  # is what the registry and the classifier are keyed on.
  git -C "$dir" remote add origin git@github.com:example/shared-stack-fixture.git
  git -C "$dir" worktree add -q "${dir}-wt" -b feature
  mkdir -p "${dir}-wt/data"

  # The point of the fixture: bind mounts landing in BOTH checkouts, plus one infrastructure mount
  # that belongs to neither (which must not change the verdict).
  cat > "$dir/docker-compose.yml" <<YAML
services:
  sharedb:
    image: alpine:3.20
    container_name: ${CONTAINER}
    command: ["sleep", "600"]
    volumes:
      - ${dir}/data:/seed-main:ro
      - ${dir}-wt/data:/seed-feature:ro
      - /etc/localtime:/etc/localtime:ro
YAML

  docker compose -f "$dir/docker-compose.yml" -p "$PROJECT" up -d
  echo "fixture up: $dir (worktree: ${dir}-wt)"
  echo "expected verdict: shared / conflict, rootId absent"
}

down() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if [ -f "$STATE_FILE" ]; then
    local dir
    dir="$(cat "$STATE_FILE")"
    if [ -n "$dir" ] && [ -d "$dir" ]; then
      git -C "$dir" worktree remove --force "${dir}-wt" >/dev/null 2>&1 || rm -rf "${dir}-wt"
      rm -rf "$dir"
    fi
    rm -f "$STATE_FILE"
  fi
  echo "fixture down"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 up|down" >&2; exit 2 ;;
esac

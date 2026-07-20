#!/usr/bin/env bash
set -euo pipefail

# Smoke test: portal PID stale detection and clean stop.
# Sandboxed via ROBOREPO_STATE_DIR and ROBOREPO_PORTAL_PID_PATH so no real state is touched.
# Uses port 14317 to avoid conflicting with a running dashboard on 4317.
#
# Usage: scripts/test/test-telemetry-pid.sh [--quiet|-q]

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cli="${repo_root}/scripts/cli/main.mjs"

quiet=0
for arg in "$@"; do
  case "${arg}" in
    --quiet|-q) quiet=1 ;;
    *) echo "usage: $0 [--quiet|-q]" >&2; exit 2 ;;
  esac
done

work="$(mktemp -d "${TMPDIR:-/tmp}/roborepo-pid-test.XXXXXX")"
trap 'rm -rf "${work}"' EXIT

pidfile="${work}/portal-server.pid"
export ROBOREPO_STATE_DIR="${work}/state"
export ROBOREPO_PORTAL_PID_PATH="${pidfile}"

pass=0; fail=0

assert() {
  local label="$1"; shift
  if "$@" 2>/dev/null; then
    [[ "${quiet}" -eq 0 ]] && echo "ok: ${label}"
    pass=$((pass + 1))
  else
    echo "FAIL: ${label}" >&2
    fail=$((fail + 1))
  fi
}

pid_running() { ps -p "$1" > /dev/null 2>&1; }
pid_gone()    { ! ps -p "$1" > /dev/null 2>&1; }
str_contains() { [[ "$1" == *"$2"* ]]; }

# --- stale PID detection ---
# Write a PID that no real process holds (high enough to be safe on macOS + Linux).
echo "9999999" > "${pidfile}"
node "${cli}" serve --detach --no-open --port 14317 > /dev/null 2>&1 || true

new_pid=$(cat "${pidfile}" 2>/dev/null || echo "")
assert "stale PID cleared: PID file updated to new value" test "${new_pid}" != "9999999"
assert "stale PID cleared: PID file exists" test -f "${pidfile}"
assert "stale PID cleared: new PID is a live process" pid_running "${new_pid}"

# --- clean stop ---
node "${cli}" telemetry stop > /dev/null 2>&1 || true
# Give the process a moment to exit after SIGTERM.
sleep 0.3

assert "stop: PID file removed" test ! -f "${pidfile}"
assert "stop: server process exited" pid_gone "${new_pid}"

# --- stop with no server is graceful (no crash) ---
output=$(node "${cli}" telemetry stop 2>&1 || true)
assert "stop with no server: exits cleanly" str_contains "${output}" "no server"

# --- detached start refuses an explicit port owned by a FOREIGN (non-roborepo) process ---
# A healthy roborepo portal on the port is adopted (reuse), not a conflict; the real guarantee
# is that a foreign/unhealthy listener on an explicitly requested port is refused without
# clobbering it or leaving a stale PID behind. Occupy the port with a bare 404 server so
# probePortal() classifies it as non-current.
conflict_port=14318
node -e "require('http').createServer((_,res)=>{res.statusCode=404;res.end('nope')}).listen(${conflict_port},'127.0.0.1')" &
foreign_pid=$!
for _ in $(seq 1 25); do
  curl -s "http://127.0.0.1:${conflict_port}/" >/dev/null 2>&1 && break
  sleep 0.2
done
echo "9999999" > "${pidfile}"
conflict_output=$(node "${cli}" serve --detach --no-open --port "${conflict_port}" 2>&1 || true)
assert "foreign-occupied explicit port: refused with actionable message" \
  str_contains "${conflict_output}" "stop it or pass --port"
assert "foreign-occupied explicit port: stale PID cleared, port left untouched" test ! -f "${pidfile}"
kill "${foreign_pid}" 2>/dev/null || true
wait "${foreign_pid}" 2>/dev/null || true

echo ""
echo "results: ${pass} passed, ${fail} failed"
[[ "${fail}" -eq 0 ]]

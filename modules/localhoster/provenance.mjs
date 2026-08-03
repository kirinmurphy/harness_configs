// Who launched a listener. Three instances of one repo started by hand usually means stale
// processes worth killing; one of them started by a coding agent is a legitimate test environment.
// The page cannot tell those apart from ports and PIDs alone, so it walks the process tree.
//
// Resolution is best-effort and absent rather than guessed: an unrecognized ancestor yields null,
// never a fabricated "unknown agent".

// Matched against the ancestor's command name, longest-lived signals first. Kept deliberately small
// — this is a labeling aid, not a process classifier, and a wrong label is worse than no label.
const AGENT_PATTERNS = [
  { kind: "claude", label: "Claude Code", pattern: /(^|\/)claude(-code)?$/i },
  { kind: "codex", label: "Codex", pattern: /(^|\/)codex$/i },
  { kind: "cursor", label: "Cursor", pattern: /(^|\/)cursor/i },
];

const SHELL_PATTERN = /(^|\/)(ba|z|k|fi|c|tc)?sh$/i;

// PID 1 means the launching process already exited and the OS reparented this one. On a dev box
// that is the signature of a server started in a terminal window that has since been closed — the
// exact case where a leftover process outlives the session that made it.
const INIT_PID = 1;

// Walks parent PIDs to a recognizable ancestor. `processByPid` is the map process-metrics already
// builds, so this adds no subprocess calls of its own.
//
// The depth cap keeps a corrupted or cyclic parent chain from spinning; real chains on a dev
// machine are only a few levels deep (agent -> shell -> npm -> node).
// `listenerPids` lets the walk stop at another discovered listener: a Deno runtime whose parent is
// the dev server on :4321 is that server's child, which explains it far better than walking past it
// to report "no parent process". Optional so callers that only want agent/shell attribution can
// omit it.
export function resolveProvenance(pid, processByPid, { maxDepth = 12, listenerPids = null } = {}) {
  if (!Number.isInteger(pid) || !processByPid) return null;

  const seen = new Set([pid]);
  let current = processByPid.get(pid);
  if (!current) return null;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const parentPid = current.ppid;
    if (!Number.isInteger(parentPid)) return null;

    if (parentPid === INIT_PID) {
      return { kind: "orphaned", label: "no parent process", pid: INIT_PID };
    }
    // Checked before the agent/shell patterns: the nearest listener ancestor is the most specific
    // true statement available about where this process came from.
    if (listenerPids?.has(parentPid)) {
      return { kind: "child", label: "another listener", pid: parentPid };
    }
    // A cycle should be impossible from real `ps` output, but a malformed map must not hang a scan.
    if (seen.has(parentPid)) return null;
    seen.add(parentPid);

    const parent = processByPid.get(parentPid);
    // The parent is outside the scanned PID set (only listeners' PIDs are queried), so ancestry
    // cannot be followed further without another `ps`. Absent, not guessed.
    if (!parent) return null;

    const command = parent.command || "";
    const agent = AGENT_PATTERNS.find((entry) => entry.pattern.test(command));
    if (agent) {
      return { kind: agent.kind, label: agent.label, pid: parentPid };
    }
    if (SHELL_PATTERN.test(command)) {
      return { kind: "shell", label: "a terminal", pid: parentPid };
    }

    current = parent;
  }
  return null;
}

// Human-readable phrasing for the portal. Kept beside the resolver so the wording and the kinds it
// describes cannot drift apart.
export function provenanceLabel(provenance) {
  if (!provenance) return null;
  if (provenance.kind === "child") return "started by another listener here";
  if (provenance.kind === "orphaned") return "started outside a live session";
  if (provenance.kind === "shell") return "started from a terminal";
  return `started by ${provenance.label}`;
}

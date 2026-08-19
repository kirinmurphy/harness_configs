import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// --- Observe skill reference reads and tell the agent, mid-turn ---------------------------
//
// PURPOSE: the `🧩 Skills loaded:` line this package renders is self-reported. An agent that
// skipped a required reference is exactly the agent that will not report having skipped it.
// This hook fires on a read of a skill reference and injects the observed `<skill>/<reference>`
// into the agent's context via `hookSpecificOutput.additionalContext`, so the line is written
// from observation rather than recall. `globals/system/hooks/claude/roborepo-write-guard.mjs`
// uses the same injection mechanism.
//
// PATH MATCHING IS LITERAL, AND THAT IS THE WHOLE TRICK. Agents open these files through the
// harness-native directory (`~/.claude/skills/<skill>/references/<file>.md`), which is a symlink
// into the roborepo cache (`~/.roborepo/skills/...`). Both name the same file. Only the first is
// what the agent actually read, so resolving symlinks here would report a path the agent never
// touched — and, worse, would silently stop matching. Never call realpath on the payload path.
//
// PERSISTS ALMOST NOTHING: one integer per session (see sessionObservationCount). No record of
// which references were read is ever written to disk; the observation exists only in the injected
// text, consumed in the same turn.

const noop = () => process.exit(0) // any miss or error => silent passthrough, never disturb the call

let input
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'))
} catch {
  noop()
}

const filePath = (input.tool_input || {}).file_path || ''
if (!filePath) noop()

// path.resolve normalizes `..` and relative segments without touching symlinks, which is the
// distinction that matters here: we want the agent's own path made absolute, not the file's
// real location.
const abs = path.resolve(filePath)
const home = os.homedir()

// Both harnesses are listed because either may have opened the reference. `~/.roborepo/skills`
// is deliberately absent: it is where the files live, not how they are opened.
const roots = [path.join(home, '.claude', 'skills'), path.join(home, '.codex', 'skills')]
const root = roots.find(candidate => abs.startsWith(candidate + path.sep))
if (!root) noop()

// Only files under a skill's references/ directory are observations. A read of SKILL.md itself
// is the skill loading normally and says nothing about reference compliance.
if (!abs.includes(`${path.sep}references${path.sep}`)) noop()

const rel = path.relative(root, abs)
const segments = rel.split(path.sep)
const skill = segments[0]
const reference = segments.slice(1).join('/')
if (!skill || !reference) noop()

// --- Session observation counter -----------------------------------------------------------
//
// Injected context is ordinary context: a turn long enough to trigger compaction can summarize
// these lines away, and an agent cannot tell a dropped injection from a reference it never read.
// Both would simply be absent.
//
// Stamping each injection with a per-session sequence number makes the difference detectable. An
// agent that sees observation 7 but not 1-6 knows its earlier observations were compacted away,
// and can report reference observation as unavailable rather than reporting a reference as unread.
// A gap is positive evidence; absence alone is not.
//
// This is the one thing the hook persists. It is an integer keyed by session, never a record of
// what was read, and a stale file is harmless because only the count within a session matters.
function stateRoot() {
  return (
    process.env.ROBOREPO_STATE_ROOT ||
    process.env.ROBOREPO_STATE_DIR ||
    path.join(os.homedir(), '.roborepo')
  )
}

function sessionObservationCount(sessionId) {
  if (!sessionId) return null
  try {
    const dir = path.join(stateRoot(), 'skill-visibility')
    fs.mkdirSync(dir, { recursive: true })
    // One file per session keeps concurrent sessions from sharing a counter, and makes cleanup a
    // matter of deleting a directory rather than editing a shared document.
    const file = path.join(dir, `${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '')}.count`)
    let count = 0
    try {
      count = Number.parseInt(fs.readFileSync(file, 'utf8'), 10) || 0
    } catch {
      count = 0
    }
    count += 1
    fs.writeFileSync(file, String(count))
    return count
  } catch {
    // Counting is an enhancement to the message, never a precondition for it. If the state root
    // is unwritable the observation is still worth injecting without a sequence number.
    return null
  }
}

const sequence = sessionObservationCount(input.session_id)
const stamp = sequence === null ? '' : ` (observation ${sequence} this session)`

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `[skill-visibility] observed reference read: ${skill}/${reference}${stamp}`,
    },
  }),
)

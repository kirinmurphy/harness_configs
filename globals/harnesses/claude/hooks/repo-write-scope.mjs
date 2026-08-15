import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Claude's implementation of the platform's `repo-scope` behavior. Fires on Write/Edit: writes
// inside the repository the session is working in proceed, writes outside it get the bucket the
// manifest assigns to `repo-write-boundary`.
//
// OWNERSHIP: the platform states the intent (manifests/inventory/agent-permissions.json declares
// the behavior, its label, and its bucket); this file is how Claude specifically enforces it. Codex
// expresses the same intent through its workspace sandbox instead, which is why this lives under
// the provider rather than in a shared hooks directory.
//
// WHY A HOOK: the boundary is "the repository you are in", and a Claude permission rule cannot
// express that. Rule paths are literal strings with no variable expansion, and no anchor resolves
// to the current repository — `/path` in a user-level settings file resolves relative to that
// settings file's own directory, not to any checkout. So the boundary has to be decided at
// tool-call time. See docs/plans/backlog/agent-config-repo-scoped-write-permissions.md.
//
// The static rules remain the coarse layer: they allow the scratch directories that are correct
// regardless of which repository is in use. This hook narrows the repository half of that scope
// from "some fixed tree" to "the checkout the agent is actually in".
//
// COST: the repository root is found by walking up from cwd looking for `.git`, in-process. That
// is ~0.09ms per call, against ~155ms to spawn `git rev-parse --show-toplevel`. This runs on every
// Write and Edit, so the spawn is not affordable and the walk is.
//
// A worktree resolves to itself, not to its primary checkout: `.git` is a FILE there rather than a
// directory, and existsSync matches either. That is the intended behavior — work in a worktree
// should not silently write into the main checkout.
//
// DESIGN — "ask when unsure": every failure path exits silently and lets the existing permission
// rules decide. A hook that cannot determine the answer must not manufacture one, in either
// direction: returning `allow` on a bad parse would widen the scope this exists to narrow, and
// returning `deny` would break writes on any path the hook did not anticipate.

const noop = () => process.exit(0) // any error or unknown => defer to the static rules

let input
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'))
} catch {
  noop()
}

// The outside-the-repo decision is the platform's to set, not this hook's to assume: it is the
// bucket on the `repo-write-boundary` behavior, layered with any personal override the same way
// every other permission is. Reading it here is what keeps the platform the instructor and this
// file merely the Claude-side enforcement.
//
// Resolution mirrors the Codex permission hook: an explicit env var, then recorded install state,
// then this file's own location walked back to the repository root.
function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}

function outsideRepoBucket() {
  const stateDir = process.env.ROBOREPO_STATE_DIR || path.join(os.homedir(), '.roborepo')
  const candidates = []
  if (process.env.ROBOREPO_REPO_ROOT) candidates.push(process.env.ROBOREPO_REPO_ROOT)
  const state = readJson(path.join(stateDir, 'install-state.json'), {})
  if (typeof state.repo === 'string' && state.repo) candidates.push(state.repo)
  candidates.push(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'))

  for (const root of candidates) {
    const manifest = readJson(path.join(root, 'manifests', 'inventory', 'agent-permissions.json'), null)
    const behavior = manifest?.behaviors?.find(b => b.id === 'repo-write-boundary')
    if (!behavior) continue
    const overrides = readJson(path.join(stateDir, 'command-overrides.json'), {})
    return overrides?.behaviors?.['repo-write-boundary'] || behavior.bucket
  }
  // Manifest unreadable: the platform has not stated an intent this hook can act on, so it does
  // not invent one — the static rules decide, exactly as if this hook were not installed.
  return null
}

const toolInput = input.tool_input || {}
const filePath = toolInput.file_path || ''
if (!filePath) noop()

// Locations that are correct to write regardless of which repository is in use: agent scratch
// space, and the managed harness homes (roborepo-write-guard.mjs already annotates those writes;
// prompting for them as well would be noise on top of a reminder).
const home = os.homedir()
const alwaysAllowed = [
  os.tmpdir(),
  '/tmp',
  '/private/tmp',
  '/private/var/folders',
  path.join(home, '.claude'),
  path.join(home, '.codex'),
  path.join(home, '.roborepo'),
]

const contains = (dir, target) => target === dir || target.startsWith(dir + path.sep)

function repositoryRoot(start) {
  let dir
  try {
    dir = path.resolve(start)
  } catch {
    return null
  }
  for (;;) {
    // `.git` is a directory in a normal checkout and a file in a linked worktree; either marks a
    // root, so no stat-type check is wanted here.
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

const target = path.resolve(filePath)

// cwd is the session's working directory, which may be a subdirectory of the checkout.
const root = repositoryRoot(input.cwd || process.cwd())

// The repository check comes FIRST, before the scratch allowlist. A checkout can live under a
// scratch path — cloning into /tmp to test something is normal — and when it does, the repository
// boundary is still the boundary that matters. Testing scratch first would hand back "allowed" for
// every path in that clone, including writes into a sibling clone beside it.
if (root && contains(root, target)) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Inside the current repository.',
      },
    }),
  )
  process.exit(0)
}

// Outside the current repository. Scratch space is exempt — those paths are correct to write
// whichever repository is in use, and the static rules already allow them, so prompting on top of
// an existing allow would be noise.
//
// "In scratch" means a loose file there, though, not another checkout that happens to live under
// it. A clone inside /tmp is still a repository, and writing into it from a different repository
// is exactly the cross-repository write this hook exists to catch — so a target with its own
// repository root is never treated as scratch.
if (alwaysAllowed.some(dir => contains(dir, target)) && !repositoryRoot(path.dirname(target))) noop()

// Not in a repository at all — there is no boundary to be outside of, so leave the decision to
// the static rules rather than inventing one.
if (!root) noop()

const bucket = outsideRepoBucket()
// "allow" means the platform has switched the boundary off; say nothing and let the static rules
// apply, rather than emitting an allow that would out-rank them.
if (!bucket || bucket === 'allow') noop()

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: bucket,
      permissionDecisionReason:
        `This path is outside the repository you are working in (${root}). Writing here affects files that are not part of this checkout.`,
    },
  }),
)

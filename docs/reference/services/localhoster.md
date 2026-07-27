# Localhoster

Localhoster is the `/localhoster` page in the local RoboRepo portal. It discovers active local HTTP
apps, associates them with a stable project/app identity, and stores machine-local quick links such
as `/admin` or `/resume`.

## Commands

```sh
roborepo localhoster
roborepo localhoster --json
roborepo localhoster --open
```

- Default output prints a compact project/app/origin/status table.
- `--json` prints the same browser-safe snapshot used by the portal.
- `--open` starts or reuses the portal and opens `/localhoster`.

## Discovery

Automatic discovery currently supports macOS. Other platforms return an explicit capability state
so the page can say discovery is unsupported instead of implying that no apps are running.

On macOS, RoboRepo:

- collects TCP listeners with `lsof` field output
- resolves each PID's working directory with `lsof -a -p <pid> -d cwd`
- walks to the nearest Git boundary
- normalizes SSH/HTTPS Git remotes into `git:<host>/<owner>/<repo>`
- falls back to `path:<realpath>` or low-confidence `process:<cwd>:<command>`
- probes only loopback-compatible origins and excludes non-HTTP listeners from the default snapshot

HTTP probes are bounded to 8 active instance probes at a time. Each instance still tries its
compatible host candidates in order so hostname preference remains deterministic while large local
listener sets cannot stall the portal.

The portal process is represented as built-in identity `roborepo:portal` and is never probed
recursively.

A project identity with exactly one distinct listener "shape" (same page title and relative
working directory) auto-promotes to Active apps at high/medium identity confidence, even if that
shape has multiple listeners — those extra listeners are treated as redundant processes serving
the same app (e.g. two different static-file-server tools pointed at the same directory) rather
than separate apps, and the card shows a notice naming the extra ports. A project identity with
two or more genuinely different shapes (different titles) still cannot be auto-assigned, since
there is no reliable way to guess which one is "the" app; those stay in Other instances until
manually associated.

Discovery is split across provider boundaries:

- `capabilities.mjs` reports aggregate platform support plus per-provider states.
- `listeners.mjs` owns macOS listener and working-directory collection.
- `origin.mjs` owns loopback-compatible origin candidates and hostname preference ordering.
- `http-probe.mjs` is the public HTTP probe boundary; `probe.mjs` remains the bounded probe
  implementation.
- `discovery.mjs` coordinates provider records, identity, aliases, probing, and browser-safe
  instance shaping.
- `instance-shape.mjs` owns the instance record's structure and the association-key derivation.
- `git.mjs` and `git-refs.mjs` collect Git context; `health.mjs` and `health-policy.mjs` normalize
  probe results into health states; `history.mjs` and `history-diff.mjs` derive and persist
  transition events.

Docker, process metrics, and metadata suggestions are listed as provider capabilities but marked
unsupported until their smaller follow-up plans implement them.

## Git context

Each discovered app's repository root reports its branch, commit, dirty state, and ahead/behind
position. Collection is deliberately split by what can be read correctly:

- **Filesystem reads** supply branch, detached HEAD, commit sha, and the configured upstream. These
  parse `.git/HEAD`, loose refs, `packed-refs`, and the config file directly, so they work even when
  the `git` binary is missing. A linked worktree reads its own HEAD and refs while sharing
  `packed-refs` and config through `commondir`, which is why a worktree reports its own branch but
  the same canonical repository as its primary clone.
- **A subprocess** supplies dirty state and ahead/behind. Both need work no filesystem read can do
  correctly: dirty state requires parsing the binary index and stat-comparing the worktree against
  it, and ahead/behind requires walking the commit graph through loose objects and packfiles.

Exactly two Git subcommands ever run, both read-only and neither touching the network:

```text
git status  --porcelain=v1 --untracked-files=normal -z
git rev-list --left-right --count <upstream>...HEAD
```

`modules/repositories/git-exec.mjs` enforces that with an allow-list, so adding a network subcommand
has to be a deliberate edit rather than an accident. Every invocation is hardened:

- `--no-optional-locks` and `GIT_OPTIONAL_LOCKS=0` stop `git status` from refreshing and rewriting
  `.git/index`. Without them a background scan would race your own `git add`/`git commit` for
  `index.lock`.
- `core.hooksPath=/dev/null` guarantees no repository-local hook executes, since discovery walks
  arbitrary repositories on the machine.
- `core.fsmonitor=false` avoids spawning or attaching to a filesystem-monitor daemon.
- `GIT_TERMINAL_PROMPT=0`, empty askpass variables, and a closed stdin ensure nothing can block
  waiting for credentials.
- A timeout and `maxBuffer` are always set, so a slow or hung repository degrades one field rather
  than stalling the scan.

RoboRepo never fetches. Ahead/behind reflects the remote-tracking ref as of your last fetch.

`dirty`, `ahead`, and `behind` are `null` — never `false` or `0` — when the subprocess could not
answer. The portal renders nothing in that case rather than implying a clean tree, because a wrongly
reported "clean" is a claim a user would act on.

Git results are cached per scan, keyed by repository root realpath
(`modules/repositories/scan-cache.mjs`), so N apps running out of one repository cost one collection.
The cache is created per `discoverInstances` call and discarded when it returns; a process-lifetime
cache would pin the first reading a long-lived portal ever took.

## Health states

Every probed instance is normalized into one of six states:

| State | Meaning |
| --- | --- |
| `healthy` | Reachable and the status is accepted |
| `degraded` | Reachable but wrong: an untrusted certificate, or a status the app's configuration rejects |
| `unhealthy` | Sustained failure — the failure count reached the threshold |
| `starting` | Not yet reachable, but still inside the grace window after first sight |
| `unknown` | Not probed, or answering in a way we have no expectation for |
| `inactive` | No listener |

Two rules keep the dashboard honest:

**An unconfigured 4xx is `unknown`, not a fault.** Many listeners on a dev machine are gRPC
endpoints, IPC servers, or daemons that legitimately answer 403 or 404 to a browser `GET`. Flagging
those as degraded would fill the page with alarms about software working correctly. Once an app
declares `acceptedStatuses`, a mismatch *is* meaningful and is treated as a failure. Without that
configuration, 2xx and 3xx count as healthy — a redirect to a login page is the common localhost
case.

**A single failure is not a verdict.** Failures must repeat `FAILURE_THRESHOLD` times (default 2)
before a state reaches `unhealthy`, so an app alternating pass/fail never gets there. A connection
failure within `STARTING_GRACE_MS` (default 30s) of first sight reads as `starting`, covering the
window where a dev server has bound its port but is still compiling.

`classifyHealth` is pure: it takes the previous health record and returns the next one, so the
failure count travels with the snapshot rather than living in module state. The record carries
`state`, `reason`, `consecutiveFailures`, `since` (when the current state began), `firstSeenAt`, and
`lastProbeAt`.

Defaults live in `modules/localhoster/health-policy.mjs` and are not per-app settings today.

## History

Transition events are appended to a single machine-local file:

```text
<stateRoot>/localhoster/history.jsonl
```

Events are written only when something changes, never once per scan, so volume stays small. Six
event types are recorded: `firstSeen`, `originChange`, `healthTransition`, `exposureChange`,
`duplicateChange`, and `inactive`.

Each event carries the app's `associationKey` plus `repositoryId` and `rootId`, which join it to the
shared repository registry. `associationKey` is port-free and PID-free, so an app that restarts on a
different port keeps its history and produces an `originChange` rather than looking like a new app.
No absolute path is ever written — `rootId` is the opaque stand-in for on-disk location.

The store is bounded three ways:

- **Retention** drops events older than `preferences.historyRetentionDays` (default 14).
- **A size cap** trims the oldest events if the file still exceeds 2 MB, so a pathologically flapping
  app cannot grow it without limit.
- **Compaction is atomic** — a sibling temp file is renamed into place, never rewritten in place.

Reads tolerate a truncated final line: an event that was only partially flushed fails to parse and
is skipped until its newline lands. The same tolerance covers hand-editing damage and unknown event
types.

History writes are best-effort. A full disk or unwritable state directory can never break discovery.

## Settings

Settings are machine-local:

```text
<stateRoot>/localhoster/settings.json
```

They use a strict versioned schema with optimistic `revision` checks. V1 settings migrate in place
to schema version 2 on first load, after writing `settings.v1.backup.json` beside the settings
file. Migration is idempotent: a version 2 file is validated without making another backup.

Writes are atomic: RoboRepo writes a sibling temporary file and renames it into place. Quick links
belong to `<project identity>#<app id>` and store only route paths, never a port or origin.

Version 2 adds:

- `aliases`: explicit project identity redirects, such as a path identity that has been confirmed
  to be the same project as a Git remote identity. Alias mutations require confirmation, reject
  self-aliases, and validate the full alias graph for cycles.
- project and app `favorite` / `hidden` flags for reversible local curation.
- app `health` path/status configuration and explainable `match` hints.
- `preferences`: currently `showNonHttp` and `historyRetentionDays`.

`modules/localhoster/settings.mjs` keeps the public persistence API (`loadSettings`,
`updateSettings`, `writeSettings`) and mutation orchestration. Strict V2 validation, route
normalization, identity alias checks, and field normalizers live in
`modules/localhoster/settings-schema.mjs` so migrations and mutations share one schema boundary.

## API

Read-only:

- `GET /api/localhoster` returns the cached/current snapshot.
- `GET /api/localhoster/history?key=<opaque-key>` accepts only a key emitted by the current
  snapshot and returns that app's recorded events, newest first, capped at 200.
- `GET /api/localhoster/metadata?key=<opaque-key>` accepts only a key emitted by the current
  snapshot. It currently returns no suggestions until metadata discovery ships.

Mutating routes are POST-only and inherit the portal's loopback origin check and mutation-token
check:

- `POST /api/localhoster/refresh`
- `POST /api/localhoster/links`
- `POST /api/localhoster/association`
- `POST /api/localhoster/project`
- `POST /api/localhoster/alias`

Revision conflicts return `409` with the current snapshot.

The portal uses these same mutation routes for curation:

- The app dialog can edit project/app names, project/app favorite and hidden flags, hostname
  preference, health path/status policy, and match hints.
- The action menu can favorite or hide an app without deleting saved links.
- The settings dialog lists hidden items, manual associations, and aliases so local decisions can
  be restored or removed.
- Removing an association deletes only the association entry. Saved project/app settings and quick
  links remain in settings.
- Alias creation requires an explicit confirmation checkbox and uses the cycle-safe server-side
  alias mutation.

## Security

Localhoster never accepts a browser-supplied target URL for server-side probing. Targets come only
from local listener records. Probes do not send cookies or credentials, do not follow redirects away
from loopback, bound body size and timeouts, and treat titles/favicons as untrusted display data.

Listeners bound to wildcard or non-loopback interfaces stay visible with a warning. Unsupported
platforms keep saved settings available while clearly saying automatic discovery is unavailable.
The unsupported-platform notice links back to this document.

History reads resolve in two steps, and the order matters. The opaque key is first matched against
the *current* snapshot; an unrecognized key returns `404`. Only then is the resolved instance's
`associationKey` used to filter events. Because the opaque key is minted by the server from the
snapshot it just produced, a browser can never hand the server a key for an app it cannot already
see — that is the enumeration guard on this tokenless `GET` route.

The opaque key includes the origin, so it changes when an app's port changes. A page holding a stale
key receives `404` and reloads rather than erroring.

Git collection reads only existing local state and never contacts a remote. See
[Git context](#git-context) for the hardening applied to every Git subprocess.

## Current Limits

The current V2 foundation stores and resolves confirmed aliases and exposes a manual alias
confirmation workflow in the portal. It does not yet auto-suggest path-to-Git alias candidates.
Future final-phase work will surface those prompts when discovery evidence says a `path:<realpath>`
project and a Git remote identity are likely the same project.

Localhoster does not yet collect Docker/Compose labels, process CPU/memory, or metadata route
suggestions. Those pieces are tracked in smaller backlog plans so shipped behavior stays honest and
testable.

Known limits in the Git, health, and history behavior described above:

- **`health.path` is stored but not probed.** The setting validates and persists, but probes still
  hit the origin root. Honoring it requires a second probe per app, which belongs with the
  origin-candidate work rather than with health normalization.
- **History is unreachable for stopped apps.** Events remain on disk, but the route resolves only
  keys the current snapshot minted, and inactive entries carry no opaque key. Surfacing them needs a
  port-free handle, which belongs with the portal's inactive-card work.
- **Grace window and failure threshold are global defaults**, not per-app settings. The `health`
  schema is a strict allow-list, so adding the two keys later is forward compatible and needs no
  settings version bump.
- **`dirty`, `ahead`, and `behind` are `null` when `git` is unavailable** or a repository is too slow
  to answer within the timeout. Branch and commit still resolve from the filesystem.
- **Git polls on every refresh** while the portal is open. Reads are lock-free and deduplicated per
  repository root, but this is recurring subprocess activity; throttling per root would be a small,
  contained change if it ever proves noisy.

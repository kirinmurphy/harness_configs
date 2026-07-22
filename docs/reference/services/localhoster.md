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

Docker, process metrics, Git status, persisted history, and metadata suggestions are listed as
provider capabilities but marked unsupported until their smaller follow-up plans implement them.

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
  snapshot. It currently returns an empty, explicitly deferred event list.
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

## Current Limits

The current V2 foundation stores and resolves confirmed aliases and exposes a manual alias
confirmation workflow in the portal. It does not yet auto-suggest path-to-Git alias candidates.
Future final-phase work will surface those prompts when discovery evidence says a `path:<realpath>`
project and a Git remote identity are likely the same project.

The final Localhoster foundation does not yet collect Docker/Compose labels, process CPU/memory,
Git branch/dirty state, persisted JSONL history, or metadata route suggestions. Those pieces are
tracked in smaller backlog plans so shipped behavior stays honest and testable.

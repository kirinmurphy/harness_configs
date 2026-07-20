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

V1 supports automatic discovery on macOS. Other platforms return an explicit capability state so the
page can say discovery is unsupported instead of implying that no apps are running.

On macOS, RoboRepo:

- collects TCP listeners with `lsof` field output
- resolves each PID's working directory with `lsof -a -p <pid> -d cwd`
- walks to the nearest Git boundary
- normalizes SSH/HTTPS Git remotes into `git:<host>/<owner>/<repo>`
- falls back to `path:<realpath>` or low-confidence `process:<cwd>:<command>`
- probes only loopback-compatible origins and excludes non-HTTP listeners from the default snapshot

The portal process is represented as built-in identity `roborepo:portal` and is never probed
recursively.

## Settings

Settings are machine-local:

```text
<stateRoot>/localhoster/settings.json
```

They use a strict versioned schema with optimistic `revision` checks. Writes are atomic: RoboRepo
writes a sibling temporary file and renames it into place. Quick links belong to
`<project identity>#<app id>` and store only route paths, never a port or origin.

## API

Read-only:

- `GET /api/localhoster` returns the cached/current snapshot.

Mutating routes are POST-only and inherit the portal's loopback origin check and mutation-token
check:

- `POST /api/localhoster/refresh`
- `POST /api/localhoster/links`
- `POST /api/localhoster/association`
- `POST /api/localhoster/project`

Revision conflicts return `409` with the current snapshot.

## Security

Localhoster never accepts a browser-supplied target URL for server-side probing. Targets come only
from local listener records. Probes do not send cookies or credentials, do not follow redirects away
from loopback, bound body size and timeouts, and treat titles/favicons as untrusted display data.

Listeners bound to wildcard or non-loopback interfaces stay visible with a warning. Unsupported
platforms keep saved settings available while clearly saying automatic discovery is unavailable.

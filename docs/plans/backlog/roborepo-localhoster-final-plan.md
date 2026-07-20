---
id: localhoster-final
priority: high
next_action: Run and record manual macOS validation, then continue final phase 3 provider split
blocked_by: []
depends_on:
  - localhoster-v1
related: []
reviewed_commit:
---

# Localhoster: Final Iteration Implementation Plan

## Summary

Evolve the first Localhoster iteration into RoboRepo's complete local application index: a durable catalog of projects, app roles, and current instances; curated navigation; operational health; process and Git context; Docker-aware identity; availability history; and useful diagnostics.

The final iteration retains the core V1 rule: project repositories require no RoboRepo-specific file. Automatic evidence identifies projects, app roles, and instances; machine-local settings hold curated names, associations, health paths, and jump links. Optional repository metadata may enrich results, but it is never required and never outranks an explicit local override.

This plan builds on the current V1 interfaces instead of replacing them:

- `modules/localhoster/discovery.mjs` already discovers macOS listeners, resolves project identity, probes HTTP, and returns browser-safe instances. Final work should split this module into providers while preserving the `discoverInstances()` contract until callers migrate.
- `modules/localhoster/settings.mjs` already owns strict versioned settings, atomic writes, optimistic revisions, and `project`/`links`/`association` mutations. Final work should migrate this to schema version 2 and add narrow mutation types rather than exposing arbitrary settings writes.
- `modules/localhoster/snapshot.mjs` already composes active projects, unmatched instances, inactive saved projects, and route URLs from settings plus current origins. Final work should extend this snapshot with provider capabilities, health, history summaries, conflicts, and opaque keys.
- `scripts/cli/localhoster.mjs` already owns the cached snapshot manager, shared in-flight refresh, portal self-registration, CLI output, and `loadLocalhosterSnapshot()` / `refreshLocalhosterSnapshot()` / `updateLocalhosterSettings()`. Final work should keep this as the bridge and move richer coordination into `modules/localhoster/snapshot.mjs` or a new coordinator module.
- `scripts/cli/portal-routes-localhoster.mjs` already dispatches the V1 API namespace. Final work should add endpoints through this dispatcher without moving filesystem, process, Docker, Git, or probe logic into `portal-server.mjs`.
- `portal/localhoster/{app.js,state.js,templates.js,api.js,styles.css}` already follows the portal page pattern. Final work should deepen the same page with real edit/reorder controls, filters, detail drawer, health/history panels, and capability notices rather than adding a separate dashboard.

## Current State

V1 is completed in `docs/plans/completed/roborepo-localhoster-v1-plan.md`. Completion evidence includes:

- `npm run test:localhoster`, `npm test`, and `git diff --check` passed.
- macOS manual validation on 2026-07-20 used isolated `ROBOREPO_STATE_ROOT`, temp Git-backed Node apps, and the real portal API.
- multiple real Node apps were discovered.
- project friendly-name mutation, app name/origin mutation, and quick-link add/edit/delete/reorder worked through the portal API.
- saved Git-backed links followed a restarted app to a new port and rebuilt against the new origin.
- wildcard-bound listeners produced the expected network-exposure warning.
- the Localhoster reference document was served by the portal.

Final phase 1 has started with the V1 identity/settings/snapshot contracts as its base.

Implemented in phase 1 so far:

- Settings schema version 2 migration with a one-time V1 backup, defaults, strict validation, and
  idempotent fixture coverage.
- Confirmed alias storage with cycle prevention and snapshot/discovery alias resolution.
- Project/app favorite and hidden fields, health config, match hints, snapshot metadata,
  hidden-count reporting, and compatibility with the existing `project`, `links`, and
  `association` mutations.
- Portal workflows for manual alias confirmation, project/app favorite and hidden toggles,
  hidden-item restore, reversible association removal, and app health/match hint editing.
- `modules/localhoster/settings.mjs` was narrowed to persistence and mutation orchestration; strict
  schema validation and normalizers now live in `modules/localhoster/settings-schema.mjs`.

## Decision Record

Decisions made now because reversal cost is low or the current architecture already points one way:

- **Keep one Localhoster page and API namespace.** Extend `/localhoster` and `/api/localhoster`; do not create a second final dashboard.
- **Retain machine-local settings as source of user intent.** No project repo config is required; optional metadata only suggests improvements.
- **Migrate settings in place to version 2.** Preserve V1 project/app/link IDs, create a backup before first migration, and keep event history outside settings in `events.jsonl`.
- **Use narrow mutation endpoints.** Continue explicit `links`, `association`, and `project` mutations; add history and metadata reads. Do not accept arbitrary nested settings patches.
- **Split discovery into composable providers.** Keep macOS `lsof` as the first listener provider, then add Docker, Git, process metrics, and metadata providers behind capability reports.
- **Use transparent scoring, not opaque learning.** App matching can score evidence, but stored overrides and conflicts must remain inspectable and reversible.
- **Persist transitions, not samples.** History records first seen, origin change, health transition, network exposure change, duplicate instance change, and inactive transition. CPU, memory, PID, and raw probe samples stay current-only.
- **Make metadata suggestions opt-in.** Manifest, sitemap, robots, and OpenAPI paths can suggest quick links; curated links remain authoritative.
- **Keep Windows unsupported until a real adapter meets the same fixture contract.** Windows messaging must be explicit and cannot collapse into an empty state.
- **Gate expensive work by cadence and demand.** Listener refresh stays fast; Git, Docker, process metrics, health, and metadata use separate cadences or detail-drawer/on-demand loading.

Tradeoffs evaluated:

- **Provider split before final UI vs. patch UI first:** provider split first wins because Docker/process/Git/history all need capability and stale-result plumbing. UI-only work would hard-code assumptions that final providers immediately break.
- **Schema V2 early vs. after feature work:** V2 early wins because aliases, favorites, hidden state, health paths, match hints, and preferences need one migration surface. Delaying migration multiplies compatibility branches.
- **History JSONL vs. embedding history in settings:** JSONL wins because settings need atomic replacement and revision conflicts, while events are append-only and compacted. This avoids settings rewrites on every health transition.
- **Port as weak evidence vs. durable app key:** weak evidence only wins. Ports are useful for display and conflict hints but too volatile for saved identity.
- **Automatic alias merge vs. confirmation:** confirmation wins. A path identity gaining a Git remote is common, but silent merge can combine unrelated projects with permanent settings loss.
- **Metadata every refresh vs. on-demand/infrequent:** on-demand/infrequent wins. Metadata fetches raise latency, auth, body-size, and privacy risk without being necessary for core discovery.

Open decisions that remain because they have real consequence:

- **Windows adapter scope:** whether final ships with unsupported Windows only or a limited `win32` listener adapter. Grave consequence: support claim requires fixture parity, timeout behavior, and manual validation.
- **Maximum history retention defaults:** proposed default is 14 days plus a file-size cap, but exact cap should be set when event shape is implemented and fixture size is known.
- **UI density default:** compact vs. detailed default card mode can wait until final data exists; store preference locally either way.

## Goals

- Reliably model a project that exposes several apps, such as Web, API, Storybook, and Mailpit.
- Preserve app-specific shortcuts even when processes, containers, or ports change.
- Surface enough current telemetry to diagnose stale, unhealthy, duplicated, or unexpectedly exposed development apps.
- Record bounded health transitions and last-seen information without becoming a general monitoring platform.
- Make identity evidence, conflicts, and manual overrides understandable and reversible.
- Preserve the existing dependency-free, loopback-only portal architecture.
- Report platform-specific discovery support precisely, including clear Windows messaging when capabilities are limited or unavailable.

## Non-goals

- Full observability, distributed tracing, log aggregation, or production monitoring.
- Arbitrary network scanning.
- Automatic process termination or restart.
- Persisting full process command lines, environment variables, HTTP bodies, or application logs.
- Claiming a complete application route map from crawled links.
- Requiring sitemaps, OpenAPI, HATEOAS, framework manifests, or repository configuration.
- Sending telemetry off the machine.

## Final Concept Model

| Noun | Meaning | Stable source |
| --- | --- | --- |
| Project | Repository or manually named local application boundary | normalized Git remote or real project path |
| App definition | Durable role within a project, such as `web` or `api` | local settings plus learned association |
| Active instance | Currently listening process/container endpoint | runtime discovery |
| Origin | Current protocol, host, and port | runtime probe |
| Quick link | Curated path resolved against the current origin | local settings |
| Observation | One bounded current-state reading | in-memory snapshot |
| Health event | A meaningful state transition | local event history |
| Evidence | Facts used to connect an instance to a project/app | process, Git, Docker, HTTP metadata |

The durable lookup key becomes:

```text
<project identity>#<app id>
```

Examples:

```text
git:github.com/kirinmurphy/visa_planner#web
git:github.com/kirinmurphy/visa_planner#api
git:github.com/kirinmurphy/roborepo#portal
```

## Settings and State

Migrate the V1 settings file in place at `stateRoot/localhoster/settings.json`:

```json
{
  "version": 2,
  "revision": 12,
  "projects": {
    "git:github.com/kirinmurphy/visa_planner": {
      "name": "Visa Planner",
      "favorite": true,
      "hidden": false,
      "apps": {
        "web": {
          "name": "Web",
          "match": {
            "process": ["vite"],
            "title": ["Visa Planner"]
          },
          "originPreference": "localhost",
          "health": { "path": "/", "acceptedStatuses": [200, 204] },
          "links": [
            { "id": "home", "label": "Home", "path": "/" },
            { "id": "admin", "label": "Admin", "path": "/admin" }
          ]
        }
      }
    }
  },
  "associations": {},
  "preferences": {
    "showNonHttp": false,
    "historyRetentionDays": 14
  }
}
```

Store bounded event history separately at `stateRoot/localhoster/events.jsonl`. Settings writes remain atomic JSON replacement; history is append-only with periodic compaction.

Migration requirements:

- Preserve V1 project/app/link identities while adding final-only fields with defaults.
- Back up the previous settings file before the first schema migration.
- Make migration idempotent and fixture-tested.
- Never silently discard unknown identities, associations, or links.
- Keep a documented maximum history size and retention window.

## Multi-app Identity Resolution

Keep project identity, app identity, and active instance identity separate.

### Project evidence

Use this precedence:

1. Explicit local association.
2. Docker Compose project working directory or Git-root evidence.
3. Normalized Git remote derived from process working directory.
4. Real project-root path.
5. Low-confidence process working directory.

### App evidence

Score app candidates using:

- Explicit local association.
- Docker Compose service label.
- Package script or process executable.
- Working-directory subpath, such as `apps/web` or `packages/api`.
- HTTP title and Web App Manifest name.
- Current protocol and port only as weak evidence; never make a port the durable identity.
- User-defined match hints stored in local settings.

Do not auto-associate when the two highest candidates are too close. Return a conflict requiring a one-time user choice. Persist that choice as a reversible local association. Learn only from bounded, explainable features; never create an opaque model the user cannot inspect or correct.

Maintain identity aliases for a path-only project that later gains a Git remote, a repository that moves, and equivalent SSH/HTTPS remotes. Require confirmation when evidence is not exact. Alias resolution must be cycle-safe and must not merge two independently configured projects silently.

Expose the identity explanation in the UI:

```text
Matched to Visa Planner / Web
Git remote + working directory + title
```

## Expanded Discovery

Retain the V1 macOS `lsof` adapter and introduce explicit provider interfaces so discovery sources compose without coupling the portal to commands.

### Platform capability model

Every provider reports `supported`, `limited`, or `unsupported` independently. The aggregate snapshot lists what is available instead of reducing platform support to one boolean. The Localhoster page must distinguish:

- **No active apps found**: discovery ran successfully and found none.
- **Limited discovery**: some providers work, but results may be incomplete.
- **Discovery unsupported**: RoboRepo cannot inspect active ports on this platform.
- **Discovery unavailable**: the platform is supported, but a required command, permission, or runtime is unavailable.

Windows messaging must be direct and actionable. Until a Windows listener adapter is implemented, display:

```text
Automatic localhost discovery is not yet supported on Windows.
Saved projects and links are available, but active ports cannot be matched automatically.
```

If Windows support is added, implement it behind a `win32` adapter rather than adding platform branches throughout the domain layer. A future adapter may use PowerShell `Get-NetTCPConnection` plus Windows process APIs, but must meet the same fixture tests, timeout limits, secret-redaction rules, and identity confidence contract before being marked supported. Partial Windows support must name missing features such as working-directory resolution, process metrics, Docker enrichment, or Git association.

### Process provider

Collect current PID, parent PID where useful, executable name, working directory, elapsed runtime, resident memory, and sampled CPU percentage. Use macOS-native command output with machine-oriented parsing where available. Treat missing permission or a process exiting mid-scan as normal partial data. Gather CPU and memory on a slower telemetry cadence or when the detail drawer opens; do not sample every process on every listener refresh.

Do not persist PID, CPU, or memory observations to long-term settings. They are current-instance facts.

Process enrichment is platform-capability-dependent. Missing working-directory or metric support must lower identity confidence and appear in `capabilities`; it must not silently produce a path-based match.

### Docker provider

When Docker is available and responsive, inspect running containers and published ports. Use standard Docker and Compose labels to recover:

- Container ID and name.
- Compose project name.
- Compose service name.
- Compose project working directory/config files when exposed by labels.
- Container health status.
- Published host address and port.

Merge Docker and `lsof` observations representing the same host endpoint. Docker absence, daemon shutdown, or permission failure must produce a capability note rather than break the page.

### HTTP metadata provider

Build upon the bounded V1 probe and optionally inspect only conventional same-origin metadata:

- HTML title and favicon.
- Web App Manifest name, short name, icons, and start URL.
- `robots.txt` sitemap declarations.
- `/sitemap.xml` when explicitly declared or found at the conventional location.
- OpenAPI documents only when linked, configured, or found at a small documented set of conventional paths.

Discovered routes are suggestions, not automatically promoted quick links. The UI can offer **Add as quick link**. Do not recursively crawl the application in the final default implementation.

Deduplicate suggestions by normalized path, label their source, and keep authenticated/admin-looking paths out of automatic suggestions unless they came from an explicit local OpenAPI or sitemap source. Never send cookies or credentials while fetching metadata.

### Git provider

For identified project roots, collect:

- Current branch or detached HEAD.
- Short HEAD commit.
- Clean/dirty state.
- Ahead/behind only when it can be computed from existing local refs; do not fetch remotes.

Cache Git results by repository root for each scan. Apply strict timeouts and avoid invoking hooks.

For monorepos and worktrees, report both repository root and the instance's relative app directory. Opening a folder targets the app working directory by default, with a secondary action for repository root.

## Health and Telemetry

### Current observations

Each active instance may expose:

- Reachability and HTTP status.
- Probe latency.
- Current health-check result.
- Process uptime, CPU, and resident memory.
- Git branch, short commit, and dirty state.
- Docker container and health state.
- Bind scope: loopback, wildcard, or LAN-facing.
- Duplicate-instance or duplicate-port warnings.
- First seen during the current server run and most recently seen.

### Health states

Normalize into:

```text
healthy
degraded
unhealthy
starting
unknown
inactive
```

Suggested rules:

- `healthy`: configured health path succeeds or the base HTTP probe meets the accepted status policy.
- `degraded`: responds but is slow, redirects unexpectedly, or has a failing optional check.
- `unhealthy`: connection succeeds but configured health check fails consistently.
- `starting`: newly discovered and within a short grace window.
- `unknown`: insufficient or contradictory evidence.
- `inactive`: saved app has no current instance.

Use consecutive failures before recording a transition to avoid flapping. Make thresholds constants with tests, not unexplained UI magic.

### Persisted history

Record only transitions and coarse operational events:

- App first seen.
- Origin/port changed.
- Healthy to unhealthy and recovery.
- Network exposure scope changed.
- Duplicate instance appeared or cleared.
- App became inactive.

Do not store every polling sample. Compact events by retention age and maximum file size. The UI should show last seen, last healthy, current uptime, and a short recent event timeline.

Use a per-process in-memory write queue so refreshes cannot interleave JSONL writes. Tolerate and report one truncated final line after a crash. Compact through write-to-temp, flush, and atomic rename; never compact in place.

## Final Portal Experience

Continue using `/localhoster` and the page files introduced in V1. Extend the page without creating another dashboard.

### Overview

- Summary chips for healthy, unhealthy, inactive, unmatched, and network-exposed apps.
- Search across project, app, route label, process, branch, and port.
- Filters for status, active/inactive, Docker/process, bind scope, favorites, and identity conflicts.
- Favorites first, followed by active projects, unmatched instances, and collapsed inactive projects.
- Optional compact and detailed card modes stored in browser-local presentation preferences.
- A prominent capability notice whenever discovery is limited, unsupported, or temporarily unavailable, while retaining access to saved projects and links.
- A **Copy diagnostics** action that produces a redacted summary of capabilities, warnings, identities, and current states without exposing absolute paths by default.

### Project card

Show project name, app-folder and repository-root actions, Git branch/status, and app cards. A project-level menu manages its name, favorite/hidden state, aliases, and associations.

### App card

Show:

- Name and current origin.
- Health state, HTTP status, latency, and last transition.
- Process/container identity, uptime, CPU, and memory.
- Port and bind scope.
- Quick links and discovered-link suggestions.
- Actions: Open, Copy URL, Add link, Edit app, Inspect evidence.

### Detail drawer

Follow the existing Plans drawer pattern rather than navigating away. Include:

- Identity evidence and confidence.
- Current process/container facts.
- Health configuration and recent checks.
- Git information.
- Recent bounded event timeline.
- Raw discovered metadata limited to display-safe fields.
- Controls to correct or remove a manual association.

### Inactive and unmatched workflows

- Inactive saved apps retain quick links but disable opening until an origin is rediscovered.
- Unmatched instances offer **Associate with project/app** and **Hide this instance**.
- Conflicts show candidate projects/apps and their evidence; never choose silently.
- A settings view lists hidden instances, identity aliases, and manual associations so decisions are reversible.

Opening and copying links use the app's chosen current origin, including hostname preference. Show alternate loopback origins in the detail drawer, not as competing primary buttons. If an origin changes while a dialog is open, resolve its saved path against the newest snapshot at click time.

Pause polling in hidden tabs, preserve focus across unchanged renders, announce refresh completion through a polite live region, and avoid replacing the entire card tree when only telemetry fields changed.

## Portal Architecture Requirements

Keep the implementation aligned with RoboRepo's current portal conventions:

- `/localhoster` remains registered once in `PAGES`; shared navigation stays generated by `theme.js`.
- `portal/localhoster/index.html` owns semantic structure and templates.
- `portal/localhoster/templates.js` owns dynamic markup creation.
- `portal/localhoster/state.js` owns pure filters, grouping, sorting, health presentation, and URL building.
- `portal/localhoster/api.js` remains thin wrappers over shared GET/POST helpers.
- `portal/localhoster/app.js` only coordinates state, DOM events, polling, and rendering.
- `portal/localhoster/styles.css` uses shared palette/type variables and contains only page-specific layout.
- `handleLocalhosterApi` remains a small dispatcher; discovery, persistence, history, and telemetry stay outside `portal-server.mjs`.

Split the final domain implementation by responsibility:

```text
modules/localhoster/
  index.mjs
  listeners.mjs
  identity.mjs
  http-probe.mjs
  process-metrics.mjs
  docker.mjs
  git.mjs
  settings.mjs
  history.mjs
  snapshot.mjs
  capabilities.mjs
  origin.mjs
scripts/cli/localhoster.mjs
portal/localhoster/
  index.html
  styles.css
  app.js
  api.js
  state.js
  templates.js
  panels.js
```

Modules should accept injected command runners, clocks, filesystem boundaries, and HTTP clients where doing so makes deterministic tests possible.

## API Evolution

Retain V1 endpoints and add narrowly scoped mutations:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/localhoster` | GET | Current cached snapshot and capabilities |
| `/api/localhoster/refresh` | POST | Force all available discovery providers |
| `/api/localhoster/links` | POST | Add, update, remove, or reorder a quick link |
| `/api/localhoster/association` | POST | Create or remove a project/app association |
| `/api/localhoster/project` | POST | Update project/app names, preferences, favorites, health paths, match hints, or visibility |
| `/api/localhoster/alias` | POST | Create or remove a confirmed project identity alias |
| `/api/localhoster/history?key=<key>` | GET | Bounded recent events for a server-issued app key |
| `/api/localhoster/metadata?key=<key>` | GET | Safe conventional metadata and route suggestions |

Use explicit mutation payloads rather than accepting arbitrary nested settings. Every mutation includes the last-seen settings revision; conflicts return `409` and the authoritative snapshot. All POSTs continue to inherit the portal origin and mutation-token protections.

Use server-issued opaque keys for current instances. Never let the browser request a probe by arbitrary URL, inspect an arbitrary PID, execute a command, or read an arbitrary path.

Mutation compatibility decisions:

- Keep the current V1 "replace full app links array" domain primitive, but expose true UI operations for add, edit, delete, and reorder. Each operation should read current links, construct the new full ordered array, and call the same settings mutation until there is a proven need for per-link patch semantics.
- Keep `project` mutation as the endpoint for both project and app editing, but make payload shape explicit: project name/favorite/hidden are project fields; app name/origin preference/health/match hints are app fields.
- Keep `association` mutation reversible. Association deletion must not delete saved project/app settings or quick links.
- Add read-only `history` and `metadata` endpoints only after opaque current-instance keys exist in the snapshot.

## Performance and Resilience

- Run independent providers concurrently with per-provider timeouts.
- Limit HTTP and process inspection concurrency.
- Cache project-level Git and identity work once per scan.
- Use a fast listener refresh more frequently than expensive Git, Docker, metadata, and process metrics refreshes.
- Preserve the last successful provider result when another provider temporarily fails, marking it stale.
- Abort work when a newer explicit refresh supersedes an older one.
- Keep browser polling lightweight by returning cached snapshots and change tokens.
- Skip re-rendering when the snapshot's stable presentation hash has not changed, following Config's `snapshotChanged` pattern.
- Never invoke commands belonging to another platform adapter; select providers once from `process.platform` and return capability results for everything else.
- Keep one shared asynchronous refresh coordinator. Deduplicate concurrent refresh requests, expose per-provider progress, and discard late results from superseded generations.
- Use separate cadences for listeners, health, process metrics, Git, Docker, and metadata. Metadata is on-demand or infrequent; it must not run during every browser poll.
- Apply explicit global and per-project budgets so a machine with hundreds of listeners returns a bounded partial snapshot with a truncation warning.

## Security and Privacy

Retain every V1 protection and add:

- Docker inspection must be read-only.
- Git status must never contact remotes or invoke hooks.
- Metadata discovery remains loopback-only and same-origin.
- Sitemaps/OpenAPI documents receive strict body-size and parsing limits.
- Sanitize favicon and manifest URLs before browser use.
- Never expose full Docker inspect payloads, process arguments, environment variables, or HTTP bodies.
- Redact credentials from every remote, URL, error, and command-derived value.
- History contains stable identities and state transitions, not secrets or response content.
- Hidden/unmatched decisions are local settings and can be cleared from the UI.
- Link opening uses `noopener,noreferrer`; copied diagnostics redact home paths, remote credentials, command arguments, and response content.
- Health checks use `GET` only for configured or previously proven-safe paths, never submit forms, execute discovered actions, or follow non-loopback redirects.

## Testing Plan

Expand `scripts/test/localhoster-check.mjs` and split fixtures by provider when helpful.

### Unit and fixture tests

- Project identity remains stable across PID and port changes.
- App identity distinguishes Web/API apps in one repository.
- Ambiguous scoring produces a conflict instead of an automatic match.
- Manual associations override learned evidence and can be removed.
- Docker/Compose labels map containers to projects and app roles.
- Docker and `lsof` observations merge without duplication.
- macOS, Windows, Linux, and unknown-platform capability aggregation.
- Unsupported Windows discovery renders explicit messaging and executes no macOS commands.
- Limited-provider snapshots enumerate missing capabilities without hiding valid partial results.
- Process uptime, CPU, and memory parsers handle missing/exited processes.
- Git branch, detached HEAD, dirty state, and no-remote repositories.
- Manifest, sitemap, robots, and OpenAPI parsing with size and origin limits.
- Health grace windows, consecutive-failure transitions, recovery, and flap resistance.
- Event append, compaction, retention, malformed-line tolerance, and maximum size.
- V1-to-V2 settings migration and backup behavior.
- Identity-alias confirmation, cycle prevention, and collision handling.
- Origin preference across `localhost`, IPv4, IPv6, and self-signed HTTPS.
- Bounded provider budgets and a large synthetic listener set.
- Hidden-tab polling pause, focus preservation, live-region announcements, and safe new-tab opening.
- Filtering, grouping, favorites, inactive projects, and conflict presentation.
- Every redaction boundary for remotes, commands, errors, and URLs.

### API and portal tests

- Every GET endpoint rejects invalid or expired opaque keys safely.
- Every POST endpoint enforces origin and mutation token.
- Mutation bodies reject arbitrary paths, origins, PIDs, unknown identities, and invalid link URLs.
- Provider failures yield partial capabilities and warnings, not a page failure.
- Page scripts parse and templates contain expected accessibility anchors.
- Snapshot change tokens remain stable for equivalent observations.

### Manual macOS scenarios

- Vite/Next applications whose ports change after restart.
- One monorepo running Web and API processes.
- Docker Compose with published Web, API, database, and Mailpit ports.
- Authenticated page returning `401` or redirecting to login.
- HTTPS localhost development server.
- Wildcard-bound app visible from the LAN.
- Repository with no remote and repository moved to a new folder.
- Docker daemon stopped while ordinary local processes remain available.
- Windows unsupported/limited state in a Windows VM or fixture-driven browser test.
- RoboRepo portal represented as a built-in app without recursive self-probing.

## Documentation Updates

- Expand `docs/reference/services/localhoster.md` with the final concept model, providers, identity scoring, history, API, privacy, and troubleshooting.
- Keep `docs/reference/services/portal.md` focused on shared architecture; mention only the Localhoster page and API dispatcher there.
- Update `README.md` and the CLI reference with Localhoster capabilities.
- Add a short user guide explaining quick links, manual associations, inactive projects, health paths, and network-exposure warnings.
- Include troubleshooting for hostname-sensitive apps, self-signed HTTPS, Docker Desktop, identity conflicts, stale snapshots, and platform limitations.
- Document settings schema versions and recovery from a corrupt settings/history file.

## V1 Completion Gate

Finish these items before final feature implementation starts:

- [x] Replace the current "add link/remove last link" dialog with true individual quick-link edit, delete, and reorder controls backed by the existing `/api/localhoster/links` mutation.
- [x] Add project friendly-name editing through `/api/localhoster/project`; keep app renaming in the same workflow but show project and app names as separate fields.
- [x] Add the unsupported/limited capability documentation link to the portal notice and cover it in a portal fixture.
- [x] Implement alias migration from `path:<realpath>` to `git:<remote>` only after explicit confirmation, or record a deliberate defer decision in this plan and V1 review status.
- [x] Add stale, refreshing, and failed-refresh coverage, including failed refresh retaining the last successful snapshot and showing its generated timestamp.
- [x] Make probe concurrency bounded and documented in `modules/localhoster/discovery.mjs` / `modules/localhoster/probe.mjs`.
- [x] Add fixture coverage for self-signed HTTPS classification, oversized response bodies, same-origin redirects, external redirect rejection, and network-exposure warning rendering.
- [ ] Run and record manual macOS validation with multiple real Node/Vite apps on changing ports.

Close these during final phase 1 if they naturally share code with V2 migration:

- [x] Alias migration confirmation UI. Cycle-safe alias storage is implemented.
- [x] Reversible association and hidden-instance settings view.

## Implementation Sequence

1. **Complete the V1 gate.** Finish the V1 gaps listed above, update `docs/reference/services/localhoster.md`, and keep `localhoster-v1` backlog until manual macOS validation is recorded.
2. **Add schema V2 and aliases.** Migrate settings in place with backup, defaults, fixture tests, alias storage, favorite/hidden flags, health config, match hints, and preferences. Keep V1 mutation compatibility.
3. **Split provider architecture.** Extract listener, origin, probe, identity, capability, snapshot, and settings responsibilities while preserving current CLI/API behavior.
4. **Add refresh coordinator semantics.** Add provider cadences, stale provider retention, superseded-generation aborts, bounded concurrency, progress, and partial warnings.
5. **Add Docker and process providers.** Merge Docker/Compose endpoint evidence with `lsof`, add process metrics on slower/detail cadence, and keep absence/permission failures as capability notes.
6. **Add Git provider.** Cache branch, short commit, dirty state, detached HEAD, and local ahead/behind when available without network fetches.
7. **Add health and history.** Normalize health states, add transition debounce, append JSONL events, tolerate malformed final line, and compact by age and size.
8. **Add metadata suggestions.** Fetch manifest, favicon, robots/sitemap, and OpenAPI only under documented same-origin and size limits. Present suggestions as "Add as quick link".
9. **Expand portal workflows.** Add filters, favorites, hidden/unmatched settings, project/app menus, evidence/history drawer, diagnostics copy, compact/detail modes, and accessible focus-preserving renders.
10. **Finalize API surface.** Add `/history` and `/metadata`, tighten opaque-key validation, and cover all mutation security boundaries.
11. **Document and validate.** Update reference/user docs, CLI docs, README, and run targeted Localhoster, portal smoke, broad RoboRepo, and manual macOS scenario validation before completion.

## Acceptance Criteria

- One project can reliably display and retain separate Web, API, Storybook, Mailpit, or other app identities without depending on their ports.
- Saved quick links always resolve against the matching app's newest current origin and hostname preference.
- Git remote, path, process, Docker, and HTTP evidence are combined transparently; ambiguous matches require user confirmation.
- Current health, latency, uptime, CPU, memory, Git status, Docker health, and bind scope appear when available and degrade gracefully when unavailable.
- The portal records bounded state transitions and last-seen information without storing continuous samples or sensitive payloads.
- Network exposure, unhealthy apps, duplicate instances, stale observations, and identity conflicts are clearly visible.
- Optional sitemap, manifest, and OpenAPI results are suggestions only; curated links remain authoritative.
- No repository-specific configuration is required.
- Windows users receive accurate unsupported or limited-discovery messaging and never see an ambiguous empty dashboard.
- All local mutations remain protected by RoboRepo's existing origin and per-server token contract.
- Settings migration preserves V1 names and links and creates a recoverable backup.
- Provider, domain, API, portal smoke, security, migration, and broad RoboRepo tests pass.
- Large listener sets remain bounded, UI refreshes preserve focus, and copied diagnostics are safe to share by default.

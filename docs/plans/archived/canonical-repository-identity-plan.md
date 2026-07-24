---
id: canonical-repository-identity-plan
priority: medium
next_action: Fill in the next concrete task.
blocked_by: []
depends_on: []
related: []
reviewed_commit:
---

# RoboRepo Canonical Repository Identity and Activity Correlation — Implementation Plan

## Purpose

Create one local repository identity system that allows Localhoster instances, telemetry sessions, plans, health findings, and future portal features to refer to the same repository reliably.

This plan delivers the plumbing and domain adoption. It does not add repository-centric homepage cards or redesign existing domain pages.

## Confirmed Product Decisions

- Implement identity unification now.
- Connect localhost instances to repositories represented in other RoboRepo domains.
- Prefer reliable structural evidence over prompt-content guessing.
- Ship plumbing first and revisit cross-domain UI later.
- Preserve Telemetry's local/privacy-oriented data model.
- Records that cannot be associated remain visible as unresolved; they are never discarded.

## Existing Signals

### Localhoster

`modules/localhoster/identity.mjs` already:

- Finds the nearest Git root from a process working directory.
- Normalizes SSH and HTTPS remotes to `git:<host>/<owner>/<repo>`.
- Falls back to `path:<realpath>` and then a low-confidence process identity.
- Labels evidence and confidence.

Localhoster settings schema version 2 also supports user-confirmed identity aliases with cycle protection.

### Plans

Plan discovery already identifies repository boundaries and gathers Git HEAD, branch, per-file last-commit date, and file state. It does not yet publish one shared canonical repository identity.

### Telemetry

Telemetry records repository label, hashed working-directory/Git-root information, hashed remote information, branch, commit, and session ID. Existing raw remote hashes cannot be directly joined to Localhoster's normalized clear-text remote identity unless normalization and hashing are performed consistently.

## Canonical Identity Model

Use these identity forms:

```text
git:<normalized-host>/<owner>/<repository>
local:<opaque-stable-id>
```

The Git identity is portable across machines. A local ID represents repositories without a usable remote and avoids exposing absolute paths to consumers.

Do not use display names as identity. Do not automatically merge repositories because their folder names match.

### Repository registry record

Store a versioned machine-local registry under the RoboRepo state root, for example:

```text
<stateRoot>/repositories/registry.json
```

Recommended record:

```json
{
  "id": "git:github.com/kirinmurphy/roborepo",
  "kind": "git",
  "displayName": "roborepo",
  "providerUrl": "https://github.com/kirinmurphy/roborepo",
  "normalizedRemote": "git:github.com/kirinmurphy/roborepo",
  "localRoots": [
    {
      "rootHash": "hash",
      "firstSeenAt": "ISO-8601",
      "lastSeenAt": "ISO-8601"
    }
  ],
  "aliases": [],
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Keep absolute local roots out of browser/API payloads. If the registry needs a real path for local discovery, store it only in the machine-local record and expose an opaque hash or ID outward.

## Shared Resolver

Move repository discovery and remote normalization into a domain-neutral module, such as:

```text
modules/repositories/
  identity.mjs
  registry.mjs
  schema.mjs
  associations.mjs
```

Responsibilities:

- Resolve Git roots, including worktrees where `.git` is a file.
- Read the configured `origin` remote when available.
- Normalize SSH, HTTPS, case, trailing slash, `.git`, query, and fragment variations.
- Produce a canonical Git ID.
- Produce stable local fallback identities without using a folder name alone.
- Register local-root hashes and last-seen timestamps.
- Resolve confirmed aliases transitively and reject cycles.
- Return confidence, evidence type, and association provenance.
- Avoid domain-specific presentation logic.

Localhoster should import this module rather than owning the canonical implementation.

## Normalization Rules

- Lowercase the host.
- Remove credentials and transport-specific syntax.
- Remove query strings, fragments, trailing slashes, and terminal `.git`.
- Preserve owner/repository path casing unless a provider-specific rule proves case-insensitivity; comparisons may use a normalized comparison key.
- Reject empty paths and traversal-like paths.
- Prefer `origin`; allow an explicit future override for repositories whose canonical upstream is not origin.
- Generate provider URLs only for recognized hosts or through a safe URL builder.

Add fixtures covering GitHub SSH/HTTPS forms, ports, worktrees, missing remotes, malformed values, and repositories with multiple remotes.

## Confidence and Evidence

| Evidence | Confidence | Automatic association |
| --- | --- | --- |
| Same normalized Git remote | High | Yes |
| User-confirmed alias | High | Yes |
| Same Git-root hash on the same machine | High locally | Yes |
| Current working directory inside a resolved Git root | High locally | Yes |
| Path identity explicitly aliased to Git identity | High | Yes |
| Process working directory without Git | Medium locally | Register separately |
| Same repository/folder name | Low | No |
| Prompt or chat text mentions a repository | Suggestion only | No |

Every association result should expose its evidence and confidence so future UI can explain why records were connected.

## Registry Persistence

- Use a strict versioned schema.
- Write atomically through a sibling temporary file and rename.
- Serialize concurrent writes or use optimistic revision checks.
- Preserve unknown future-safe fields only if the project's schema conventions permit it; otherwise fail clearly.
- Maintain `firstSeenAt` and `lastSeenAt` without rewriting the file unnecessarily.
- Keep aliases explicit and reversible.
- Detect alias cycles before committing a mutation.
- Back up the previous schema during migrations.

The registry is machine-local state, not authored package content. Cross-machine portability comes primarily from the canonical Git ID; local path mappings are rediscovered per machine.

## Domain Adoption

### Localhoster

- Replace direct use of `modules/localhoster/identity.mjs` with the shared resolver.
- Preserve existing public identity strings where they already match the canonical format.
- Migrate or delegate existing Localhoster aliases into the shared registry without losing confirmed associations.
- Include `repositoryId`, confidence, and evidence in server-side snapshots.
- Keep process-only instances unresolved or locally identified.

### Plans

- Resolve a repository record once per discovered repository.
- Add `repositoryId` to repository summaries and plan records.
- Reuse the canonical display name and provider URL where appropriate.
- Keep non-Git plan roots usable through a local identity.
- Do not expose absolute discovery roots in browser payloads.

### Telemetry capture

For new records:

- Resolve repository identity from the event working directory at capture time when possible.
- Write a stable local registry reference or privacy-safe repository key into the event.
- Continue recording the existing hashed root/remote fields during a defined migration window if current reports depend on them.
- Normalize the remote before hashing so equivalent SSH and HTTPS remotes correlate.
- Never store prompt or tool-result content for identity resolution.

The capture path must remain cheap. Cache working-directory-to-repository resolution and invalidate it conservatively when Git metadata changes.

### Telemetry reads and historical association

Do not rewrite the entire spool as a prerequisite.

At read time:

- Prefer the new repository reference.
- Otherwise match legacy normalized-remote hashes known to the registry.
- Otherwise match local Git-root hashes on the same machine.
- Otherwise leave the record unresolved.

Expose association provenance such as `direct`, `legacy-remote-hash`, `legacy-root-hash`, or `unresolved`.

### Doctor and Config

- Attach a `repositoryId` to findings only when the check is repository-scoped.
- Keep global installation and global resource warnings unassociated.
- Never force every warning into a repository.

## API Contracts

Create one browser-safe repository summary shape:

```json
{
  "repositoryId": "git:github.com/kirinmurphy/roborepo",
  "displayName": "roborepo",
  "providerUrl": "https://github.com/kirinmurphy/roborepo",
  "confidence": "high",
  "evidence": "git-remote"
}
```

Domain APIs may embed this summary or return `repositoryId` plus a top-level repository lookup. Prefer a lookup when the same repository appears many times in one payload.

Do not expose:

- Absolute local paths.
- Raw Git configuration.
- Credentials embedded in malformed remotes.
- Telemetry prompt or result content.
- Internal alias graphs beyond what a management UI explicitly needs.

## Migration

1. Introduce the shared resolver with behavior-equivalence tests against Localhoster's current resolver.
2. Add the registry and schema without changing UI.
3. Import confirmed Localhoster aliases into the shared registry, retaining a migration marker and backup.
4. Adopt the resolver in Localhoster and Plans.
5. Add new repository references to Telemetry capture.
6. Add read-time matching for legacy Telemetry records.
7. Attach repository IDs to structured Doctor/Config findings where applicable.
8. Add browser-safe repository summaries to domain and homepage APIs.
9. Remove duplicated resolver code only after parity and migration tests pass.

Migration must be idempotent. Re-running it must not duplicate registry entries, aliases, or backups.

## Failure Handling

- A malformed registry must not stop the portal from serving unrelated global data.
- Report registry errors as structured health findings.
- If Git commands or files are unavailable, fall back to local identity or unresolved status.
- If two records conflict, do not silently merge them; retain both and surface an actionable conflict.
- If an alias target disappears, keep the alias record but mark it unresolved until repaired.
- If historical telemetry cannot be associated confidently, leave it unassociated.

## Performance

- Cache resolution by real working directory plus relevant Git metadata signature.
- Resolve each repository once per Plans scan.
- Avoid registry writes when only `lastSeenAt` would change within a short debounce window.
- Keep Telemetry read-time legacy matching indexed by hash.
- Keep browser payloads deduplicated and path-free.

## Validation

Add focused tests for:

- SSH/HTTPS normalization equivalence.
- Worktree `.git` files.
- Missing, malformed, and multiple remotes.
- Registry atomic writes, revisions, migrations, and corruption handling.
- Alias confirmation, transitive resolution, removal, and cycle rejection.
- Localhoster behavior parity after resolver extraction.
- Plans receiving the same ID as Localhoster for the same Git repository.
- New Telemetry records receiving repository references.
- Legacy Telemetry association through normalized remote hash and local root hash.
- No association based only on a matching name.
- Unresolved records remaining visible.
- Browser/API payloads containing no absolute paths or remote credentials.
- Cross-domain summaries using one repository ID.

Run the existing Localhoster, Plans, Telemetry, doctor, Config/context-cost, and full test suites after focused tests pass.

## Acceptance Criteria

- Localhoster, Plans, and new Telemetry records resolve the same Git repository to the same canonical ID.
- Equivalent SSH and HTTPS remotes correlate.
- Existing confirmed Localhoster aliases migrate without loss.
- Historical telemetry is associated only when current hashes support a confident match.
- Every association exposes confidence and provenance.
- Name-only and prompt-text matches never cause automatic merges.
- Non-Git and unresolved activity remains usable and visible.
- Portal payloads do not expose absolute paths or sensitive remote data.
- Identity plumbing is available to the homepage without requiring repository-centric UI.

## Deferred Work

- Repository cards combining active apps, chats, plans, warnings, and health.
- Suggested alias UI based on low-confidence evidence.
- Prompt-content semantic association.
- Cloud synchronization of machine-local registry mappings.
- Cross-machine synchronization for repositories without a Git remote.
- Provider APIs for richer repository metadata.


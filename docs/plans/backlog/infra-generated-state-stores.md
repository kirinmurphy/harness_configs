---
id: n8kw3rp2
priority: medium
next_action: Extend scripts/cli/state-paths.mjs from a path registry into a store registry carrying retention and size limits, then add a doctor check that reads from it
blocked_by: []
depends_on: []
related:
  - h4tqm2wz
  - pljvmyh
reviewed_commit:
---

# Generated State Stores: Inventory, Retention, and Visibility

## Summary

RoboRepo writes several kinds of user data under `~/.roborepo/` — telemetry, runtime history,
repository records, saved settings. Each store was built with its own path helper, its own write
routine, and its own retention policy or lack of one. Nothing enumerates them, so nobody can answer
"what does RoboRepo store, how big is it, and what prunes it?" without reading the source.

This plan adds that inventory, gives every store an explicit retention decision (including the
decision not to prune), and surfaces size to the user before a store becomes a problem.

## Context

Storage growth here is not hypothetical. Measured on one developer machine after roughly six weeks
of use:

| Store | Size | Retention today |
| --- | --- | --- |
| `telemetry/spool/claude.jsonl` | 25 MB | 25 MB cap — **holds only ~9 days of history** |
| `telemetry/spool/codex.jsonl` | 21 MB | Same cap |
| `telemetry/collector/` | 4 MB across 1,018 files | **None** — files date back six weeks |
| `localhoster/history.jsonl` | 484 KB | 14 days + 2 MB cap |
| `skills/` | 232 KB | None |
| `repositories/registry.json` | 10 KB | None, by design (see `h4tqm2wz`) |
| `localhoster/settings.json` | 4 KB | None, by design — user-authored |

Two findings drive this plan.

**A size cap is silently setting a very short history window.** The Claude telemetry spool holds
14,465 records at ~1.7 KB each, spanning 9.2 days. There is no SQLite file, so the spool is the
durable store rather than a staging buffer — trimmed records are gone. `SPOOL_KEEP_FRACTION = 0.7`
means each trim drops to roughly 6 days before regrowing.

The consequence is not disk pressure; 25 MB is negligible. It is that any Tokens analysis over a
longer range is silently truncated, and nothing says so. The cap was sized against a fear (a
long-lived install filling the disk) rather than against a requirement (how far back analysis should
reach), and those produce very different numbers: at this usage rate, six months of history would
cost roughly 500 MB — still small on a modern disk.

**Retention is per-store and inconsistent by accident, not by decision.** Localhoster history has a
carefully built two-stage policy (age, then size). The telemetry collector, which accumulates one
file per session forever, has nothing. The difference does not reflect a judgment about the two
stores; it reflects which one someone happened to build a policy for.

### What is already shared, and what is not

The stores do agree on some conventions, arrived at independently:

- every path helper takes a `stateRoot` parameter (`historyPathFor`, `settingsPathFor`,
  `registryPathFor`), so nothing hardcodes a home directory;
- the three JSON stores each write atomically via a `.tmp` file plus `renameSync`;
- the two revisioned stores (`localhoster/settings.json`, `repositories/registry.json`) each carry a
  `revision` integer for conflict detection.

The atomic-write block is copy-pasted three times with only the temp-file prefix differing
(`modules/localhoster/history.mjs`, `modules/localhoster/settings.mjs`,
`modules/repositories/registry.mjs`). That is the concrete duplication worth removing; the rest of
the convergence is fine as-is.

## Goals

- Make every generated store discoverable from one declarative inventory rather than from source.
- Give each store an explicit, recorded retention decision — including "unbounded, deliberately".
- Keep RoboRepo's storage footprint continuously visible as a quiet receipt, escalating to a warning
  and then an alert as it takes a meaningful share of the user's remaining disk — measured against
  the machine, not against a fixed byte count.
- Say plainly when a cap is actively discarding data.
- Remove the duplicated atomic-write implementation.

## Non-goals

- Changing what telemetry captures, or its capture pipeline. This plan reads sizes and applies
  retention; it does not touch the schema.
- Adding retention to user-authored data. `localhoster/settings.json` holds saved links and
  preferences the user created; it is never pruned by age.
- Deleting repository registry records. `h4tqm2wz` establishes that records persist permanently and
  age out of view rather than out of existence.
- A general storage-quota or garbage-collection framework. Each store keeps its own policy; this
  plan makes the policies visible and consistent in shape.
- Migrating any store to a database.

## Current state

### Store ownership

Each store owns its own path helper, read/write pair, and policy:

| Store | Module | Retention constant |
| --- | --- | --- |
| Localhoster history | `modules/localhoster/history.mjs` | `DEFAULT_RETENTION_DAYS = 14`, `HISTORY_MAX_BYTES = 2MB` |
| Localhoster settings | `modules/localhoster/settings.mjs` | None (user-authored) |
| Repository registry | `modules/repositories/registry.mjs` | None |
| Telemetry spool | `scripts/cli/telemetry-capture.mjs` | `SPOOL_MAX_BYTES = 25MB` per harness |
| Telemetry collector | `scripts/cli/telemetry-capture.mjs` (session cursors) | None |

### A partial inventory already exists

`scripts/cli/state-paths.mjs` resolves and exports most of these paths in one place —
`telemetrySpoolDir`, `telemetryCollectorDir`, `repositoriesRegistryPath`, `roborepoSkillsDir`, and
others — all derived from a single `stateRoot` that respects `ROBOREPO_STATE_DIR`. It also provides
shared `readJsonState`/`writeJsonState` helpers for the smaller state files.

What it records is **where** each store lives. What it does not record is how big a store may grow,
what prunes it, or why. It is a path registry, not a policy registry, and it is the natural place to
extend rather than a reason to build something new.

Two stores sit outside it: `localhoster/history.jsonl` and `localhoster/settings.json`, whose path
helpers take an injected `stateRoot` parameter instead (`historyPathFor`, `settingsPathFor`) so the
localhoster modules stay testable without touching the real state root. Any inventory has to
accommodate both shapes rather than assuming every path is a module-level constant.

### Retention that exists is good

`maybeCompact` in `modules/localhoster/history.mjs` is the model worth generalizing: it drops events
past the age window, trims to the size cap only if still oversized, and returns without rewriting
when nothing changed. That last property matters — it is what keeps a steady-state append from
rewriting the file byte-for-byte.

The telemetry spool's cap is simpler (drop oldest lines past a byte ceiling) and has no age
dimension.

### No user-facing storage visibility

`scripts/doctor.sh` reports on install correctness — files, links, JSON validity — and says nothing
about state size. The portal has no storage surface. Nothing reports that a spool is at its cap.

## Proposed design

### 1. A store inventory

Extend `scripts/cli/state-paths.mjs` from a path registry into a store registry, rather than adding
a second module that would immediately disagree with it. It already resolves most paths from one
`stateRoot`; what it gains is the policy each path carries.

Follow the repo's config-as-data convention (`docs/architecture/config-code-separation.md`): the
list of stores and their limits is data; the pruning and reporting behavior is code that reads it.

Each entry records:

| Field | Meaning |
| --- | --- |
| `id` | Stable key, e.g. `telemetry-spool` |
| `path` | Location relative to the state root, or a resolver for stores that take an injected root |
| `kind` | `file`, `jsonl`, or `directory` |
| `owner` | Module that reads/writes it |
| `retention` | `{ kind: "age-then-size" \| "size" \| "count" \| "none", ... }` |
| `rationale` | Why that policy — required for `none`, so "unbounded" is a decision on record |
| `growth` | `bounded` (a cap or window governs it) or `unbounded` — decides whether it is a candidate for the disk-share warning |

The inventory is the deliverable that answers your question directly: it is the one place that says
what RoboRepo stores and what happens to it.

### 2. Retention for the stores that lack it

Apply the inventory's policy to the two unbounded stores that accumulate without user intent:

- **Telemetry collector** — one file per session, 1,018 files after six weeks. Prune by age, matching
  the spool's window, or by count. These are cursors, not user data.
- **Skills cache** — small today (232 KB); confirm whether it is derived (safe to prune) or
  authored (never prune) and record the answer as the rationale.

Stores whose correct policy is "unbounded" keep it, with the rationale recorded:
`localhoster/settings.json` because the user wrote it, `repositories/registry.json` because
`h4tqm2wz` establishes records as permanent at ~1.1 KB each.

### 3. Express retention as time, with size as a backstop

A byte cap answers "how much disk may this use". Users, and the Tokens page, care about "how far
back can I look". Those are only equivalent at a fixed usage rate, which nothing guarantees — a busy
week silently shortens the window.

Give the telemetry spool a target window in days, and keep a byte ceiling as a safety limit rather
than as the primary policy:

| Setting | Role |
| --- | --- |
| `retentionDays` | The intended history depth — what trimming aims to preserve |
| `maxBytes` | Backstop against pathological growth, sized well above the expected window |

Raise the ceiling accordingly. At the measured rate, six months costs roughly 500 MB; the current
25 MB was never chosen against a history requirement. The ceiling stays a fixed byte value — it
protects against pathological growth, and §5's disk-share reporting is what adapts the *warning* to
the machine. Sizing the ceiling itself to the disk would let a large machine accumulate telemetry
nobody asked for.

Do not expose this as a user setting yet. A byte count is not a choice a user can make meaningfully
without knowing their own record rate, and a days-based policy plus an honest report of the actual
window covers the need. Revisit once the window is visible and someone still wants it different.

### 4. Report when a cap is discarding data

A size cap that silently drops the oldest records is invisible today. When compaction or trimming
actually discards data, record that it happened — a count and a timestamp — so the user can be told
their telemetry history is bounded rather than complete.

This is the change that turns the current spool behavior from a surprise into a stated fact.

### 5. Size visibility, measured against the disk

A fixed byte threshold cannot be responsible on both a 256 GB laptop and a 2 TB workstation. The
same 500 MB is a rounding error on one and a real bite out of a nearly-full disk on the other. What
matters is not how large RoboRepo's state is in absolute terms but **how much of the user's
remaining space it is taking**, and how fast.

Read capacity with `fs.statfsSync(stateRoot)`, available since Node 18.15 and safely below this
repo's `>=20` floor. Measure against **available** space rather than total: a 2 TB disk with 4 GB
free deserves the same caution as a small one.

#### One readout, three levels

Storage is not a warning that appears when something breaks; it is a fact that is always true and
occasionally worth acting on. Render it as a persistent readout whose presentation escalates, rather
than as an alert that is absent until it fires.

| Level | Condition | Presentation |
| --- | --- | --- |
| `receipt` | Normal — a small share of available space | Quiet line at the bottom of the Tokens page: size, and the retained telemetry window |
| `warning` | A meaningful share of available space | Same line, warning treatment; a `roborepo doctor` finding |
| `alert` | A large share of available space, or free space critically low | Same line, alert treatment; a doctor finding naming what to prune |

The value of the receipt level is that it makes the cost of enabling telemetry visible where the
user is already looking at telemetry, instead of discoverable only after it becomes a problem. A
user who can see "telemetry: 25 MB · 9 days retained" has the information to judge it; one who sees
nothing until a warning fires does not.

Only `unbounded` stores drive escalation. A bounded store sitting at its configured cap is working
as designed and must not push the readout past `receipt` — otherwise the indicator is permanently
yellow and stops meaning anything.

Thresholds are shares, not byte counts, and live in the inventory rather than in the reporting code.

#### Where it renders

- **Bottom of the Tokens page** (`portal/telemetry/`) — the receipt, scoped to the page whose data
  it describes. Deliberately not the shared portal footer: storage is a telemetry concern, and a
  readout on every page would put it in front of users looking at Plans or Localhost, where it is
  noise.
- **`roborepo doctor`** — a finding at `warning` and above, plus a line for any store actively
  discarding data. Follows doctor's existing check conventions.
- **`roborepo telemetry status`** — already exists as a command and is where someone asks about
  telemetry specifically; report size, window, and level there.

Enabling telemetry is the moment the user takes on this growth, so state the expected cost then, in
the same terms the readout uses.

#### Measurement cadence

Storage size moves slowly — a spool grows over days, and the levels are shares of a disk that also
changes slowly. Nothing here needs to be live.

Measure at most once per page load, and cache the result for a day. A reading that is hours old is
still correct for every decision the readout supports, and this keeps a directory walk (the
collector alone holds ~1,000 files) off the render path entirely. Doctor and `telemetry status`
read the same cached value, refreshing it only when it has expired.

### 6. One atomic-write helper

Extract the `.tmp` + `renameSync` block into a single shared helper and use it from all three JSON
stores. Behavior is identical; this removes the third copy of the same eight lines and gives future
stores one obvious way to write safely.

## Implementation plan

### Phase 1 — Inventory

- [ ] Extend `scripts/cli/state-paths.mjs` with a store registry carrying the fields above, reusing
      the paths it already exports rather than restating them.
- [ ] Include the two injected-root stores (`historyPathFor`, `settingsPathFor`) via a resolver, so
      the inventory is complete without forcing those modules to depend on a global state root.
- [ ] Require a `rationale` on any entry whose retention is `none`, so unbounded is explicit.
- [ ] Add a test asserting every directory present under the state root at runtime has an inventory
      entry, so a new store cannot appear without a retention decision.

### Phase 2 — Shared write helper

- [ ] Extract atomic write (`.tmp` + `renameSync`) into one helper and adopt it in `history.mjs`,
      `settings.mjs`, and `registry.mjs`.
- [ ] Decide whether `writeJsonState` in `state-paths.mjs` should adopt the same atomicity — it
      currently writes in place, so a crash mid-write truncates the file. Either converge the two or
      record why the smaller state files do not need it.
- [ ] Keep each store's existing serialization and revision handling unchanged.

### Phase 3 — Retention gaps

- [ ] Move `SPOOL_MAX_BYTES` and `SPOOL_KEEP_FRACTION` out of `telemetry-capture.mjs` into the
      inventory, so a retention policy is not defined inside a capture script.
- [ ] Add a days-based retention target for the spool, keeping the byte ceiling as a backstop, and
      raise the ceiling to match the chosen window.
- [ ] Add pruning for the telemetry collector.
- [ ] Classify the skills cache as derived or authored and apply the matching policy.
- [ ] Record when a cap discards data: how much, and when.

### Phase 4 — Visibility

- [ ] Read disk capacity with `fs.statfsSync(stateRoot)` and compute total state size against
      available space. Treat an unavailable or implausible reading as unknown.
- [ ] Cache the measurement for a day, computed at most once per page load, so a directory walk
      never lands on the render path.
- [ ] Add one shared level calculation returning `receipt` / `warning` / `alert`, so the Tokens
      page, doctor, and `telemetry status` cannot disagree about the same state.
- [ ] Render the receipt at the bottom of the Tokens page (`portal/telemetry/`): size plus the
      retained window in days, escalating its treatment at `warning` and `alert`.
- [ ] Add a `roborepo doctor` finding at `warning` and above, considering only `unbounded` stores as
      growth drivers.
- [ ] Add a finding when a store is actively discarding data at its cap.
- [ ] Report size, window, and level from `roborepo telemetry status`.
- [ ] State the expected growth cost when telemetry is enabled, in the same terms the readout uses.

## Validation

- [ ] `npm run test:localhoster-history` still passes — existing retention behavior is unchanged by
      the shared write helper.
- [ ] `npm run test:repositories` and `npm run test:telemetry` pass after the helper swap.
- [ ] New `scripts/test/state-stores-check.mjs`, registered as `test:state-stores`:
  - [ ] every runtime store directory has an inventory entry;
  - [ ] an entry with `retention: none` and no `rationale` fails;
  - [ ] collector pruning removes only files past the window, against a fixture with a fixed clock;
  - [ ] the same state size resolves to `alert` on a small/near-full disk and `receipt` on a large
        empty one, driven by a stubbed `statfsSync` so the test does not depend on the host machine;
  - [ ] a large but `bounded` store at its steady-state cap stays at `receipt` — the readout must
        not sit permanently at `warning`;
  - [ ] an unavailable or implausible `statfsSync` reading yields a readout without a level rather
        than a spurious warning;
  - [ ] a cached reading inside its window is reused rather than re-walking the state directory,
        and an expired one refreshes — asserted against a fixed clock;
  - [ ] discard reporting fires when a cap trims and stays silent when it does not;
  - [ ] spool trimming preserves the configured day window when records fit under the byte ceiling,
        and falls back to the ceiling when they do not.
- [ ] `node scripts/test/telemetry-spool-store-check.mjs` still passes — existing spool behavior is
      unchanged apart from where its limits are declared. (It has no `test:` target today; register
      one while touching this area.)
- [ ] Atomic-write helper tested for the failure path: an interrupted write leaves the previous file
      intact.
- [ ] `npm test` — this touches shared write paths across three subsystems.

## Risks

- **Pruning the collector could break session correlation.** Those files appear to be per-session
  cursors; if a long-running session's cursor is pruned mid-flight, capture may misbehave. Confirm
  the lifetime before choosing a window, and prefer a window comfortably longer than the longest
  plausible session.
- **The shared write helper touches three working stores.** The change is mechanical and each store
  keeps its own serialization, but a mistake here corrupts settings. Phase 2 is independently
  testable and should land on its own.
- **`writeJsonState` is not atomic.** It writes in place, so an interrupted write truncates the
  file rather than leaving the previous version intact. Ten call sites across five modules use it,
  including install and workspace state, and each falls back to a default on unparseable JSON — so
  a truncation reads as "no state" rather than as an error. Converging it on the atomic helper is
  low-risk and removes a silent data-loss path, but it widens Phase 2 beyond the three localhoster
  and repository stores.
- **A size warning that fires constantly gets ignored.** The spool sits near its cap by design, so a
  naive "over threshold" finding would warn forever. Distinguish "large" from "discarding" and from
  "unbounded", and let a store at its intended steady-state cap be normal.
- **A near-full disk is not necessarily RoboRepo's doing.** A share-of-available threshold fires
  more readily as a disk fills for unrelated reasons, which risks blaming RoboRepo for someone
  else's growth. Report RoboRepo's own footprint as the subject of the finding, and treat low free
  space as context rather than as the finding itself.
- **`statfsSync` can fail or mislead.** Network mounts, containers, and unusual filesystems may
  report unhelpful figures. Treat an unavailable or implausible reading as "unknown" and skip the
  level rather than warning on a bad number.
- **Sizing a directory means walking it.** The telemetry collector already holds ~1,000 files, so an
  uncached measurement on the render path would add real filesystem work to a page load. A
  once-a-day cached reading avoids this entirely, and is accurate enough for a number that moves
  over days.

## Open questions

- **What history window should telemetry actually keep?** Design §3 makes retention days-based and
  raises the ceiling, but the target number is a product decision measured against what Tokens
  analysis needs to reach back to — 30 days, a quarter, a year. Measure the record rate across
  harnesses before fixing it; the ~1.7 KB/record figure here is one machine over nine days.
- **What share of available disk should warn?** A percentage of free space, an absolute floor, or
  both — a machine with 4 GB free warrants caution at a much smaller footprint than one with 400 GB.
  A reference point from the measured machine: 251 GB total, 67 GB available, RoboRepo state 50 MB —
  under 0.1% of what is free, so nothing here is currently close to warranting a warning.
- **Is the skills cache derived or authored?** Determines whether it can be pruned at all. Requires
  reading its writer before the inventory entry can be filled in honestly.

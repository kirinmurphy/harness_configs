# Item-Level Onboarding Plan

## Purpose

Today `roborepo onboard` is a single screen that toggles whole behavior **bundles** on or off
(`base`, `skills`, `rules`, `hooks`, `commands`, `permissions`, `mcp`, `telemetry`). A bundle maps
to one or more manifest rows, and most rows install as a **whole-directory symlink** — selecting
"Skills" links the entire `globals/agents/skills/` folder into `~/.claude/skills`, every shipped
skill or none.

Users want to choose *individual* items: pick certain skills, certain MCP servers, certain slash
commands — not the whole category. This plan describes a multi-step onboarding wizard (one step per
item type) where each step is a checkbox list of individual items, the user navigates step to step,
and submits at the end. The install mechanism under discussion is per-item symlinks for filesystem-
backed categories, plus the existing direct-write path for root-config-backed items.

## Concept Model

Define the nouns before the workflow.

- **Full inventory** — every item the repo ships, living in repo source: `globals/agents/skills/`
  (shared skills), `globals/claude/commands/` + `globals/codex/commands/` (slash commands),
  `manifests/inventory/mcp-presets.json` (MCP servers). Always complete; the repo always has
  everything. Source of truth for *what exists*.
- **Selection** — the set of item IDs the user picked, per category. Source of truth for *what the
  user wants*. Persisted in preset state (`~/.roborepo/presets/state.json`, path from
  `state-paths.mjs:6`).
- **Item ID** — the stable string that identifies one item within its category, used in state and in
  the wizard. Defined per category:
  - **skill** — the skill folder name under `globals/agents/skills/` (e.g. `blog`, `react`). No
    extension, no path.
  - **slash command** — the command basename without `.md` (e.g. `blog`, `inventory`), matching the
    skill ID where a command wraps a skill.
  - **MCP server** — the preset `name` field from `manifests/inventory/mcp-presets.json` (e.g.
    `jcodemunch`), not an alias. Aliases resolve to the canonical `name` before storage.

  IDs are stored canonical and validated against the current full inventory on read; an unknown ID is
  an error, not a silent skip (see Data Integrity).
- **Active set** — the items actually installed into the harness, derived from (full inventory ∩
  selection). In this plan, the active set is represented by individual symlinks for filesystem-
  backed items and direct writes/merges for root-config-backed items.
- **Category** — an item type that gets its own wizard step: skills, slash commands, MCP servers.
  Each category has a list of selectable items.
- **Filesystem-backed item category** — an item type that can be installed as an individual symlink
  from a repo path into a user-facing home path. In this plan: skills and slash commands.
- **Root-config-backed selection category** — an item or toggle type whose selected behavior lives
  inside `~/.claude/settings.json` or `~/.codex/config.toml`. In this plan: MCP servers and
  permission profiles. These must respect `managed` vs `adopt` root-config ownership.
- **Toggle bundle** — a whole-on/whole-off behavior with no per-item choice: base guidance, Codex
  rules, hooks, permission profiles, telemetry. These keep a simple on/off control.
- **Item dependency** — an item that pulls in another when selected (e.g. the `react` skill pairs
  with `javascript-typescript`; `telemetry` already pulls `hooks` via `withDependencies()` in
  `presets.mjs:281`). Item-level deps are **declared data, not hardcoded**: each item entry in the
  catalog manifest carries an optional `requires: [id, ...]` field. The existing bundle-level
  `telemetry→hooks` rule stays in `withDependencies()`; item deps are resolved from the catalog by an
  extended version of that function. The implementer must not scatter dependency rules across code.
- **Install state** — the first-install ownership mode recorded in
  `~/.roborepo/install-state.json`: `managed` or `adopt`. `managed` means roborepo owns clean
  read-mostly harness links. `adopt` means existing root config stays user-owned, while clean
  non-root harness links can still be installed when selected.

The distinction that drives this plan: **full inventory is always complete in repo source; the
active set is a user-chosen subset that must be represented as either direct symlinks for
filesystem-backed items or direct writes/merges for root-config-backed items.**

## Current Behavior

What exists today, for comparison.

- **Catalog.** `manifests/platform/presets.json` lists 8 bundles and a `default` array of 7. Each
  bundle has `id`, `label`, `description`, and `rows` (manifest row keys like `claude:skills`).
- **Manifest rows.** `manifests/platform/manifest.tsv` maps each row to a repo source path and a
  harness home path, with a `kind`: `link` (clean symlink), `root_config` (copied, adopt-on-collision
  mutable state), or `cleanup` (prune stale link). `claude:skills`, `claude:commands`,
  `codex:commands`, `codex:rules`, `agents:skills` are all `link` rows pointing at whole directories.
- **Onboarding UI.** `presetsOnboard()` (`presets.mjs:72`) prints intro lines, then
  `printBundleChoices()` (`presets.mjs:235`) renders one numbered checkbox per bundle. A single
  `prompter.ask()` reads numbers to toggle, `all`, `none`, or blank. There is no per-item granularity
  and no multi-step navigation. The prompter (`prompts.mjs`) offers `ask` (line-read) and
  `selectMenu` (raw-mode arrow navigation, single-select only) — there is **no multi-step,
  multi-select wizard primitive yet**.
- **Apply.** `applySelection()` (`presets.mjs:286`) walks every bundle: selected → `applyBundle()`
  links/copies its rows; unselected → `removeBundle()` (only when reconciling). Whole directories
  link in or out.
- **State.** `writePresetState()` persists `{ selected: [...ids], onboardedAt, updatedAt, bundles }`.
- **Verification.** `bundleApplied()` (`presets.mjs:455`) checks each row: a `link` row passes when
  `realpath(home) === repo/srcRel` — i.e. "is the whole folder the expected symlink." `doctor.sh`
  and `verify-install.sh` use the same whole-folder link check.
- **Update vs onboard.** `roborepo update` re-runs `install/main.sh` (harness plumbing) and is a
  bypass command for the onboard gate (`isBypassCommand`, `presets.mjs:198`). `roborepo onboard`
  chooses packages. With whole-dir symlinks, a new skill added to the repo appears automatically
  because the home folder is a live link to repo source.
- **Install states.** `install/main.sh` records `managed` or `adopt` in install state. Today both
  modes still install clean non-root links; the key difference is root config ownership. In
  `managed`, missing root config is exported from the repo baseline into a local active file. In
  `adopt`, an existing root config remains active and repo defaults are skipped or handled by the
  selected conflict path. Any item-level plan must preserve that split. The plan also has to respect
  the fact that some files are not symlinked at all and are written directly into the user location.
  Those files behave differently in `managed` and `adopt`.

### Why whole-dir symlink blocks per-item selection

A symlink is a pointer to one path. `~/.claude/skills -> repo/globals/agents/skills` exposes *every*
file in that folder. There is no symlink that means "this folder minus three entries." To install a
user-chosen subset, the active set must be materialized somewhere whose contents are chosen, not a
pointer to the full inventory.

## Proposed Behavior

### Install model: per-item symlinks

For filesystem-backed per-item categories (skills, commands), symlink individual repo items into the
harness home instead of symlinking whole folders. A skill becomes one symlink per skill directory; a
command becomes one symlink per command file.

```
# Claude home
~/.claude/skills/blog      -> <repo>/globals/agents/skills/blog
~/.claude/skills/tighten   -> <repo>/globals/agents/skills/tighten
~/.claude/commands/blog.md -> <repo>/globals/claude/commands/blog.md
# Codex home (same selection)
~/.agents/skills/blog      -> <repo>/globals/agents/skills/blog
~/.agents/skills/tighten   -> <repo>/globals/agents/skills/tighten
~/.codex/commands/blog.md  -> <repo>/globals/codex/commands/blog.md
```

This keeps installed items live against repo source. It also means the install surface is now many
small links instead of one big link per category, so selection, verification, prune, and repair all
have to reason about item-level ownership.

**Both harnesses honor the same selection.** A skill or command exists in two install locations —
Claude reads `~/.claude/skills`, Codex scans `~/.agents/skills` (Codex never reads `.codex/skills`).
The per-item installer writes the chosen subset into *both* home trees, so a skipped item is absent
in Claude and Codex alike. This replaces today's whole-folder `agents:skills` link with per-item
links on the Codex side, matching the Claude layer (`globals/claude/skills/`) which is already
per-skill. Keeping the two harnesses aligned is a core repo goal; a subset honored in one harness but
not the other would be exactly the drift the repo exists to prevent.

MCP servers and permission profiles are **root-config-backed**, not folder-linked. Their selection
drives config-block writes or merge prompts in the same files that already hold mutable root config:
`~/.claude/settings.json` and `~/.codex/config.toml`.

**Ownership boundary with `link-skills.sh`.** `scripts/build/link-skills.sh` already manages
per-skill symlinks under `globals/claude/skills/` (the Claude per-skill layer) and the
`~/.agents/skills` link. The onboarding installer writes into the same user-facing paths
(`~/.claude/skills/*`, `~/.claude/commands/*`). To avoid two systems fighting over the same paths,
onboarding does **not** hand-roll `ln`: it calls the shared link helper (`ensureSymlink` /
`linkLocalSkills` in `cli/skill-lib.mjs`, and the bash `link_item`/`link_item_clean` in
`install-lib.sh`) so link creation, ownership detection, and prune stay in one code path. Onboarding
owns *which items* are selected; the link helper owns *how a link is created and verified*. See Open
Decisions if any path needs split ownership.

### Managed vs adopt semantics

Item-level onboarding must keep first-install ownership clear:

| Area | `managed` install state | `adopt` install state |
|---|---|---|
| Skills and slash commands | Symlink selected items individually into both the Claude home and the Codex home. Roborepo owns those links. Existing user-owned paths must be handled by the current conflict policy before replacement. | Same, only if the target path is missing or already roborepo-owned. If a user-owned folder/file exists, preserve it until the user explicitly adopts or overwrites. |
| Hooks, rules, markers, base guidance | Keep current clean repo symlink model from `manifest.tsv`. | Keep current behavior: clean non-root links can be installed; user-owned non-root conflicts stop before mutation. |
| Root config baselines | Export repo baseline to local active root config when missing, then item selections can update managed sections. | Do not silently rewrite existing root config. Stage selected MCP/permission changes, print merge prompt, or apply only under an explicit overwrite/merge policy. |
| Update | Refresh selected symlinked items if the repo source path still exists and the target is still owned by roborepo. Root-config-backed selected items may refresh only managed/generated sections. | Refresh selected symlinked items if their targets are roborepo-owned. Root-config-backed items require the adopt merge path again; update must not silently change user-owned root config. |
| Repair | Relink repo-owned manifest rows that point at the old checkout. Per-item symlinks point at repo source, so they do need relocation repair. | Same for any roborepo-owned links. User-owned root config remains untouched. |
| Uninstall | Remove roborepo-owned per-item symlinks and any generated state; leave local root config unless existing uninstall policy already preserves it. | Remove only roborepo-owned links/state; never delete user-owned root config. |

This means the manifest row model needs one new distinction. Current `link` rows assume
`home -> repo/src_rel` at whole-category granularity. Item-level categories need a second inventory
source or installer-side mapping that resolves to one target per item. Reusing the current
folder-link semantics unchanged would be misleading because the expected target is now a set of item
paths, not one directory.

Recommended implementation path:

- keep `manifest.tsv` at bundle-level for the shared harness rows that already exist
- resolve item-level filesystem-backed selections in installer code using the same link primitives
- only add a new manifest row kind if the manifest itself needs to express item inventory directly

Keeping `manifest.tsv` bundle-level has a portability payoff: the manifest has three readers —
`scripts/lib/manifests-data.sh` (bash), the PowerShell installer
`scripts/install/install-windows.ps1`, and the Node CLI. Resolving items in installer code means the
new item-level logic lands in the Node path only; the bash and PowerShell readers keep parsing the
same bundle-level rows they parse today, so they do not all need a new row kind. If a future change
adds an `item_link` kind to the manifest instead, all three readers must be updated together.

### Use Case Coverage

This plan should cover every setup path that matters:

| Use case | `managed` | `adopt` | Expected handling |
|---|---|---|---|
| Fresh install, filesystem-backed items only | Install selected skills/commands as item-level symlinks. | Same, if targets are clean. | No copies, no generated cache, no whole-folder link. |
| Fresh install, direct-write items selected | If the file is missing, export or write the repo baseline first, then apply selected MCP/permission settings. | If the file is missing, create it from the repo baseline. If user-owned, preserve it and stage or merge selected settings only by explicit policy. | Direct writes stay direct writes; symlinks are not involved. |
| Existing user-owned filesystem path | Replace only through the existing conflict policy. | Preserve until adopt/overwrite is chosen. | Do not silently move or merge the path. |
| Moving the repo checkout | Relink repo-owned filesystem items to the new source path. | Same. | Repair must handle moved checkout paths for item links. |
| Changing selection later | Add or remove only the selected items. | Same, but direct-write items still honor user-owned config ownership. | Update reconciles selection with current ownership state. |
| Uninstall | Remove only roborepo-owned links and managed files. | Remove only roborepo-owned links and state; keep user-owned config. | Never delete user-owned root config as part of uninstall. |

That matrix is the checklist for correctness. If a future implementation does not satisfy one of
those rows, the doc is not complete yet.

### Symlink tradeoffs

Per-item symlinks are the lower-invasive option, but they do introduce new rules:

- better: no generated cache, no timestamp refresh logic, no second copy of installed state
- better: repo edits show up immediately in the install when the linked source changes
- worse: install, prune, verification, and repair all become item-level instead of category-level
- worse: collisions are more granular, so a user-owned path can block one item without blocking the
  rest of the category
- worse: relocation repair still matters because each item path points back at the checkout
- worse: root-config-backed items still need direct-write or merge handling, so symlinks only solve
  part of the problem

Guardrail: do not use symlinks to pretend that `managed` and `adopt` are the same. They diverge
wherever the install writes directly into user-owned files.

### Onboarding UI: multi-step wizard

`roborepo onboard` becomes a sequence of steps, each a numbered multi-select checkbox screen:

1. **Toggle bundles** — base, rules, hooks, permissions, telemetry (whole on/off, as today).
2. **Skills** — checkbox per shared skill from the full inventory.
3. **Slash commands** — checkbox per command.
4. **MCP servers** — checkbox per MCP preset, with a note when the current install state requires
   staged/agent-assisted root-config merge instead of direct write.
5. **Review & submit** — summary of every selection; confirm to apply.

Navigation uses **numbered line input** (plain `ask()`, not raw-mode), for maximum terminal
portability across both harnesses and weaker Windows TTYs. Each step prints a numbered checkbox list;
the user types numbers to toggle, then a verb to move:

```
Step 2/5 — Skills (type numbers to toggle)
  1) [x] blog
  2) [ ] react
  3) [x] tighten
Enter=next, b=back, numbers to toggle:
```

Blank/Enter advances (**next**), `b` goes **back**, the final review step submits. Nothing is applied
until submit. This needs a new multi-select, multi-step helper in `prompts.mjs` built on the existing
`ask()` line-read (current `selectMenu` is single-select raw-mode and is not reused here).

### Update vs onboard

Per-item symlinks track repo source immediately, so `roborepo update` does not need a copy refresh
layer. Instead, update should re-evaluate the current selection, recreate missing links, and prune
links that no longer belong to the saved selection. It should never add brand-new repo items unless
the user selected them during onboard.

For each selected item, `update` resolves to exactly one outcome per home path:

- **present and correct** — link points at the expected repo source. Leave it alone (content edits
  show up live; no relink needed).
- **missing or pointing elsewhere (roborepo-owned)** — recreate/repoint the link to current source.
- **repo source gone, item still selected** — the repo deleted an item the user had chosen, so the
  link is now dangling. `update` **prunes the dangling link from both home trees, warns the user**
  (e.g. `react no longer ships; removed`), **and drops the item from the saved selection** so it does
  not re-dangle on the next run. This is the only case where `update` removes an item the user once
  selected, and it does so because the repo, not the user, removed it.
- **user-owned collision** — the path exists but holds the user's own content (they replaced or
  hand-edited the target). `update` must **not** auto-remove or overwrite it; it warns and preserves,
  per the existing conflict policy (`readInstallPolicy`). This is deliberately distinct from the
  dangling-prune case above: a dangling roborepo link is dead and gets pruned; user content is live
  and gets preserved.

`update` still never *adds* a brand-new repo item the user did not select — new items are opt-in via
`onboard`. And if a selected item *moves* inside the repo (rather than being deleted), the installer
needs the relocation story shared with `docs/plans/portable-install-relocation.md`.

This keeps `update` = "reconcile my accepted items with current repo source — repoint what moved,
prune what the repo deleted, preserve what the user owns" and `onboard` = "choose/add items", with no
hidden snapshot layer.

## Happy Path

1. User runs `roborepo onboard`.
2. Step 1: toggles bundles (base/rules/hooks/permissions/telemetry), presses next.
3. Step 2: checks `blog`, `tighten`; leaves `react` unchecked; presses next.
4. Step 3: checks the slash commands they want; presses next.
5. Step 4: checks `jcodemunch`, `jdocmunch`; presses next.
6. Step 5: reviews the summary; submits.
7. CLI resolves dependencies, writes selection to preset state, renders
   the selected skills/commands as per-item symlinks into the harness homes, and applies
   MCP/bundle selections according to the current install state.
8. Later, the repo ships a fix to `blog`, a brand-new skill `foo`, and **deletes** `tighten`. User
   runs `roborepo update`. For each selected item, update sees the symlinked source directly: `blog`
   now points at the new repo content automatically; `foo` was never selected, so it does **not**
   appear; `tighten`'s link is now dangling, so update prunes it from both home trees, warns, and
   drops `tighten` from the saved selection. To add `foo`, the user re-runs `roborepo onboard`.

## Required Rules

- Nothing installs until the user submits the final review step.
- Selecting an item must also pull its declared dependencies (extend `withDependencies()` to items).
- Per-item links must stay item-shaped. Do not symlink the entire folder when the user chose only a
  subset.
- Onboarding must create links through the shared link helper, never hand-rolled `ln`/`symlink`, so
  it does not collide with `link-skills.sh` over the same `~/.claude/skills/*` and
  `~/.claude/commands/*` paths. Onboarding decides *which* items; the helper decides *how* to link.
- The harness home path may contain a mix of symlinked items and directly written config files. The
  installer must track ownership per path, not assume one ownership model for the whole home tree.
- `managed` and `adopt` differ only where ownership differs: filesystem-backed items may be roborepo-
  owned in both states, but root-config-backed items must not silently mutate adopted root config.
- `roborepo update` reconciles the saved selection only; it never adds items the user did not select.
  The one removal it performs is pruning a dangling link whose repo source the repo itself deleted,
  dropping that item from the selection too.
- A dangling roborepo-owned link (dead source) is pruned; a user-owned path (live user content) is
  preserved. Never treat the two the same.
- Re-running onboard or update is idempotent — same selection against the same repo produces the same
  link set, with no dangling links left behind.
- Removing an item (unchecking on a later onboard run) removes its symlink or config entry from both
  home trees; collision and backup behavior follows the existing install policy (`readInstallPolicy`,
  `presets.mjs:466`).

## Operational Workflow

| Command | When | Gives the user | Does not do |
|---|---|---|---|
| `roborepo onboard` | First install; adding/removing items | Full multi-step item selection; writes selection + installs per-item symlinks; applies or stages root-config-backed choices according to install state | Not needed just to get fixes to already-selected filesystem-backed items |
| `roborepo update` | Picking up repo changes | Reconciles selected symlinks with current repo source; repoints moved links; prunes links the repo deleted (and deselects them); re-runs managed plumbing | Does not auto-add brand-new repo items; does not silently edit adopted root config; does not remove or overwrite user-owned content; does not touch present-correct links |
| `roborepo bundle apply/remove <id>` | Scripted/non-interactive | Apply or remove a whole bundle | No per-item granularity (bundle-level only) |

## Data Integrity And Validation

- **Before write:** resolve item dependencies; validate every selected item ID exists in the current
  full inventory (unknown ID → error, mirroring `resolveSelection` rejecting bad numbers,
  `presets.mjs:251`).
- **Verification:** `bundleApplied()` / `doctor` / `verify` assert that each selected item path
  exists and points at the expected repo source. A deeper optional check can assert the selected
  item set matches the saved selection.
- **State split:** install state (`managed`/`adopt`) remains separate from item selection state. The
  former answers "who owns root config and repo-owned links"; the latter answers "which shipped items
  did the user pick." Avoid deriving one from the other.
- **Collision handling:** a user-owned `~/.claude/skills`, `~/.claude/commands`, `~/.agents/skills`,
  or `~/.codex/commands` path must be treated like any other non-root harness conflict before it is
  replaced by an item symlink. Because each item installs into both home trees, a collision in one
  harness must not silently skip the other; handle each home path on its own. Do not silently move or
  merge arbitrary user content into a generated staging location; the install model here is direct.
- **Direct-write items:** `~/.claude/settings.json` and `~/.codex/config.toml` are not symlinked in
  either state. They are active local files. `managed` may export repo baselines into them; `adopt`
  must leave user-owned files in place unless the chosen conflict policy explicitly says otherwise.
- **Shared root files:** if a direct-write file contains both roborepo-owned and user-owned content,
  uninstall and update must only touch the roborepo-owned sections or blocks. Do not delete the whole
  file unless roborepo owns the whole file.
- **Not symlinked, not optional:** `permissions`, `mcp`, and any future root-config-backed choices
  require direct file writes or merges. Do not force them through the filesystem-backed symlink path.

No state migration is needed: this ships fresh. There is no legacy bundle-level item state to convert.

## Edge Cases

- **Item removed from repo (still selected).** A saved selection references a skill or command the
  repo no longer ships, leaving a dangling link. `update` prunes the dangling link from both home
  trees, warns the user, and drops the item from the saved selection so it does not re-dangle (see
  Update vs onboard). This is distinct from a user-owned collision, which is preserved, not pruned.
- **Source path moved.** If a selected item moves inside the repo, the direct symlink model needs an
  explicit relocation map or the install path becomes invalid. This is the main maintenance cost of
  item-level symlinks, and it should be cross-linked to [`portable-install-relocation.md`](portable-install-relocation.md).
- **User's own skills in the home folder.** Because the home path now receives item-level symlinks,
  a user who hand-added skills directly into `~/.claude/skills` would collide one item at a time.
  Collision policy must back up or preserve per existing rules — this is still the highest-risk
  interaction and needs explicit handling.
- **Adopted root config plus MCP selection.** A user can select MCP presets during onboarding while
  still being in `adopt` mode. The CLI must not write those blocks into user-owned config without an
  explicit merge/overwrite path. It should stage the generated candidate and print an agent prompt, or
  ask for a deliberate merge action.
- **Direct-write removal.** If the user later unselects an MCP or permission item, the installer must
  remove only the related block or setting, not wipe unrelated user content from the same file.
- **Managed root config later adopted.** If a user switches from managed behavior to adopted root
  config later, filesystem-backed active links can remain roborepo-owned, but root-config-backed
  selected items must stop auto-refreshing until the user approves a merge path.
- **Repo relocation.** Direct item symlinks point at the repo checkout, so moving the repo does break
  selected skills/commands until repair runs — this is a live hazard the copies model did not have.
  `repair` should relink repo-owned manifest rows; `update` should re-evaluate selections from the new
  checkout. This interacts directly with the existing relocation work in
  `docs/plans/portable-install-relocation.md`; item-level links must be covered by the same repair
  story, not a separate one.
- **Non-interactive / non-TTY.** Wizard needs a TTY. Non-TTY must fall back (error with guidance, or
  `bundle apply` for scripted use), consistent with current `maybeRunPresetOnboarding` behavior
  (`presets.mjs:25`).
- **MCP servers** are not symlinked; selection drives per-server config writes. Removing an MCP
  selection must remove its config block, not just skip it.
- **Windows path.** `install-windows.ps1` reads the manifest too. Any item-level link strategy has to
  be representable there, or the Bash and PowerShell installers will drift.

## Risk And Phased Rollout

This change touches the install spine — how config lands in the live harness dirs `~/.claude`,
`~/.codex`, and `~/.agents`. The whole-directory symlink (`~/.claude/skills -> repo/.../skills`) is
not just an install detail; it is an invariant that roughly fifteen scripts assume. Changing it to
per-item links means every reader of that invariant must change in lockstep or they disagree about
whether an install is healthy.

### Files that share the invariant

These read `manifest.tsv` / the install library / preset state and assume folder-level ownership:
`scripts/install/main.sh`, `install-claude.sh`, `install-codex.sh`, `install-lib.sh`,
`install-windows.ps1`, `repair.sh`, `uninstall.sh`, `scripts/lib/manifests-data.sh`,
`scripts/sync-from-home.sh`, `scripts/doctor.sh`, `scripts/verify-install.sh`,
`scripts/cli/presets.mjs`, `scripts/test/test-roborepo.sh`, `scripts/test/test-install-collisions.sh`.
Any one of them left on the old model becomes a source of false health readings or fights the new
installer over the same paths.

### Ranked risks

1. **Data loss in `~/.claude` / `~/.agents` (high).** The installer writes into live harness dirs. A
   bug in the roborepo-owned vs user-owned decision could delete or overwrite a skill or command the
   user created. The prune-vs-preserve rule (Update vs onboard) is exactly this boundary and is the
   easiest thing to get subtly wrong. Mitigation: route every link/remove through the existing,
   tested collision primitives (`link_item`, `ensureSymlink`) — never hand-roll `ln`/`rm`.
2. **Backfill pollutes the repo (high).** `sync-from-home.sh` reads live config and writes it back
   into repo source. If it does not understand per-item layout, it can corrupt
   `globals/agents/skills` itself — the source of truth. Recoverable via git, but it is the only
   risk that writes the repo. Mitigation: teach backfill the per-item model before enabling it, and
   test it against a throwaway home.
3. **Doctor / verify give false readings (medium).** They check whole-folder links today; until
   updated they fail a correctly-installed per-item layout. Not destructive, but it removes the
   safety net during the risky work. Mitigation: update them in the same phase that flips the model,
   not after.
4. **Half-migrated state (medium).** Node installer does per-item while bash/PowerShell still do
   whole-dir. Running `update` (Node) then an older script makes them fight over the same paths.
   Mitigation: keep `manifest.tsv` bundle-level (resolved decision) so only the Node path changes,
   shrinking the cross-language surface.
5. **Dangling links degrade the harness silently (medium).** A dangling `~/.claude/skills/<x>` — does
   the harness skip it or error? Untested. Mitigation: cover dangling-link behavior in tests before
   shipping (see Edge Cases / checklist item 11).

### Why this is less fragile than it looks

- The repo is under git, so the one repo-writing risk (backfill) is recoverable.
- Symlinks have no content state — a link resolves or dangles, with no merge logic — so the model is
  simpler to reason about than the copies alternative.
- The collision/backup primitives already exist and are tested; reusing them keeps the dangerous
  path on proven code.

### Phased rollout

Each phase is independently revertible, and the destructive capability (touching real harness dirs
with the new model) does not exist until Phase 2 — and only against throwaway homes until Phase 4.

- **Phase 1 — additive only, no install change.** Build inventory readers, catalog shape, state
  shape, and the wizard UI (checklist 1–5). `applySelection` still installs whole-dir as today, so
  the new selection experience is visible and testable without changing how anything installs. Fully
  reversible.
- **Phase 2 — per-item installer behind a flag, throwaway homes only.** Implement the per-item
  installer (checklist 6–7) gated behind an opt-in flag/env var, exercised only against the test
  suite's throwaway `$HOME` dirs. Never touches the developer's real `~/.claude`.
- **Phase 3 — spine parity.** Update `doctor.sh`, `verify-install.sh`, `install-windows.ps1`,
  `sync-from-home.sh`, `repair.sh`, `uninstall.sh`, and tests for the per-item model (checklist
  8–11). Prove green on throwaway homes before any default flips.
- **Phase 4 — flip the default.** Make per-item the default install for both harnesses (checklist
  10, 12) only after Phases 1–3 are green. Update docs last.

A phase does not begin until the previous one's checks pass. If a phase regresses, revert that phase
alone — earlier phases stand on their own.

## Implementation Checklist

1. **Inventory readers.** Add functions to enumerate the full inventory per category: skills (reuse
   `listSourceSkills` from `skill-lib`), commands (read `globals/{claude,codex}/commands/`), MCP
   (read `manifests/inventory/mcp-presets.json`).
2. **Catalog shape.** Extend `presets.json` (or a new inventory manifest) to declare which categories
   are item-level vs toggle, and to carry per-item entries with `id`, `label`, `description`, and
   optional `requires: [id, ...]`. Item deps live in this data, resolved by the extended
   `withDependencies()` — not hardcoded in installer code.
3. **State shape.** Extend preset state to store per-category item selections (no migration — fresh
   start, see Data Integrity). Current state is `{ selected: [...bundleIds], onboardedAt, updatedAt,
   bundles }`. Add an `items` map keyed by category, each holding canonical item IDs:

   ```json
   {
     "selected": ["base", "skills", "commands", "mcp"],
     "items": {
       "skills":   ["blog", "tighten"],
       "commands": ["blog"],
       "mcp":      ["jcodemunch", "jdocmunch"]
     },
     "onboardedAt": "2026-06-17T00:00:00Z",
     "updatedAt":   "2026-06-17T00:00:00Z",
     "bundles": { }
   }
   ```

   `selected` keeps toggle-bundle state; `items` holds per-category item selections. A category absent
   from `items` means nothing in it is selected.
4. **Wizard helper.** Add a multi-step, numbered multi-select helper to `prompts.mjs` built on
   `ask()` (toggle by number, blank/Enter = next, `b` = back, final submit). Keep `selectMenu` for
   single-select menus.
5. **Rewrite `presetsOnboard()`** to drive the wizard across the step sequence and write the new
   state.
6. **Per-item installer.** New module or extension: given a selection + full inventory, install
   selected items as symlinks into **both** home trees — Claude (`~/.claude/skills`,
   `~/.claude/commands`) and Codex (`~/.agents/skills`, `~/.codex/commands`). Reuse the existing
   collision primitives from `presets.mjs`/`install-lib.sh`; do not hand-roll `cp`/`ln`.
7. **Apply/remove path.** Update `applySelection`/`applyBundle`/`removeBundle` so filesystem-backed
   categories go through item-level link management, root-config-backed categories go through the
   managed/adopt merge path, and toggle bundles keep current behavior.
8. **`roborepo update` refresh.** Make `update` reconcile selected item links with current repo
   source; never add new items; leave unchanged selections alone unless the target moved or became
   invalid.
9. **Verification.** Update `bundleApplied`, `doctor.sh`, `verify-install.sh`, and
   `install-windows.ps1` for the item-level link model; keep the bash/Node skill-list parity guard
   intact. Verification should check item-level link ownership separately from repo-source link
   ownership.
10. **Manifest rows.** Per the resolved manifest strategy (Proposed Behavior), keep `manifest.tsv` at
    bundle-level: stop installing `claude:skills`, `claude:commands`, `codex:commands`, `agents:skills`
    as whole-repo-dir links, and route those categories through the item-level installer instead — for
    both home trees (the `agents:skills` whole-folder link becomes per-item links). Do **not** add a
    new `item_link` row kind unless the manifest itself must express item inventory — that would force
    matching updates in all three readers (`manifests-data.sh`, `install-windows.ps1`, Node CLI).
11. **Tests.** Extend `scripts/test/test-roborepo.sh`: per-item selection links only chosen items into
    both Claude and Codex homes; the same subset appears in both harnesses; update re-evaluates links
    and never adds unselected items; **repo-deleted selected item → update prunes the dangling link
    from both homes and drops it from the selection**; **user-owned collision → update preserves it,
    does not prune**; collision/backup of a user-populated home folder in either harness; managed vs
    adopt root-config-backed MCP behavior; repo relocation repair; non-TTY fallback. Update
    `test-install-collisions.sh` if the skills/commands collision path changes.
12. **Docs.** Update `README.md` (the onboarding code block + Global Behavior section), the
    setup/daily-use guide, and `docs/reference/services/roborepo.md` to describe the wizard, the
    item-level link model, the managed/adopt split, and update-vs-onboard reconciliation semantics.
13. **Tests and validation.** Add or update tests for each row in the use-case matrix above, then
    run the smallest repo-native verification that proves the touched behavior. Update docs any time
    the supported workflow changes, especially when adding a new package type, changing direct-write
    handling, changing the managed/adopt ownership split, or changing uninstall/relink behavior.

## Resolved Decisions

1. **Wizard navigation — numbered line input.** Sequential numbered-prompt steps built on the
    existing `ask()` line-read; type numbers to toggle, blank/Enter = next, `b` = back, final submit.
    Chosen for terminal portability across both harnesses and weaker Windows TTYs over a raw-mode
    stepper.
2. **Install model — symlinks.** The installed item set is a set of direct symlinks into repo
    source, not a generated copy cache.
3. **No legacy migration.** Ships fresh; no bundle-level item state to convert.
4. **Item-level categories — skills, slash commands, MCP servers.** Base, Codex rules, hooks,
    permission profiles, and telemetry stay whole on/off toggles.
5. **Update never auto-adds.** `roborepo update` refreshes only already-selected items. Brand-new
    repo items are opt-in via `roborepo onboard`.
6. **Both harnesses honor the selection.** Per-item skills/commands install into both the Claude home
    (`~/.claude`) and the Codex home (`~/.agents/skills`, `~/.codex/commands`) from one saved
    selection. The whole-folder `agents:skills` link is replaced by per-item links. No Claude-only
    first cut — a subset must look the same to both harnesses.

## Open Decisions

- **Forced refresh.** A future `update --force` could relink selected items unconditionally if the
  reconcile logic proves too conservative.

## Success Criteria

- `roborepo onboard` presents one step per item type, each with numbered individual checkboxes, with
  next/back navigation and a final submit; nothing applies until submit.
- A user can install a strict subset of skills/commands/MCP servers; unselected items are absent from
  both harness homes (Claude and Codex), so the two harnesses see the same selection.
- `roborepo update` re-links only selected items whose target is missing, dangling, or moved, and
  never adds unselected items.
- `doctor` and `verify` pass against the item-level link model with no weakening of their checks.
- `link-skills.sh` and the onboarding installer do not fight over the same item paths; ownership is
  explicit and documented.
- `scripts/test/test-roborepo.sh` covers per-item selection, symlink refresh/relink behavior,
  managed/adopt root-config behavior, and the user-populated-folder collision path.

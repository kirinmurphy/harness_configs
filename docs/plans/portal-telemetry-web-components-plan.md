---
id: portal-telemetry-web-components-plan
priority: none
next_action: Fill in the next concrete task.
blocked_by: []
depends_on: []
related: []
reviewed_commit:
---

# portal/telemetry/ Web Components + `<dialog>` Refactor

## Context

Second follow-up to `docs/plans/portal-web-components-dialog-plan.md` (the
`portal/plans/` refactor, proves the pattern) and
`docs/plans/portal-config-web-components-plan.md` (the `portal/config/`
refactor, second proof — file-split map, custom-element verdicts, CSS hoist
scope reasoning). This plan covers `portal/telemetry/` (currently one
1057-line `app.js`, no `elements/` dir, zero `customElements.define` calls,
`index.html` still uses div-based `.modal-back`/`.modal`, own inline
`<head>` not yet on `{{HEAD}}`) — confirmed directly by reading the current
files, not assumed from the handoff.

An earlier session already did some UI polish here (commit `656766f`):
`table()` and `renderInsights()` already use `<template>` + slot-fill via
shared `portalTpl`, and the `.item-err` rule is already the shared
base.css version (no local override to clean up, unlike config's fixed
bug). This plan does NOT redo that work — it starts from the current
1057-line file as read.

Telemetry is harder than both priors for two reasons called out in the
handoff, confirmed true after reading the file in full:

- **Real imperative canvas code.** `chartSetup`, `drawAxes`, `drawTimeline`,
  `drawDeltas`, `drawCumulative`, `drawCumulativeByGroup`, `barAt`,
  `onTimelineHover`, `onTimelineDown/Move/Up`, `panLoad`, `redrawChart` —
  ~430 lines of stateful drawing + drag/hover interaction over a shared
  mutable `chartBars`/`hoverIdx`/`panState` set. This is not "pure
  function" (it mutates canvas + reads live DOM/theme) and not "template
  fill" (nothing here clones a `<template>`) and not "orchestration"
  (it's the actual view, not wiring between layers). It gets its own file,
  `chart.js` — a new module category neither `plans/` nor `config/` needed.
- **Five modal entry points**, not two: `openModal` (generic key/value,
  called directly by `renderCauses`/`renderToolCost`), `closeModal`,
  `flaggedEventModal` (wraps `openModal`, adds chat-context actions — used
  by `renderSpikes`/`renderLoops`/`openSessionModal`), `openCaptureModal`
  (wraps `openModal`, chart-bar detail), `openSessionModal` (wraps
  `flaggedEventModal`, session detail). Unlike config's `openSource`/
  `openSnapshot` (two independent fetch-shapes), telemetry's five are a
  **layered stack**: `openModal` is the one true DOM-touching primitive;
  `flaggedEventModal`/`openCaptureModal`/`openSessionModal` are all
  callers that pre-shape a rows/actions payload and call it. The dialog
  controller therefore exposes ONE primitive (`open(title, sub, rows,
  opts)` + `close()`), not five methods — the three wrapper functions stay
  as plain functions (in app.js, since they orchestrate data shaping, not
  markup) that call the controller's `open`, mirroring how config's
  `applyBucket` stayed in app.js rather than api.js.

## Grounding facts (verified via direct reads)

- `portal/telemetry/app.js`: 1057 lines, single file, imports only from
  `/portal/shared/api.js` (`portalGetJson`, `portalPostJson`,
  `portalCopyText`, `portalSetUpdatedAt`, `portalHideLoading`, `portalTpl as
  tpl`). Zero `customElements.define`.
- `portal/telemetry/index.html`: own literal `<head>` (L3-21), byte-similar
  to plans'/config's pre-migration head (theme-flash guard + meta + two
  stylesheet links) — not yet swapped to `{{HEAD}}`. Modal markup at
  L224-233: `<div class="modal-back" id="modalback"><div class="modal"
  id="modal">...</div></div>`, no `role="dialog"`/`aria-modal` (telemetry
  never had that ARIA, unlike plans' pre-migration `#info-modal`).
  Three existing `<template>` defs already present: `tpl-stat`,
  `tpl-datatable`(+`-th`/`-row`/`-td`), `tpl-insight`.
- `scripts/cli/portal-server.mjs`: `renderHead(page)` and `PAGES` already
  generic — telemetry is already a registered page (`{ path: "/telemetry",
  id: "telemetry", title: "Telemetry", dir: "telemetry" }`). No server
  change needed for `{{HEAD}}` adoption, confirmed by reading the file —
  purely an `index.html` edit swapping the literal `<head>...</head>` for
  the `{{HEAD}}` marker line, exactly as plans/config already did.
- `portal/telemetry/styles.css`: 103 lines. `.modal-back`/`.modal-back.open`
  /`.modal`/`.modal h3`/`.modal .sub`/`.modal dl`/`.modal dt`/`.modal dd`/
  `.modal .closebtn`/`.modalactions`/`.modalactions button`/`.modalextra`
  (+ `.turn`/`.th`/`.tool`/`.prev`/`.note` children) at L84-102 — all dead
  after the `<dialog>` migration, same cleanup shape as config's `.modal-
  backdrop` deletion. `.panel` rule at L10 already byte-identical to
  config's post-hoist shared version (confirmed: `background:var(--panel);
  border:1px solid var(--line); border-radius:8px; padding:16px;`) — this
  is telemetry's own now-redundant copy the config plan flagged as "stays
  until telemetry's own follow-up removes it explicitly." Removing it here
  is in scope (see CSS section).
- Zero cross-page/cross-file references into telemetry's internals
  (`grep` confirmed) — safe to restructure without touching other pages.
- Established discipline from both priors carries forward unchanged: every
  structural step gets its own isolated Playwright verification against a
  real `roborepo serve` instance, none batched. A real bug (plans' `dtdd()`
  spread-on-non-array) was only caught this way, not by code reading.

## File split

Six files, not five — canvas work doesn't fit the `state/api/templates/
panels/app` shape cleanly, so it gets its own module instead of being
force-fit into one of the existing four (per the handoff's explicit
instruction not to force it into a bucket it doesn't belong in).

**state.js** (pure, no DOM): `fmt`, `short`, `esc`, `tokShort`,
`clockLabel`, `pointGroup`, `perSessionSeries`, `durLabel`, `clip`,
`SESSION_COLORS`, `GROUP_COLORS`, `M` (chart margins — a shared constant
between state and chart, lives here since it's data not drawing),
`sessionById(id, sessions)` (becomes a pure lookup taking `sessions` as a
param instead of closing over module-global `allSessions` — matches how
config's `snapshotChanged` was extracted to take `prevSignature`/`snap` as
params rather than reading module globals).

**api.js**: `fetchAnalysis(qs)` (was `load()`'s inline
`portalGetJson("/api/data"+qs)`), `fetchSession({id, harness, finding,
repo})` (was `fetchSession`'s inline GET — querystring-building moves in),
`fetchInsightsLlm()` (was `runDeepRead`'s inline GET), `fetchTelemetryState()`
(was `refreshTelemetryState`'s inline GET `/api/config`), `enableTelemetry()`
(was the enable-button handler's inline POST). `copyText`'s
`portalCopyText` passthrough is NOT wrapped — it's a one-line re-export
with no added shape, same call-site-owns-it precedent as plans' `copyText`.

**chart.js** — new module, the imperative canvas layer. Owns: `chartBars`,
`hoverIdx`, `chartMode`, `showAllDeltas`, `legendShown`, `panState`,
`panLoadTimer`, `theme`/`refreshTheme`/`cssVar`, `chartSetup`, `drawAxes`,
`drawTimeline`, `drawDeltas`, `drawCumulative`, `drawCumulativeByGroup`,
`barAt`, `onTimelineHover`, `onTimelineDown`, `onTimelineMove`,
`onTimelineUp`, `panLoad`, `updatePanHint`. Exposes a small controller —
`createChart({ onBarClick, onSessionClick, getSessionById })` returning
`{ redraw(points, threshold, cumulativeConcern), setMode(mode),
toggleShowAll(), viewMore(mode) }` — so app.js drives it without reaching
into its internals, same "controller, not a grab-bag of exports" shape as
`panels.js`'s factories in both priors. Click-to-open-detail
(`onTimelineUp`'s dispatch to `openSessionModal`/`openCaptureModal`) is
the one seam that must stay app.js-owned logic — chart.js takes callbacks
(`onBarClick`, `onSessionClick`) rather than importing the modal directly,
mirroring how `templates.js` never imports the modal in the config plan
(callback bags, not direct imports, keep the dependency direction one-way:
app.js wires chart.js to panels.js, chart.js never reaches sideways into
panels.js itself).

**templates.js**: `statItem` (already template-based, moves as-is),
`table()`'s DOM-construction half (already template-based) — moves with
its `tableDetails` registry, since that registry is intrinsic to how the
delegated click-handler resolves row callbacks, not app.js orchestration.
`renderInsights`'s template-fill body moves; the `container.innerHTML = ""`
+ loop stays paired with the fill logic (matches how plans/templates.js
keeps a template function responsible for fully populating its own
container). Gains `insightRow(f)` as the per-row factory (currently inlined
in the `renderInsights` loop) for symmetry with plans'/config's
one-function-per-repeated-unit convention — this is a template split, not
a behavior change; `renderInsights` itself becomes a two-line loop in
app.js calling `tmpl.insightRow` per item, same shape as plans' `group()`
mapping `card()`.

**panels.js**: `createDetailModal()` — the dialog controller. Wraps
`#modal` → `<dialog>`. Exposes `{ open(title, sub, rows, opts), close() }`
— ONE primitive, per the layered-stack reasoning above. Owns the
Escape-is-native / backdrop-click-identity-check / close-button wiring,
same mechanics as `createConfigModal`. Does NOT expose `openSource`/
`openSnapshot`-shaped methods — telemetry has no fetch-vs-known-data split
like config's two entry points; every telemetry entry point already has
its data in hand before calling in (`renderCauses` has its row data,
`openCaptureModal` has its point, `openSessionModal` has its session
record) so there is only one `open()` shape needed, never a fetch-then-show
variant at the controller level (the one fetch that DOES happen —
`fetchSession` for chat-context — happens as a follow-up action button
inside an already-open modal, not as the open path itself, which is why it
stays modeled as `opts.actions[].onClick`, unchanged from today).

**app.js**: `renderMeta`, `wipeSections`, `setLoading`, `load`,
`updateHarnessFilter`, `openModal`/`flaggedEventModal`/`openCaptureModal`/
`openSessionModal` (the three wrapper functions + the one call into
`modal.open`/`modal.close` — these orchestrate data shaping across
state.js lookups and the modal controller, that's wiring, not markup or
pure logic), `fetchSession`, `copyText`, `renderCauses`/`renderSessions`/
`renderSpikes`/`renderContrib`/`renderGroupCost`/`renderToolCost`/
`renderAnatomy`/`renderPackageCost`/`renderRegression`/`renderLoops`/
`renderComparison`/`runDeepRead` (all orchestration: fetch-shape-into-
table-or-modal-call, matching how config's `renderSection`/
`renderPermissionsSection` stayed in app.js as "decide which component to
instantiate" wiring), delegated click listener, range/chartmode button
listeners, `refreshTelemetryState`, poll bootstrap, resize/themechange
listeners.

## `<dialog>` migration for `#modal`

Same mechanics as both priors: `.modal-back`/`.modal` div-nest collapses to
one `<dialog id="telemetry-modal">` (renamed from bare `#modal` to match
config's `#config-modal` naming convention — `id="modal"` was already a
slightly generic name and telemetry is the last of three pages to migrate,
so aligning the id naming now avoids being the one outlier). `showModal()`/
`close()` replace `classList.add/remove("open")`. Manual Escape listener
(`window.addEventListener("keydown", ...)` at L1013) deleted entirely
(native `<dialog>` Escape). Backdrop-click listener (L1012) retargeted from
`id === "modalback"` to `event.target === dialogEl` identity check, same
pattern as config. `#modaltitle`/`#modalsub`/`#modalbody`/`#modalactions`/
`#modalextra` carry over unchanged — content structure inside the panel is
independent of container tag, per both priors' precedent.

```css
dialog#telemetry-modal {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 20px 22px;
  max-width: 560px;
  width: 90%;
  max-height: 80vh;
  overflow: auto;
  box-shadow: 0 12px 48px var(--modal-shadow);
}
dialog#telemetry-modal::backdrop {
  background: var(--backdrop);
}
```
`.modal-back`/`.modal-back.open` deleted from `telemetry/styles.css` —
dead after migration, same cleanup as config's `.modal-backdrop` deletion.

## Custom element inventory

Same test as both priors: does it own real behavior beyond "filled
template," and is it an N-instance/declaratively-authored unit rather than
a page singleton driven imperatively?

- **No candidates clear the bar.** Walked every repeated visual unit in
  telemetry against the test:
  - `statItem()` — one-shot template fill, no owned behavior. Stays a
    function (matches plans' explicit non-candidates list).
  - Table rows (`tpl-datatable-row`/`-td`) — built by the shared `table()`
    function, no per-row owned behavior (click handling is delegated at
    the document level, not owned per-row). Stays a function.
  - `insightRow` (was inline in `renderInsights`) — one-shot fill, no
    listener, no state. Stays a function.
  - Session chips in the cumulative-chart legend (`.sesschip` buttons,
    built as raw HTML strings inside `drawCumulative`'s legend build) —
    tempting since they're N-instance and clickable, but they're generated
    as part of a `legend.innerHTML = "..."` string build tied directly to
    canvas redraw timing (rebuilt every `redrawChart()` call, must stay
    synchronized with `chartBars` hit-test state which is NOT itself
    componentizable). Converting just the chip to a custom element while
    its container stays a raw innerHTML string owned by chart.js buys
    nothing — the click is already handled by one delegated listener in
    app.js, and the chip has no independent lifecycle apart from the
    chart's own redraw cycle. Stays as-is (string-built, inside chart.js).
  - The modal itself — page singleton, imperatively driven from many call
    sites, never cloned. Same disqualifier as config's `#modal` — panel
    factory (`createDetailModal`), not a custom element, per the identical
    reasoning already established.
  - The telemetry-off prompt (`#telemetryoff`) — single static section,
    toggled via `style.display`, no repetition, no N-instance shape. Not a
    candidate, wasn't one in either prior page either (plans/config have
    no equivalent element).

  This is a legitimate outcome, not a gap: both prior plans state the
  candidates are "not assumed to be the same three as plans" / re-derived
  per page — telemetry's actual repeated structures (stat items, table
  rows, insight rows) are all one-shot fills matching the "do NOT
  componentize" list from the plans plan, and its one stateful interactive
  surface (the chart) is a canvas, which custom elements don't help with
  (a `<canvas>`-wrapping element would just be a thin proxy around
  chart.js's existing controller, adding a registration + instantiation
  site for zero behavior gain — same trap plans' plan warned against for
  one-shot template fills, applied here to a would-be canvas wrapper).

## Portal-wide CSS: what's in scope here vs. already done vs. deferred

Both priors left explicit deferred items pointing at telemetry as the
final decision point (modal-chrome class names, pill/badge components,
text-link buttons) since hoisting needed telemetry's actual final shape.
Now that telemetry's own migration is happening, re-examine each:

| Item | Action |
|---|---|
| **`.panel` duplicate rule** (telemetry/styles.css:10, byte-identical to base.css's post-config-hoist version) | **Delete telemetry's local copy now.** Config's hoist already put the shared rule in base.css; telemetry inherits it unchanged. Verify visually — same "resolved by observation" discipline as config's `.item-err` fix. |
| **Modal-chrome class names** (`.modal-head`/`.modal-close`/`.modal-body` in config vs. telemetry's own `#modaltitle`/`#modalsub`/`#modalbody`/`.modalactions`/`.modalextra` — structurally different: config uses classes for a fixed 3-part head, telemetry uses ids for a title/sub/body/actions/extra 5-part shape with an additional "extra" region config has no equivalent of) | **Do not hoist.** Confirmed real structural difference, not just a naming mismatch — telemetry's modal has a 5th region (`modalextra`, used for chat-context turns) neither prior page has. Forcing a shared shape now would mean inventing a generalized modal-chrome contract for a feature (extra region) only one page needs. Leave as page-owned CSS in all three pages; revisit only if a 4th page needs the same shape. |
| **Pill/badge components** (config's `.badge*`/`.drift-chip`, plans' `.chip`/`.filter-chip`, telemetry's `.sesschip`/`.spike`) | **Do not hoist.** Telemetry's `.sesschip` (chart legend chip) and `.spike` (table cell color flag) are shaped for their own contexts (chart legend sizing, table cell inline color) — three pages now checked, still no clean structural overlap beyond "small rounded/colored inline element," too thin a commonality to generalize without guessing a shape that doesn't fit any of the three concretely. |
| **Text-link buttons** (config's `.reset-link`/`.text-link`, telemetry's `.linkbtn`, plans has none) | **Do not hoist.** `.linkbtn` (telemetry: underline-dotted, no border, used for inline actions like the delta-filter toggle and copy buttons) vs `.text-link` (config: grid-cell link styling) remain visually and structurally distinct on inspection. Same call as the pill/badge line — three-page check complete, no hoist. |

Deferred items from the config plan are now resolved (not "deferred
again") — the CSS section above is the terminal decision, not another
punt, since telemetry was the last page needed to make the call.

`{{HEAD}}` partial adoption for telemetry is in-scope in this same effort
— trivial, server mechanism already generic (confirmed above).

## Migration sequencing

Each step isolated, verified via real `roborepo serve` + headless
Playwright before the next, none batched — same discipline as both priors,
explicitly called out in the handoff as what caught real bugs before.

1. **File split** (state/api/templates/panels/chart/app), no behavior
   change — mechanical extraction. This is the biggest single step of the
   three plans (six files, ~1057 lines, canvas state threading) — verify
   thoroughly: page loads, meta stats render, chart renders in all three
   modes (cumulative/bygroup/deltas), hover tooltip works, drag-to-pan
   works (with a finite range selected), every table renders
   (causes/sessions/spikes/tools/mcp/groupcost/toolcost/anatomy/
   packagecost/regression/comparison/loops), harness filter renders when
   >1 harness present, deep-read button fires, telemetry-off prompt logic
   unaffected — zero regressions before touching structure further. This
   is the step most likely to surface a `dtdd()`-style bug (module-global
   state like `chartBars`/`allTimeline`/`allSessions` moving across file
   boundaries is exactly the class of change that bug came from).
2. **`.panel` duplicate-rule deletion** — tiny, isolated. Verify every
   `.panel`-classed section renders unchanged in both themes.
3. **`{{HEAD}}` partial** — independent, can land anytime. Verify title/
   stylesheet/no-flash/token-still-injected on hard refresh both themes;
   confirm plans/config completely unaffected (already migrated, this
   step only touches telemetry's index.html + nothing server-side new).
4. **`<dialog>` for `#modal` → `#telemetry-modal`**, alongside old markup
   first, not removed until proven. Verify **all entry points** exercised
   in one pass: `openModal` via a causes-row click and a toolcost-row
   click (the two direct callers), `flaggedEventModal` via a spikes-row
   click and a loops-row click, `openCaptureModal` via a deltas-mode chart
   bar click, `openSessionModal` via both a sessions-table row click AND a
   cumulative-chart session-chip click (two different entry paths to the
   same function — both must work identically). `::backdrop` both themes,
   Escape, backdrop-click, inside-click no-close, actions region
   populates/clears correctly across different callers (no stale buttons
   bleeding from a prior open), `modalextra` clears between opens (the
   region a plain `openModal` call leaves empty but `flaggedEventModal`
   populates with action buttons — confirm no leftover content when
   swapping between an `openModal`-only row and a `flaggedEventModal` row
   in the same session), no console errors. Then delete old markup/CSS/JS
   (`.modal-back` styles, the manual Escape listener, `id==="modalback"`
   check).

No custom-element steps — none clear the bar (see inventory above), so
sequencing ends at step 4, one fewer step than both priors.

## Verification

Same Playwright-against-real-server pattern established by both priors:

- `roborepo serve`, `page.goto("/telemetry")`, wait for `#page-loading` to
  clear.
- `console`/`pageerror` captured every step, standard not exceptional.
- `request`/`response` captured for step 1 (poll timing / duplicate fetch
  risk when module-global state like `lastVersion` moves across files) and
  step 4 (chat-context fetch inside an open modal, must not double-fire).
- Assert real DOM state post-interaction (e.g. the actual rendered stat
  values in `#meta`, not "a handler ran"; actual `<dialog>` `open` property
  and content, not just "click didn't throw").
- Toggle `data-theme` dark/light mid-script for the chart-render checks
  (canvas colors resolve from CSS vars, per the existing `refreshTheme`
  comment) and for step 4's dialog checks.
- **Chart-mode matrix** (step 1): script all three modes
  (cumulative/bygroup/deltas) with at least one finite time range selected
  (to exercise pan) and with "all time" selected (pan disabled, click-to-
  detail still works) — this combination (mode × range) is telemetry's own
  risk surface neither prior page had.
- **Five-entry-point modal check** (step 4): script all five paths listed
  above in one pass, confirm no stale footer/actions/extra content bleeds
  between them — mirrors config's two-entry-point check, scaled to five.
- **Drag-to-pan check** (step 1 and again lightly at step 4, since pan
  triggers a modal-adjacent redraw path): simulate a mousedown/mousemove/
  mouseup drag sequence on the canvas with a finite range selected, verify
  `view.panEnd` updates and the panel refetches (via request listener),
  verify a genuine click (no movement) still opens detail and a drag does
  NOT.
- Each step's script isolated before the next; one final full-pass
  regression script after all 4 steps land, covering: page load, all
  chart modes, pan, hover tooltip, all five modal entry points, harness
  filter, range buttons, deep-read, telemetry-off toggle-on flow (if
  telemetry happens to be off in the dev environment; otherwise verify the
  prompt's hidden state renders correctly when telemetry is on).

## Explicitly out of scope this pass

No custom elements this pass — every candidate was walked against the
same behavior-ownership test used by both priors and none cleared it (see
inventory section); this is a considered outcome specific to telemetry's
actual shape, not a shortcut. Do not hoist modal-chrome names, pill/badge
components, or text-link buttons — three-page comparison now complete,
real structural differences found each time, terminal decision not a
further punt. Do not touch `plans/` or `config/` (both already migrated,
zero changes needed here). Do not add `attributeChangedCallback`/
`observedAttributes` (moot — no elements added). Do not cache
`renderHead()`'s per-request read (matches existing no-cache pattern,
same as both priors). Do not attempt to componentize the canvas or wrap it
in a custom element — chart.js's controller-object shape is the correct
unit of encapsulation for this code, not a custom element (see inventory
section's chart-wrapper reasoning).

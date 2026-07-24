---
id: portal-web-components-dialog-plan
priority: high
next_action: Fill in the next concrete task.
blocked_by: []
depends_on: []
related: []
reviewed_commit:
---

# Native `<dialog>` + Web Components for portal/plans

## Context

`portal/plans/` was split earlier from one 702-line `app.js` into `state.js`
(pure filter/sort logic), `api.js` (fetch wrappers), `templates.js` (DOM
construction), `panels.js` (two controller factories), `app.js` (wiring).
Still too much manual DOM-building in `templates.js` (`fill(tpl(...))` +
`querySelector` wiring), still too many lines in `app.js` and `index.html`.
This plan adopts native custom elements (light DOM, no shadow DOM) and native
`<dialog>` as a frameworkless path forward, scoped to `portal/plans/` only —
proving the pattern before propagating it to `portal/config/` and
`portal/telemetry/` (explicit follow-up, not part of this plan).

Also folds in a DRY pass across all three portal pages. Two concrete
instances were found — the `<head>` boilerplate (identical across all 3
pages except `<title>` and stylesheet href, confirmed byte-for-byte via diff)
and three divergent modal/backdrop conventions (`hidden` attribute in plans
vs `.open` class-toggle in config/telemetry, three different backdrop class
names). Both are addressed by this plan: head dedup via a small server-side
partial-include, modal unification via `<dialog>` for `#info-modal` (the
pattern config/telemetry will copy in their follow-up).

## Grounding facts (verified via jcodemunch + direct reads)

- `pageHtml(dir, token)` in `scripts/cli/portal-server.mjs` (L34-36) is the
  only server-side HTML composition point: one `fs.readFileSync` + one
  `.replace("</head>", ...)` per request, no caching anywhere in the file,
  `Cache-Control: no-store` on every response.
- `portal/plans/index.html` (277 lines): `<head>` (L3-20), `#info-modal`
  (L120-168, `.modal-backdrop`/`.modal-panel`, `hidden` attribute, already has
  a controller in `panels.js`'s `createInfoModal()` with Escape/backdrop-click
  wired), `#drawer` (L169-195, `.drawer-backdrop`/`.drawer-panel`, `hidden`
  attribute, **no controller** — opened/closed inline in `app.js`, zero
  Escape/backdrop-click handling today — a real asymmetric gap), 10
  `<template id="tpl-*">` defs (L196-273).
- `templates.js`'s `card()` and `actionButton()` are the two functions that
  own real behavior (not just markup) today — `actionButton()` wraps clicks in
  try/catch with async-error delegation to `onError`.
- CSS: `--backdrop`/`--modal-shadow` defined once in `portal/shared/base.css`
  for dark/light themes, already shared. `.modal-panel` is a centered card
  (`width: min(560px,100%)`); `.drawer-panel` is a full-height right-aligned
  panel (`justify-content: flex-end`, `height: 100vh`) — structurally
  different layouts, matters for the `<dialog>` decision below.
- Zero existing `customElements.define` anywhere in the repo — green field.
- A real bug (`...dtdd()` spread on a single Node, not an array) was only
  caught by driving the app in a real browser via Playwright, not by reading
  code — every step below gets an isolated real-browser check, not batched
  changes verified by inspection.

## Plan

### 1. Custom elements — three, not ten

Promote only units that own behavior (a listener, internal state, async
error handling) beyond "filled template." Everything else stays a plain
template function in `templates.js`.

- **`<plan-card>`** replaces `card()`. Properties (not attributes — record is
  a full nested object): `.record`, `.actions` (existing `cardActions` shape).
  Builds chip row + action-button row internally via the existing
  `tpl-plan-card` template + `portalTpl()`/`portalFillSlots()` — same
  template-cloning code, wrapped in a behavior-owning class instead of a
  function.
- **`<action-button>`** replaces `actionButton()`. `label` as a plain string
  attribute; `.onClick`/`.onError` as properties (functions aren't
  attribute-serializable). Owns the try/catch + promise-catch wrapper that's
  today duplicated inline.
- **`<filter-chip>`** replaces `filterChip()`. `filter-id`/`label`/`value` as
  string attributes (all always strings here, good attribute candidate).
  Remove-button click dispatches `CustomEvent("chip-remove", { detail: id,
  bubbles: true })` — replaces `app.js`'s delegated closest-match click
  handler on `filterChipsEl` with one listener for `chip-remove`.

**Do NOT componentize**: `rootChip()`, `chip()`, `selectOption()`, `group()`,
`emptyState()`, `warningLine()`, `listItem()`, `spinner()`, `packageBanner()`,
`dtdd()`, `drawerTaskItems()` — all one-shot template fills with no owned
behavior. Converting these adds a class + registration + instantiation site
for what's already a two-line function call. This is the main trap to avoid:
not every repeated visual pattern needs to be a component.

No shared base class / mixin across the three elements in this pass — only
three components, no real shared behavior beyond `extends HTMLElement`
itself; premature abstraction. No `attributeChangedCallback`/
`observedAttributes` — the app's re-render model is always "replace the whole
node," never "mutate one attribute on a live instance."

### 2. `<dialog>` for `#info-modal`; `#drawer` stays a plain custom element

`#info-modal` → native `<dialog>`. It's a centered card over a dimmed
background — exactly `<dialog>`'s designed use case. `showModal()` centers it
via UA default (`margin: auto`), gives a real `::backdrop` pseudo-element,
traps focus, closes on Escape — all for free. Delete `.modal-backdrop`'s
manual flex-centering, delete the manual Escape/backdrop-click listeners in
`createInfoModal()` (or delete `createInfoModal()` outright if what's left is
just two lines — decide once written), delete `role="dialog"
aria-modal="true"` (redundant with native `<dialog>` semantics).

```css
dialog#info-modal {
  width: min(560px, 100%);
  max-height: 85vh;
  overflow: auto;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 12px 40px var(--modal-shadow);
  padding: 18px;
}
dialog#info-modal::backdrop {
  background: var(--backdrop);
}
```
`.modal-head`/`.modal-body`/`.folder-tree`/`.tree-*`/`.modal-note` carry over
unchanged — they style content inside the panel regardless of container tag.

`#drawer` does **not** become `<dialog>`. It's a full-height side panel, not
a centered dialog — forcing `showModal()`'s auto-centering/top-layer
assumptions onto it means immediately fighting the UA stylesheet
(`inset: auto; right: 0` overrides etc.) for no real gain over a plain
element implementing the same ~10 lines of Escape/backdrop-click handling
that `createInfoModal()` already proves out. Becomes `<plan-drawer>`: a
custom element wrapping the existing `.drawer-backdrop`/`.drawer-panel`
markup, with `.open(content)`/`.close()` methods and the Escape/backdrop-click
handling it's currently missing entirely (the real, existing asymmetric gap).

### 3. Server-side `<head>` partial (no build step)

New file `portal/shared/head-partial.html`:
```html
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>roborepo {{TITLE}}</title>
  <script>
    (function () {
      try {
        var t = localStorage.getItem("roborepo-theme");
        document.documentElement.dataset.theme = t === "light" ? "light" : "dark";
      } catch (e) {
        document.documentElement.dataset.theme = "dark";
      }
    })();
  </script>
  <link rel="stylesheet" href="/portal/shared/base.css" />
  <link rel="stylesheet" href="{{STYLE_HREF}}" />
</head>
```
`portal/plans/index.html`'s `<head>...</head>` shrinks to a single `{{HEAD}}`
marker line. `pageHtml()` in `portal-server.mjs` gains one helper:
```js
const HEAD_PARTIAL = path.join(PORTAL_DIR, "shared", "head-partial.html");
const PAGE_TITLES = { config: "config", plans: "plans", telemetry: "telemetry" };

function renderHead(dir) {
  return fs.readFileSync(HEAD_PARTIAL, "utf8")
    .replace("{{TITLE}}", PAGE_TITLES[dir])
    .replace("{{STYLE_HREF}}", `/portal/${dir}/styles.css`);
}

const pageHtml = (dir, token) => fs.readFileSync(path.join(PORTAL_DIR, dir, "index.html"), "utf8")
  .replace("{{HEAD}}", renderHead(dir))
  .replace("</head>", `<meta name="roborepo-portal-token" content="${token}" />\n`
    + `<script>window.ROBOREPO_PORTAL = ${JSON.stringify({ token, pages: pageManifest() })};</script>\n</head>`);
```
`{{HEAD}}` resolves first and produces the literal `</head>` string the
existing token-injection replace already matches — no ordering conflict, zero
change to token-injection logic. Still no caching, no build step, no new
dependency, one extra synchronous `readFileSync` per request (negligible,
matches existing per-request-read pattern used everywhere else in this file).

Scoped to `plans/` only in this pass — `config`/`telemetry` pick up
`{{HEAD}}` in their own follow-up (trivial once the mechanism exists).

### 4. Registration, file layout

Each element is a standalone ES module whose only side effect is
`customElements.define(...)` at top level. Safe with no build step: fresh
page load = fresh empty registry every time, no collision risk.

```
portal/plans/elements/
  action-button.js   — class ActionButtonElement, defines "action-button"
  filter-chip.js      — class FilterChipElement, defines "filter-chip"
  plan-card.js         — class PlanCardElement, defines "plan-card" (imports action-button.js — cards embed action buttons)
  plan-drawer.js         — class PlanDrawerElement, defines "plan-drawer"
  index.js                 — barrel: imports all four, for registration
```
`index.html` gains one script tag before the existing two:
```html
<script src="/portal/plans/elements/index.js" type="module"></script>
<script src="/portal/shared/theme.js" type="module"></script>
<script src="/portal/plans/app.js" type="module"></script>
```
`templates.js` keeps everything not listed as componentized, and gains thin
factory wrappers preserving today's "returns a Node" contract:
```js
export function planCardElement(record, cardActions) {
  const node = document.createElement("plan-card");
  node.record = record;
  node.actions = cardActions;
  return node;
}
```
Call sites change minimally: `group()`'s `plans.map((record) => card(record,
cardActions))` becomes `plans.map((record) => tmpl.planCardElement(record,
cardActions))` — one-line diff, no change to surrounding orchestration in
`app.js`.

`panels.js`: `createRootsPanel` untouched. `createInfoModal` shrinks to a
`showModal()`/`close()` wrapper or gets deleted if what's left doesn't
justify the module (decide once written).

`app.js`: drawer calls move from `drawer.hidden = false/true` to
`drawerEl.open(content)` / `drawerEl.close()`.

### 5. Migration sequencing — each step independently verified in a real browser, none batched

1. **`<dialog>` for `#info-modal`**, built alongside the existing markup
   first (don't remove old until new is proven). Verify: opens via icon
   click, `::backdrop` dims correctly in both themes, Escape closes, backdrop
   click closes, inside-click doesn't close, no console errors. Then remove
   old markup/CSS/JS.
2. **`<action-button>`**, swapped into `actionButton()`'s existing signature
   (`actionButton(label, onClick, onError)` unchanged, body changes). Verify
   every button that goes through it (card actions, drawer actions) still
   fires and still surfaces errors via `onError`.
3. **`<filter-chip>`**, touches `templates.js` + `app.js` (delegated handler
   → `chip-remove` event listener). Verify chip render, removal, no leaked/
   duplicate listeners across repeated open/close of the filters panel.
4. **`<plan-card>`** — biggest step, last among elements since it embeds
   `<action-button>`. Verify full render (title/path/chips/next-action/meta),
   every action button on the card, Open still opens the drawer correctly,
   chip state coloring (warn/ok) for high-priority/blocked/stale plans.
5. **`<plan-drawer>`** — the asymmetric-gap fix. Verify metadata/warnings/
   tasks/markdown/actions all still populate correctly (this is exactly where
   the earlier `dtdd()` bug lived — check with extra care), confirm Escape
   and backdrop-click now genuinely close it (new capability, not a false
   positive), repeated open/close cycles don't leak.
6. **`{{HEAD}}` partial** — independent of 1-5, can land anytime. Verify
   correct title/stylesheet per page, no flash-of-unstyled-theme on hard
   refresh in both themes, portal token still injected (confirm a mutating
   action like adding a discovery root still works), `/config` and
   `/telemetry` completely unaffected (untouched in this pass).

Steps 2-3 may be done back-to-back in one session if step 1 lands cleanly,
but verified as separate Playwright passes each, not one combined check.
Steps 4-5 must not be batched with each other or anything else.

## Verification

Real running server + headless Playwright:

- `roborepo serve`, `page.goto()` the plans page, wait for `#page-loading`
  to clear.
- Assert real post-interaction DOM state (e.g. drawer's actual title text
  after Open, not just "a handler ran").
- Capture `page.on("console")`/`page.on("pageerror")` on every step — this is
  how the `dtdd()` bug was found originally; treat it as standard, not
  exceptional.
- Capture `page.on("request")`/`page.on("response")` for steps touching
  `api.js` calls, to catch unexpected duplicate/failed requests from a
  custom element re-render.
- Toggle `data-theme` dark/light mid-script for the `<dialog>` step, since
  `--backdrop`/`--modal-shadow` differ by theme.
- Run each step's script in isolation before the next step. One final
  full-pass script (every migrated piece, once) after all 6 steps land, as a
  regression net — additive to, not a replacement for, per-step checks.

## Explicitly out of scope this pass

`portal/config/` and `portal/telemetry/` — not touched, not even for the
`{{HEAD}}` partial, despite it being a trivial extra diff once the mechanism
exists. Plans-first proves the pattern; config/telemetry follow-up applies
the same `state/api/templates/panels` split they're missing today, then the
same `<dialog>` treatment for their `#modal`/`#modalback` (both closer to
"info-modal" than "drawer" shape), then re-derives whatever custom elements
their own repeated patterns actually warrant — not assumed to be the same
three as plans.

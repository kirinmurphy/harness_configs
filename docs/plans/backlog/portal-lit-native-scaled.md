---
id: portal-lit-native-scaled-plan
priority: low
next_action: Fill in the next concrete task.
blocked_by: []
depends_on: []
related: []
reviewed_commit:
---

# Scaling the Portal with Native Web Components and Lit

## Status

Proposed

## Purpose

The RoboRepo portal has grown beyond a collection of static pages, but it does not yet require a
React single-page application or a Vite runtime workflow. The current portal already has a useful
frameworkless architecture built around native HTML templates, custom elements, ES modules,
server-computed view models, JSON APIs, and a local Node HTTP server.

The next scaling problem is narrower: the portal now uses several overlapping DOM construction
patterns, and its custom elements require increasing amounts of manual lifecycle, property,
rendering, and event-listener code. Page styles are also becoming difficult to compose and reuse.

This plan proposes:

- retaining the current multi-page, no-runtime-build architecture
- standardizing the existing native HTML, JavaScript, and CSS foundation
- piloting Lit as a declarative layer for existing web components
- keeping Lit adoption incremental and reversible
- separating the component decision from the Tailwind decision
- optionally using Tailwind CLI as contributor/release tooling while shipping ready-to-serve CSS
- preserving the existing server APIs, loopback security, package distribution, and CLI workflow

This plan supersedes `docs/plans/archived/portal-react-vite-scaled-plan.md` as the recommended next portal
scaling step. React and Vite remain a possible future destination if the portal later develops
requirements that Lit and the native platform do not address well.

## Decision Summary

Use the existing Node loopback server and multi-page routing model. Normalize the frameworkless
foundation first, then migrate selected custom elements to Lit using light DOM. Do not introduce a
client router, React, TypeScript compilation, or a required frontend build at this stage.

Treat CSS as a separate decision:

1. First establish CSS layers, design tokens, selector conventions, and a small utility layer.
2. Evaluate whether that resolves the styling problems.
3. If Tailwind is still desirable, use its CLI during development and release, commit or package
   the generated CSS, and keep installed portal operation build-free.

## Goals

- Reduce manual DOM and custom-element lifecycle boilerplate.
- Establish one preferred component rendering model.
- Make shared UI behavior easier to reuse across Config, Plans, and Telemetry.
- Prevent page-specific conventions from drifting further apart.
- Improve CSS composition without coupling the portal to React or Vite.
- Preserve direct browser loading, readable source, and platform-native debugging.
- Keep `roborepo serve` dependency-light and independent from a frontend development server.
- Preserve the current server-owned data models and mutation security.
- Add browser-level tests around the interactions most vulnerable to rendering regressions.
- Create explicit criteria for deciding whether Lit is successful.

## Non-Goals

- Converting the portal into a single-page application.
- Adding client-side routing.
- Moving server-owned computation into the browser.
- Rewriting all existing pages at once.
- Requiring users to run a frontend build after installing RoboRepo.
- Requiring a CDN or internet connection when the portal runs.
- Adopting Shadow DOM everywhere.
- Adding TypeScript solely as part of the Lit pilot.
- Redesigning the portal while changing its component architecture.
- Removing the React/Vite plan as a documented future alternative.

## Current Architecture

### Runtime

- `roborepo serve` starts the existing Node loopback server.
- The server binds to `127.0.0.1`.
- Config, Plans, and Telemetry are separate HTML pages.
- The server injects the portal manifest and per-process mutation token.
- Read APIs return JSON.
- POST requests enforce loopback-origin and mutation-token checks.
- Portal assets are served directly from `portal/`.
- The npm package ships the portal source required at runtime.

### Browser organization

Each page generally separates:

- `api.js`: page-specific API calls
- `state.js`: constants, filtering, matching, and other pure state logic
- `templates.js`: DOM construction
- `panels.js` or `modals.js`: dialog and panel controllers
- `app.js`: orchestration and event wiring
- `styles.css`: page presentation
- `index.html`: static structure and native templates

Shared behavior includes:

- portal API helpers
- mutation-token handling
- theme and navigation
- loading and updated-at state
- template cloning and slot filling
- modal backdrop behavior
- skill source presentation
- shared base styling and design variables

### Existing custom elements

The portal already includes custom elements such as:

- `config-item`
- `config-toggle`
- `bucket-control`
- `plan-card`
- `plan-drawer`
- `filter-chip`
- `action-button`

These elements demonstrate that web components are already an architectural direction rather than
a hypothetical replacement.

## Problems To Solve

### Multiple rendering conventions

The portal currently mixes:

- native `<template>` cloning
- `data-slot` lookup and replacement
- imperative `document.createElement()` helpers
- HTML string insertion for shared chrome
- custom-element property assignment
- page-owned manual rendering functions
- direct `querySelector()` and listener registration

Each technique is valid, but their combination makes it unclear which pattern should be used for a
new component. That ambiguity is a primary source of implementation drift.

### Manual custom-element reactivity

Existing elements must coordinate `connectedCallback()`, property setters, connection state,
required property availability, rerender timing, and event listener recreation. This machinery is
repeated and easy to implement inconsistently.

### Markup split across files

A single component's behavior can be distributed across:

- an HTML `<template>` in `index.html`
- a component class under `elements/`
- a function in `templates.js`
- page or shared CSS
- callbacks created in `app.js`

This makes components harder to scan, move, and test in isolation.

### CSS ownership and naming

Shared styles, page styles, and element styles use global selectors. As the portal grows, developers
must decide whether a class is a component API, a page-specific style, a JavaScript hook, or a
temporary implementation detail.

Semantic class names remain useful for stable components, but requiring a new semantic name for
every small layout choice makes routine styling slow and encourages one-off CSS.

### Limited browser interaction coverage

The existing tests strongly cover the CLI, server startup, API behavior, token enforcement, and
basic JavaScript syntax. They do not provide enough protection against browser-only failures such
as missing listeners, broken template IDs, incorrect rerenders, dialog behavior, or state loss.

## Target Architecture

```text
Node loopback server
  ├── server-owned snapshots and mutations
  ├── native multi-page routes
  └── directly served portal assets

Portal pages
  ├── shared native shell
  ├── plain JavaScript state and API modules
  ├── Lit custom elements for stateful/repeated UI
  ├── native HTML for static page landmarks
  ├── light DOM during initial migration
  └── layered global CSS or generated Tailwind CSS
```

The server remains the source of truth for:

- local file access
- configuration and package mutation
- permission behavior models
- telemetry analysis
- plans scanning and prompt generation
- portal manifest generation
- mutation-token generation and validation

The browser remains responsible for:

- page layout and navigation
- page-local state
- filters and sorting
- declarative component rendering
- dialogs, drawers, controls, tables, and charts
- loading, empty, success, and error states
- polling or refreshing server snapshots

## Proposed Source Layout

Retain the current page-first structure and add an explicit component layer:

```text
portal/
  shared/
    api.js
    theme.js
    head-partial.html
    components/
      portal-shell.js
      portal-modal.js
      status-line.js
    styles/
      tokens.css
      reset.css
      base.css
      components.css
      utilities.css
    vendor/
      lit.js
  config/
    api.js
    app.js
    state.js
    components/
      config-item.js
      config-toggle.js
      bucket-control.js
    index.html
    styles.css
  plans/
    api.js
    app.js
    state.js
    components/
      plan-card.js
      plan-drawer.js
      filter-chip.js
      action-button.js
    index.html
    styles.css
  telemetry/
    api.js
    app.js
    state.js
    chart.js
    components/
      telemetry-table.js
      telemetry-detail.js
    index.html
    styles.css
```

This layout is a direction rather than a mandatory preliminary move. Files should move only when
the relevant component is migrated or shared.

## Component Ownership Rules

### Use native HTML for

- document landmarks
- primarily static page structure
- accessible forms that do not repeat
- content that the server can provide directly
- one-off structures whose behavior is simple and local

### Use Lit custom elements for

- repeated records such as config items and plan cards
- controls with internal state or asynchronous behavior
- UI that rerenders when properties change
- reusable dialogs, drawers, toggles, chips, and status displays
- components currently requiring template cloning plus substantial listener wiring

### Keep plain JavaScript modules for

- API clients
- pure filtering and transformation functions
- snapshot comparison
- orchestration between server calls and components
- canvas drawing and other imperative browser APIs

### Avoid components that only rename one HTML element

A custom element should own meaningful rendering, behavior, state, accessibility, or reuse. Do not
wrap a native button or `div` solely to create a different tag name.

## Lit Integration Strategy

### Initial rendering mode

Lit components should initially render into light DOM rather than their default Shadow DOM:

```js
createRenderRoot() {
  return this;
}
```

This preserves:

- current global styles
- portal theme variables
- existing page selectors
- straightforward browser inspection
- compatibility with a future global utility stylesheet
- incremental migration without restyling every component

Shadow DOM can be adopted later for components that benefit from strict encapsulation. That should
be an explicit per-component decision rather than the portal default during migration.

### Property and event conventions

- Server records and action collections should be passed as JavaScript properties.
- Primitive public configuration may use attributes where it improves authoring or accessibility.
- Components should dispatch standard or documented custom events upward for user actions.
- Parent modules should not reach into component internals to attach listeners to rendered nodes.
- Components should not mutate server-owned records.
- Async mutations should return to an authoritative server snapshot before updating durable UI.

Prefer an event interface such as:

```text
<config-toggle>
  emits: config-toggle-change
  detail: { itemId, enabled }
```

over passing many unrelated callbacks into deeply nested elements. Direct callback properties may
remain appropriate for tightly local elements during migration, but one convention should be used
consistently within each component family.

### Template conventions

- Component markup should live in the component's Lit `render()` method.
- Lit templates should remain declarative and avoid hidden side effects.
- Data transformation should happen in pure functions before rendering when it is non-trivial.
- Do not recreate server-owned view-model logic in components.
- Use keyed or repeat-aware rendering where list identity matters.
- Keep imperative code only for browser APIs that require it, such as canvas drawing and focus.

### Lit distribution without a runtime build

The portal must not load Lit from a remote CDN at runtime. RoboRepo must remain usable offline after
installation.

The initial pilot should use a pinned, browser-ready Lit ESM artifact under `portal/shared/vendor/`.
Document:

- upstream package and version
- integrity or checksum
- the command used to refresh the vendored artifact
- the Lit license and required notices
- the validation command used after an upgrade

The vendor file must be included in `npm pack` output.

If maintaining the vendored module becomes cumbersome, a later release-only bundling step may
replace it. That decision must not make `roborepo serve` invoke a frontend compiler.

## CSS Architecture

### Establish explicit layers

Create a stable cascade order:

```css
@layer reset, tokens, base, components, utilities, pages;
```

Responsibilities:

- `reset`: normalization and box sizing
- `tokens`: colors, spacing, typography, radii, borders, shadows, and z-index values
- `base`: document and native-element defaults
- `components`: shared portal component styles
- `utilities`: small compositional layout and presentation helpers
- `pages`: Config, Plans, and Telemetry-specific rules

Page stylesheets should declare their rules inside `@layer pages`.

### Selector conventions

- Classes control styling.
- `data-*` attributes identify JavaScript behavior and test targets.
- IDs are reserved for unique landmarks, form associations, and dialog accessibility.
- Custom-element tag selectors may provide host layout but should not become a substitute for a
  documented component style API.
- State should use native attributes where possible: `hidden`, `disabled`, `open`, `aria-expanded`.
- Use explicit `data-state` or `data-variant` attributes for component-specific visual states.

Avoid depending on style-oriented class names as JavaScript selectors. This allows CSS refactors
without silently breaking behavior.

### Design tokens

Consolidate repeated values into shared custom properties:

- foreground and background roles
- muted and emphasized text
- success, warning, danger, and informational states
- border and panel roles
- spacing scale
- type scale and line heights
- radii
- shadows
- control heights
- content widths

Theme differences should override semantic color tokens rather than component selectors.

### Native utility layer

Introduce a deliberately small set of utilities for recurring composition needs:

- display and layout
- alignment and wrapping
- gaps
- common padding and margins
- visually hidden content
- muted text
- width constraints
- overflow handling

Do not attempt to reproduce all of Tailwind. Add a utility only after a repeated need appears.

## Optional Tailwind Track

Tailwind is independent from Lit. Lit does not require Tailwind, and Tailwind does not require
React or Vite.

After the native CSS cleanup, evaluate whether developers still experience significant friction
from one-off layout classes and stylesheet growth. If so, add Tailwind CLI as authoring tooling.

### Tailwind operating model

```text
portal/shared/styles/tailwind-input.css
  -> contributor or release command
  -> portal/shared/tailwind.css
  -> shipped npm package
  -> directly served by roborepo serve
```

Rules:

- Do not use Tailwind's browser CDN in the shipped portal.
- Do not run Tailwind when `roborepo serve` starts.
- Do not require package users to build CSS.
- Pin the Tailwind version.
- Include generated CSS in package validation.
- Add a stale-output check if both source and generated CSS are committed.
- Keep semantic component classes for complex components and accessibility-relevant states.
- Use utilities primarily for composition and local layout.

### Tailwind decision criteria

Adopt the CLI only if it materially improves at least two of:

- speed of implementing page layouts
- consistency of spacing and responsive behavior
- removal of one-use CSS declarations
- ease of reviewing markup and styles together
- confidence when moving components between pages

Reject or defer it if generated output, class-heavy templates, or synchronization checks create
more maintenance than the utility layer removes.

## Shared Shell

The current server-generated page manifest and head partial should remain. They avoid duplicating
page metadata and keep routing server-owned.

Replace HTML-string construction in `portal/shared/theme.js` with either:

- a shared Lit `portal-shell` component, or
- server-composed native HTML if the shell remains effectively static

The chosen shell must continue to provide:

- navigation from the server-owned page manifest
- active-page state including the `/config` alias
- theme initialization without a flash
- theme persistence
- updated-at status
- first-load state
- shared footer controls

Do not introduce client-side routing merely to share the shell.

## State And Data Flow

Retain the existing server-authoritative flow:

```text
server snapshot
  -> page API module
  -> page state and pure selectors
  -> Lit/native render
  -> user event
  -> POST with mutation token
  -> authoritative server response
  -> rerender
```

Guidelines:

- Keep Config's `behaviorView` computed once on the server.
- Keep plan discovery and prompt generation on the server.
- Keep telemetry parsing and expensive analysis on the server.
- Keep page filters and presentation-only state in the browser.
- Do not add a global store until state is genuinely shared across simultaneously mounted page
  regions.
- Prefer immutable snapshot replacement to scattered object mutation.
- Preserve transient interface state, such as expanded groups and filters, across snapshot renders.

## API Client

Retain the existing shared API layer and page-specific wrappers. Normalize it before considering a
larger client abstraction.

The shared layer should own:

- portal bootstrap access
- JSON parsing
- consistent error normalization
- mutation-token headers
- clipboard handling
- optional request cancellation or timeout behavior

Page API modules should expose domain operations rather than raw paths.

JSDoc typedefs may be added for API payloads and component properties. If stronger editor checking
is useful, enable JavaScript type checking with `// @ts-check` or a repository `jsconfig.json`
without requiring source compilation.

## Migration Strategy

### Phase 0: Baseline and guardrails

- Record the current portal routes, interactions, and package contents.
- Add browser smoke coverage before changing rendering architecture.
- Add stable `data-testid` or behavior-oriented `data-*` selectors where tests need them.
- Document the current server snapshot and mutation contracts.
- Identify all current rendering paths and assign each one a target pattern.
- Establish bundle/package size baselines.

Minimum browser coverage:

- direct loading of `/`, `/config`, `/plans`, and `/telemetry`
- global navigation and active state
- theme persistence
- Config source modal
- Config toggle mutation
- Config permission bucket mutation
- Plans filtering
- Plans drawer open and close
- Plans copy actions
- Telemetry initial render
- Telemetry theme-driven chart redraw
- loading and error states

### Phase 1: Normalize native CSS and selectors

- Introduce CSS layers and consolidate theme/design tokens.
- Move shared component rules to a clear shared stylesheet location.
- Add a minimal native utility layer.
- Replace style-class JavaScript selectors with `data-*` hooks.
- Reserve IDs for unique landmarks and accessibility relationships.
- Remove duplicated selectors only when visual parity is verified.
- Do not perform a broad redesign in this phase.

Deliverable: the existing portal still uses its current rendering code but has a clearer styling
and selector contract.

### Phase 2: Vendor Lit and establish conventions

- Add a pinned browser-ready Lit module under `portal/shared/vendor/`.
- Document its source, version, checksum, license, and update procedure.
- Add a minimal example component used only in development or tests.
- Confirm direct browser imports work through `roborepo serve`.
- Confirm the npm package contains every required vendor asset.
- Add component conventions to the portal architecture documentation.

Do not migrate a major page until packaging, offline loading, and browser tests pass.

### Phase 3: Plan Card pilot

Migrate the Plans card family first:

- `plan-card`
- `action-button`
- card chips if they warrant a component

Why this pilot:

- it is repeated many times
- it accepts a clear record and action interface
- it contains conditional lists and buttons
- it is isolated from the page's primary state ownership
- it exercises the exact template/listener boilerplate Lit should reduce

Keep the component in light DOM. Preserve its markup, CSS, accessibility, and user-visible behavior.

Evaluate:

- source lines and conceptual complexity
- amount of manual DOM lookup
- event interface clarity
- rerender correctness
- testing ergonomics
- browser debugging quality
- whether action state survives async operations correctly

Gate: continue only if the Lit implementation is clearly easier to maintain than the original.

### Phase 4: Config component family

If the pilot succeeds, migrate:

- `config-item`
- `config-toggle`
- `bucket-control`

Preserve server-owned `behaviorView` rendering. Do not move permission or active-state computation
into the elements.

Validate:

- immutable and mutable rows
- inspectable source labels
- external information links
- badges and optional descriptions
- async toggle status
- permission reset behavior
- deny-to-looser confirmation
- authoritative post-mutation rerendering

### Phase 5: Shared overlays and shell

Evaluate modal and drawer duplication after the first component migrations. Extract only patterns
that have stable shared behavior.

Candidates:

- `portal-modal`
- `status-line`
- `portal-shell`
- a shared source viewer

Use native `<dialog>` inside modal components. Preserve focus behavior, accessible labels, Escape
handling, and backdrop closing.

### Phase 6: Plans page composition

Migrate repeated and stateful Plans controls where Lit reduces complexity:

- filter chips
- filter summary
- lifecycle groups
- plan drawer
- package banner
- discovery-root controls

Keep filtering and facet-count functions in `state.js`. Components receive prepared data and emit
events; they should not own duplicate filtering algorithms.

### Phase 7: Telemetry selectively

Telemetry should migrate last because it combines tables, dialogs, polling, and imperative canvas
rendering.

- Keep the current chart drawing code imperative initially.
- Wrap the canvas only if a component improves lifecycle handling.
- Redraw after relevant property, size, or theme changes.
- Migrate repeated tables and detail panels before chart internals.
- Keep telemetry analysis server-side.

Do not adopt a chart library merely because Lit is introduced.

### Phase 8: Remove obsolete rendering helpers

After all consumers are migrated:

- remove unused page `<template>` blocks
- remove unused `portalTpl()` and `portalFillSlots()` functionality
- remove component-specific imperative DOM builders
- consolidate element registration
- remove obsolete CSS selectors
- update architecture and contributor documentation

Helpers still useful for non-component native rendering may remain. Completion does not require
eliminating every imperative DOM operation.

### Phase 9: Tailwind evaluation

Run the Tailwind decision separately after CSS layers and at least one Lit component family are in
normal use.

- Prototype Tailwind CLI on one bounded page or component family.
- Compare it with the native utility layer.
- Measure source clarity and generated output.
- Verify light-DOM component compatibility.
- Decide whether to adopt Tailwind, retain native utilities, or use a hybrid.

Do not block Lit migration on this decision.

## Testing Strategy

### Unit tests

Continue testing pure state and transformation functions without the browser where practical:

- plan filtering and facet counts
- snapshot-change detection
- display-model transformation
- telemetry aggregation inputs
- option and label derivation

### Component tests

Test Lit components in a real browser environment. Cover:

- property updates trigger the expected render
- conditional content appears and disappears
- lists update without stale nodes
- events contain the documented detail
- disabled and pending states prevent duplicate actions
- accessible labels and native states remain correct
- errors become visible without destroying usable state

Avoid tests that assert Lit implementation details or full serialized markup when behavioral
assertions are sufficient.

### End-to-end browser tests

Add one browser tool with a narrow configuration. The tests should start the real loopback server
and exercise shipped assets.

Cover:

- all portal routes by direct navigation
- page navigation
- mutation-token-backed interactions
- dialogs and drawers
- filters and persisted page state
- polling or refresh rerenders
- clipboard actions where browser permissions permit
- dark and light themes
- representative loading, empty, and error states

### Existing server and package tests

Preserve tests for:

- loopback-only binding
- cross-origin POST rejection
- missing-token POST rejection
- portal status
- JavaScript syntax
- package dry-run contents
- installed-package server startup

## Accessibility Requirements

- Continue using native controls before custom equivalents.
- Keep native `<dialog>` for modal behavior.
- Every custom interactive element must expose an accessible name and keyboard behavior.
- Custom controls must preserve focus visibility.
- Do not use a clickable `div` where a button or link is appropriate.
- Use `aria-expanded`, `aria-controls`, `aria-current`, and live regions where applicable.
- Verify focus restoration after dialogs and drawers close.
- Ensure pending and error states are not communicated by color alone.
- Include keyboard-only browser tests for primary navigation and overlays.

## Performance Requirements

The portal is local, but performance still affects startup and interaction quality.

- Avoid remote runtime dependencies.
- Keep the Lit vendor payload pinned and measured.
- Do not rerender an entire page for isolated transient state when component-level updates suffice.
- Continue doing expensive plan and telemetry analysis server-side.
- Avoid introducing a global state library.
- Preserve current polling intervals unless measurements justify changes.
- Consider pausing polling when the document is hidden.
- Keep chart rendering responsive during filters and theme changes.

Record before and after:

- shipped portal asset size
- first-page JavaScript transferred
- first render time in a representative local environment
- Config snapshot rerender duration
- Plans render duration with a representative large plan collection
- Telemetry redraw duration

## Security Requirements

This migration must not change the portal's trust model.

- Continue binding only to loopback.
- Continue validating loopback origins for POST requests.
- Continue requiring the per-process mutation token.
- Do not place local absolute paths or sensitive server state into generic component attributes.
- Continue using text bindings for untrusted strings.
- Sanitize any rendered Markdown or server-produced HTML at its current trust boundary.
- Do not load Lit, Tailwind, fonts, scripts, or other runtime assets from a CDN.
- Restrict any new dependency-serving route to explicit known assets.
- Preserve path traversal protection in the asset server.

Lit templates escape text expressions by default, but this does not make explicitly inserted HTML
safe. Any unsafe-HTML mechanism requires a documented sanitation boundary and dedicated tests.

## Packaging And Runtime Rules

- Published packages must open the portal without running a frontend build.
- `portal/` remains included in the npm package.
- Vendored Lit assets must be present in `npm pack --dry-run` output.
- If Tailwind is adopted, generated CSS must be present in the package.
- Contributor build tooling must remain development-only.
- Installed operation must not depend on Vite, a Tailwind watcher, a CDN, or `node_modules` paths
  that are not guaranteed by the package.
- Node runtime support remains aligned with the repository's existing engine floor.
- The server must continue serving standard HTML, CSS, and JavaScript assets directly.

## Documentation Updates

Update portal documentation to include:

- when to use native HTML, Lit, or plain JavaScript
- light DOM as the initial default and how exceptions are approved
- component property and event conventions
- CSS layer ownership
- styling selector versus behavior selector rules
- design-token naming
- Lit vendor upgrade procedure
- optional Tailwind generation and stale-output checks
- how to add a page without adding a client route
- browser test expectations for new components

Document the relationship to the React/Vite plan:

- this plan is the current recommended scaling path
- React/Vite remains an escalation option
- server APIs and security boundaries are intentionally compatible with either frontend

## Validation Checklist

### Runtime

- `roborepo serve` starts without a frontend compiler.
- `/`, `/config`, `/plans`, and `/telemetry` load through direct navigation.
- The portal works without internet access.
- Navigation and theme behavior remain consistent across pages.
- Browser console contains no missing-module or custom-element errors.

### Config

- Generated-file source inspection works.
- Package, skill, hook, and command toggles work.
- Permission bucket changes work.
- Reset and confirmation behavior works.
- Polling rerenders from authoritative snapshots without losing relevant transient state.

### Plans

- Discovery-root management works.
- Filters and facet counts work.
- Cards and lifecycle groups render correctly.
- Drawer open and close behavior works.
- Copy path, context, and prompt actions work.
- Package enablement works.

### Telemetry

- Dashboard data loads.
- Disabled-state enablement works.
- Filters and detail views work.
- Charts redraw after data and theme changes.
- Large reports remain responsive.

### Security and packaging

- POST without a portal token fails.
- Cross-origin POST fails.
- Portal remains loopback-only.
- Package dry-run includes Lit and any generated CSS.
- A packed installation opens the portal without source-generation steps.
- No runtime asset references an external CDN.

## Rollback

Every Lit migration should retain a straightforward rollback until its component tests and page
parity checks pass.

- Migrate one component family at a time.
- Keep the prior native template implementation until the new component passes validation.
- Do not change server API contracts merely to accommodate Lit.
- Reverting a component must not require changing package state, user configuration, telemetry
  data, or plan documents.
- If vendored Lit causes packaging or compatibility problems, restore the prior custom elements and
  remove the vendor asset.
- CSS layer changes should be committed separately enough to revert without reverting component
  logic.

## Decision Gates

### Continue Lit adoption when

- component code is easier to understand and change
- manual DOM lookup and listener wiring decrease materially
- property updates and async states are more reliable
- tests are easier to write and less brittle
- packaging remains simple and offline
- developers can debug rendered output without specialized tooling

### Stop or limit Lit adoption when

- component source becomes more abstract without reducing behavior code
- light-DOM and global-style interactions become difficult to reason about
- the vendor/update process becomes fragile
- most page logic remains imperative despite Lit
- browser tests reveal lifecycle problems not present in the existing elements

Lit does not need to own the entire portal to be successful. It may remain the standard only for
repeated, stateful components.

### Escalate to React/Vite when

At least several of these become persistent requirements:

- application-wide client state shared across routes
- complex client-side route nesting and transitions
- a strong need for a React-only component or visualization ecosystem
- large forms requiring mature form libraries
- frontend staffing or contribution patterns strongly standardized on React
- TypeScript and bundling are already required for other portal needs
- Lit/native patterns demonstrably fail to control page-level composition complexity
- build-output management is accepted as a normal release responsibility

React should be chosen because those requirements exist, not simply because the portal has grown.

## Open Decisions

- What exact browser-ready Lit artifact should be vendored?
- Should the vendor refresh be a repository script or a documented manual command?
- Which browser test runner best fits the existing Node and shell test environment?
- Should the shared shell become a Lit component or remain server-composed HTML?
- Should custom component actions use callbacks, custom events, or a documented mixture?
- Which existing components genuinely benefit from Shadow DOM later?
- Is the native CSS utility layer sufficient, or should Tailwind CLI be adopted?
- If Tailwind output is committed, what stale-output check should run in CI and package validation?
- Should JSDoc checking be enabled globally or introduced module by module?

## Success Criteria

- RoboRepo retains a directly served, offline-capable local portal.
- `roborepo serve` requires no frontend build or development server.
- New stateful and repeated UI has one documented component pattern.
- Lit removes substantial manual lifecycle, rendering, and event wiring from migrated components.
- Static page structure continues to use idiomatic native HTML.
- Server-owned view models and mutation contracts remain stable.
- CSS has clear token, component, utility, and page ownership.
- JavaScript behavior no longer depends on presentation class names.
- Browser tests protect the primary Config, Plans, and Telemetry interactions.
- Published packages include every required runtime asset.
- The architecture can still move to React/Vite later without rewriting server APIs or security
  boundaries.

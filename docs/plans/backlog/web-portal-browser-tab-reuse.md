---
id: web-portal-browser-tab-reuse
priority: low
next_action: Investigate macOS browser-specific tab reuse options for roborepo web.
blocked_by: []
depends_on: []
related:
  - roborepo-cli-surface-implementation-plan
reviewed_commit:
---

# Web Portal Browser Tab Reuse

## Summary

Investigate whether `roborepo web` can reuse or reload an existing local portal browser tab instead
of opening duplicate tabs. This is future low-priority work; the current portal opener should remain
simple and reliable until the browser-specific behavior is proven.

## Context

The portal opener currently lives in `scripts/cli/telemetry.mjs` as `openLocalUrl(url)`. It delegates
to the platform opener: `open` on macOS, `cmd /c start` on Windows, and `xdg-open` elsewhere.

That behavior is portable, but plain `open` cannot reliably find an existing tab across browsers.
Tab reuse likely requires browser-specific automation on macOS.

## Goals

- Reuse or reload an existing `http://127.0.0.1:<port>` portal tab when practical on macOS.
- Support common macOS browsers only after confirming script behavior.
- Preserve the existing opener as the fallback for unsupported browsers and failed automation.
- Keep Linux and Windows behavior unchanged unless a reliable native approach is later identified.

## Non-goals

- Do not add a general browser automation framework.
- Do not make portal startup depend on AppleScript success.
- Do not change unrelated URL-opening behavior.

## Current State

- `serveCommand()` calls `openLocalUrl()` when `roborepo web` or detached portal startup should open
  the portal.
- `openLocalUrl()` shells out to the platform opener and does not inspect existing browser tabs.

## Proposed Design

Add an optional macOS-only opener path ahead of the current `open` fallback:

1. Detect macOS and a supported browser candidate.
2. Ask that browser, via AppleScript, whether a tab already points at the local portal origin.
3. If found, focus and reload that tab.
4. If not found, open the URL normally.
5. On any script error, fall back to the existing `openLocalUrl()` behavior.

The implementation should keep the browser-specific code isolated from the portable opener so
Linux and Windows keep the current behavior.

## Validation

- Manually smoke-test `node scripts/cli/main.mjs web --detach` on macOS with at least one supported
  browser and one unsupported/default fallback.
- Confirm an existing portal tab is reused or reloaded when possible.
- Confirm a fresh tab/window still opens when no matching tab exists.
- Run `node scripts/test/cli-command-catalog-check.mjs`.
- Run `node scripts/test/cli-surface-integration-check.mjs`.

## Risks

- AppleScript may trigger browser automation permission prompts.
- Browser AppleScript dictionaries differ and may drift.
- Default-browser detection may not map cleanly to a scriptable browser.
- Over-eager tab matching could focus the wrong local development tab.

#!/usr/bin/env node
// Portal routing manifest check (docs/plans/active/portal-onboarding-home.md).
//
// Phase 1 of portal-onboarding-home: `/` is a dedicated Home page, Agents is canonical at
// `/config`, and PAGES order defines the global nav (Home, Agents, Plans, Tokens, Localhost).
// This check pins the manifest invariants that a future routing refactor could silently break:
// canonical paths, exactly one default page, and the nav order that theme.js renders from
// window.ROBOREPO_PORTAL.
//
// Importing PAGES from portal-server.mjs also runs validateRouteTables() at module load, so an
// invalid route table fails loudly here even before any browser assertion.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES } from "../../scripts/cli/portal-server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

// Canonical page map from the plan: order is the nav order, and each route is unique (no alias).
const EXPECTED = [
  { path: "/", id: "home", title: "Home", dir: "home", default: true },
  { path: "/config", id: "config", title: "Agents", dir: "config" },
  { path: "/plans", id: "plans", title: "Plans", dir: "plans" },
  // v2 token report owns /tokens; the v1 dashboard stays served at /tokens_v1, hidden from nav.
  { path: "/tokens", id: "tokens2", title: "Tokens", dir: "tokens2" },
  { path: "/tokens_v1", id: "telemetry", title: "Tokens", dir: "telemetry", hidden: true },
  { path: "/localhoster", id: "localhoster", title: "Localhost", dir: "localhoster" },
];

// The browser-safe manifest must expose exactly the path/id/title triples in PAGES order.
// pageManifest() (in portal-server.mjs) maps PAGES to this shape; asserting the derived shape
// keeps the browser-injected nav and the /api/portal/status payload honest to the same order.
assert.deepEqual(
  PAGES.map(({ path, id, title }) => ({ path, id, title })),
  EXPECTED.map(({ path, id, title }) => ({ path, id, title })),
  "PAGES-derived manifest must mirror PAGES in order with the browser-safe shape",
);

// Full PAGES shape (path, id, title, dir, default) matches the canonical map exactly. PAGES only
// sets `default` on the home entry; the other pages omit it (undefined), so compare with that
// optionality rather than demanding an explicit false.
assert.deepEqual(
  PAGES.map(({ path, id, title, dir, default: d }) => ({ path, id, title, dir, default: d })),
  EXPECTED.map(({ path, id, title, dir, default: d }) => ({ path, id, title, dir, default: d })),
  "PAGES must hold the canonical pages in nav order",
);

// Exactly one default page, and it is Home — `roborepo web` opens `/`.
const defaults = PAGES.filter((p) => p.default);
assert.equal(defaults.length, 1, "exactly one page must be marked default");
assert.equal(defaults[0].path, "/", "the default page must be Home at /");
assert.equal(defaults[0].id, "home", "the default page id must be home");

// No aliasing: every path is distinct, and no page id appears twice (removes the old /↔/config
// Agents alias special case from PAGE_BY_PATH).
assert.equal(new Set(PAGES.map((p) => p.path)).size, PAGES.length, "every route must be unique");
assert.equal(new Set(PAGES.map((p) => p.id)).size, PAGES.length, "every page id must be unique");

// Each page's index.html must exist on disk, and Home must be fully static: no {{LOADING}} marker
// (the overlay is only injected where it appears) and no page-local script module.
for (const page of PAGES) {
  const indexHtml = path.join(repoRoot, "portal", page.dir, "index.html");
  assert.ok(fs.existsSync(indexHtml), `portal/${page.dir}/index.html must exist`);
  const html = fs.readFileSync(indexHtml, "utf8");
  if (page.id === "home") {
    assert.ok(!html.includes("{{LOADING}}"), "Home must not render the loading overlay");
    assert.ok(
      !html.includes(`/portal/${page.dir}/app.js`),
      "Home must be static — no page-local script module",
    );
  }
}

console.log("ok: portal page manifest (routes, default, nav order) checks passed");

#!/usr/bin/env node
import assert from "node:assert/strict";
import { renderMarkdown } from "../cli/markdown-render.mjs";

// Regression coverage for the heading-slug, table, and mermaid-fallback extensions added for the
// Telemetry page's "view docs" popup (docs/guides/telemetry.md deep-linking needs stable heading
// ids; the guide itself leans on tables/mermaid instead of dense prose). These extensions are
// shared by every renderMarkdown() consumer (Config's skill-source popup, the new Telemetry guide
// route), so a regression here would silently break more than one page.

testHeadingIdsAndDedup();
testHeadingIdSlugifiesPunctuation();
testTable();
testMermaidFallback();
testPlainCodeBlockUnaffected();
testExistingFeaturesStillWork();
console.log("markdown-render checks passed");

function testHeadingIdsAndDedup() {
  const html = renderMarkdown("# Global Filters\n\n## Time Range\n\nSome text.\n\n## Time Range\n\nMore text.\n");
  assert.match(html, /<h1 id="global-filters">Global Filters<\/h1>/);
  assert.match(html, /<h2 id="time-range">Time Range<\/h2>/);
  // Repeat heading text gets a deduped, unambiguous id — GitHub-style -1 suffix.
  assert.match(html, /<h2 id="time-range-1">Time Range<\/h2>/);
}

function testHeadingIdSlugifiesPunctuation() {
  const html = renderMarkdown("## Package Cost & Regression (exploratory)\n");
  assert.match(html, /<h2 id="package-cost-regression-exploratory">/);
}

function testTable() {
  const md = [
    "| Filter | What it does |",
    "| --- | --- |",
    "| Time | narrows window |",
    "| Model | narrows by model |",
    "",
  ].join("\n");
  const html = renderMarkdown(md);
  assert.match(html, /<div class="md-table-wrap"><table>/);
  assert.match(html, /<th>Filter<\/th><th>What it does<\/th>/);
  assert.match(html, /<td>Time<\/td><td>narrows window<\/td>/);
  assert.match(html, /<td>Model<\/td><td>narrows by model<\/td>/);
}

function testMermaidFallback() {
  const md = "```mermaid\nflowchart LR\n  A --> B\n```\n";
  const html = renderMarkdown(md);
  assert.match(html, /class="md-mermaid"/);
  assert.match(html, /<pre class="mermaid" data-mermaid-source="/);
  // Diagram source stays present and legible (escaped) in both the rendered element's textContent
  // and the data attribute doc-guide-modal.js reads from if mermaid.run() fails.
  assert.match(html, /flowchart LR/);
  assert.match(html, /A --&gt; B/);
}

function testPlainCodeBlockUnaffected() {
  const html = renderMarkdown("```js\nconst x = 1;\n```\n");
  assert.match(html, /<pre><code>const x = 1;<\/code><\/pre>/);
  assert.doesNotMatch(html, /md-mermaid/);
}

// Guard against regressing the renderer's existing consumers (Plans drawer's own copy is separate,
// but scripts/cli/markdown-render.mjs also backs Config's skill-source popup).
function testExistingFeaturesStillWork() {
  const html = renderMarkdown("**bold** and `code` and [a link](https://example.com)\n\n- one\n- two\n");
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<a href="https:\/\/example\.com"/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
}

import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { renderMarkdown } from "./markdown-render.mjs";

export function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderCommandSourceHtml(title, content) {
  return [
    '<section class="source-section command-source">',
    `<div class="source-section-label">${escapeHtml(title)}</div>`,
    renderMarkdown(content),
    "</section>",
  ].join("\n");
}

export function renderSkillSourceHtml({ title, meta, body, contextFiles, references, inventory }) {
  const triggerDescription = meta.description || "(no trigger description)";
  const bodyHtml = body.trim()
    ? renderMarkdown(body)
    : '<p class="source-empty">(no skill body)</p>';
  const contextHtml = contextFiles.length
    ? `<ul>${contextFiles.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join("")}</ul>`
    : '<p class="source-empty">No additional context files.</p>';
  const inventoryHtml = inventory ? renderSkillInventoryHtml(inventory) : "";
  const referencesHtml = references?.length ? renderSkillReferencesHtml(references) : "";
  const triggerHtml = [
    meta.name ? `<div class="skill-name"><code>${escapeHtml(meta.name)}</code></div>` : "",
    `<p>${escapeHtml(triggerDescription)}</p>`,
  ].join("\n");
  return [
    '<div class="skill-source-view">',
    inventoryHtml ? collapsibleSection("Install and Ownership", inventoryHtml) : "",
    collapsibleSection("When the LLM should load this skill", triggerHtml),
    '<section class="source-section skill-body">',
    `<div class="source-section-label">${escapeHtml(title)} content</div>`,
    bodyHtml,
    "</section>",
    '<section class="source-section skill-context">',
    '<div class="source-section-label">Additional context bundled with this skill</div>',
    contextHtml,
    "</section>",
    referencesHtml,
    "</div>",
  ].join("\n");
}

// Collapsed-by-default <details>/<summary> section: no JS needed to wire up, so it renders
// identically wherever this HTML blob is dropped in (Config page modal, shared skill-detail-modal
// element). Collapsed by default so the skill body itself is what's immediately visible.
function collapsibleSection(title, innerHtml) {
  return [
    '<details class="source-section source-collapsible">',
    '<summary class="source-collapsible-summary">',
    `<span class="source-collapsible-title">${escapeHtml(title)}</span>`,
    '<span class="source-collapsible-toggle"><span class="view-label">View</span><span class="hide-label">Hide</span> <span class="caret"></span></span>',
    "</summary>",
    '<div class="source-collapsible-body">',
    innerHtml,
    "</div>",
    "</details>",
  ].join("\n");
}

function renderSkillReferencesHtml(references) {
  const sections = references
    .map(
      ({ file, content }) =>
        `<div class="reference-file"><h2>${escapeHtml(referenceTitle(file))}</h2>\n${renderReferenceFileBody(file, content)}</div>`,
    )
    .join("\n");
  return [
    '<section class="source-section skill-references">',
    '<h1 class="skill-references-header">Skill References</h1>',
    sections,
    "</section>",
  ].join("\n");
}

function referenceTitle(file) {
  const base = path.basename(file, path.extname(file));
  return base
    .split(/[-_]+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

function renderReferenceFileBody(file, content) {
  // Drop the file's own leading H1 — the caller already renders the reference title as its own
  // <h2>, so keeping it would show the title twice.
  return file.endsWith(".md")
    ? renderMarkdown(content.replace(/^#\s+.+\n+/, ""))
    : `<pre><code>${escapeHtml(content)}</code></pre>`;
}

function renderSkillInventoryHtml(inventory) {
  const harnessRows = Object.entries(inventory.harnesses).map(([harness, state]) => {
    const details = [
      state.linkTarget ? `link ${state.linkTarget}` : null,
      state.nativeMetadata.length ? `native metadata: ${state.nativeMetadata.map((m) => m.file).join(", ")}` : null,
    ].filter(Boolean).join(" · ");
    return `<li><strong>${escapeHtml(harness)}</strong>: ${escapeHtml(state.state)}${details ? ` <span>${escapeHtml(details)}</span>` : ""}</li>`;
  }).join("");
  const nativeMeta = inventory.nativeMetadata.length
    ? `<p>Native metadata: ${escapeHtml(inventory.nativeMetadata.map((m) => m.file).join(", "))}</p>`
    : "";
  return [
    `<p>Ownership: ${escapeHtml(inventory.ownership)} · Managed: ${inventory.managed ? "yes" : "no"} · Native collision: ${inventory.nativeCollision ? escapeHtml(inventory.nativeCollisions.join(", ")) : "no"}</p>`,
    `<p>Source: ${escapeHtml(inventory.source.path ? path.relative(repoRoot, inventory.source.path) : "native only")}</p>`,
    `<ul>${harnessRows}</ul>`,
    nativeMeta,
  ].join("\n");
}

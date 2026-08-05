#!/usr/bin/env node
// Dedicated coverage for the plan-promote / plan-start standalone skill packages: discoverability,
// frontmatter parsing, generated-command wiring, package validation, and boundary text. Comparable
// skill-command packages (e.g. integration-check) rely only on the generic catalog tests
// (package-catalog-check.mjs); these two get their own file because their SKILL.md bodies encode
// explicit "do not use for" boundaries against each other and against plan-docs/integration-check,
// which is worth asserting directly rather than only through the generic allowlist checks.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadPackageCatalog, validatePackageCatalog } from "../cli/package-catalog.mjs";
import { loadSlashCommandPlan } from "../cli/slash-commands.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(repoRoot, "scripts/cli/main.mjs");

const SKILLS = {
  "plan-promote": {
    boundaryPhrases: [
      "implement feature code",
      "create a feature branch or worktree",
      "change plan lifecycle",
    ],
  },
  "plan-start": {
    boundaryPhrases: [
      "create a second implementation plan",
      "change lifecycle state",
      "perform closeout or merge orchestration",
    ],
  },
};

// --- SKILL.md discoverability + frontmatter ---
for (const [id, { boundaryPhrases }] of Object.entries(SKILLS)) {
  const skillPath = path.join(repoRoot, "globals/packages", id, "skills", id, "SKILL.md");
  assert.ok(fs.existsSync(skillPath), `${id}: SKILL.md missing at ${skillPath}`);

  const text = fs.readFileSync(skillPath, "utf8");
  const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(frontmatterMatch, `${id}: SKILL.md has no parsable frontmatter block`);

  const nameMatch = frontmatterMatch[1].match(/^name:\s*(.+)$/m);
  assert.ok(nameMatch, `${id}: frontmatter missing name field`);
  assert.equal(nameMatch[1].trim(), id, `${id}: frontmatter name must match folder name`);

  const descMatch = frontmatterMatch[1].match(/^description:\s*(.+)$/m);
  assert.ok(descMatch && descMatch[1].trim().length > 0, `${id}: frontmatter description must be non-empty`);

  for (const phrase of boundaryPhrases) {
    assert.ok(text.includes(phrase), `${id}: SKILL.md missing expected boundary phrase "${phrase}"`);
  }
}

// --- package.config.json loads and validates through the real catalog ---
const catalog = loadPackageCatalog({ includeUnavailable: true });
validatePackageCatalog(catalog);

const byId = new Map(catalog.map((pkg) => [pkg.id, pkg]));
for (const id of Object.keys(SKILLS)) {
  assert.ok(byId.has(id), `catalog missing package: ${id}`);
  const pkg = byId.get(id);
  const skillResource = pkg.resources.find((r) => r.type === "skill" && r.id === id);
  assert.ok(skillResource, `${id}: package.config.json has no matching skill resource`);
  assert.equal(skillResource.invocation, "manual", `${id}: skill resource should be manually invoked`);
}
assert.equal(byId.get("plan-promote").resources[0].risk, "medium", "plan-promote should be risk: medium");
assert.equal(byId.get("plan-start").resources[0].risk, "high", "plan-start should be risk: high");

// --- generated slash commands exist for every harness and point at the right SKILL.md ---
const slashPlan = loadSlashCommandPlan();
const slashNames = new Set(slashPlan.commands.map((c) => c.name));
for (const id of Object.keys(SKILLS)) {
  assert.ok(slashNames.has(id), `missing slash command: ${id}`);
}

for (const harness of ["claude", "codex", "gemini"]) {
  for (const id of Object.keys(SKILLS)) {
    const generatedPath = path.join(repoRoot, "generated/packages", id, harness, "commands", `${id}.md`);
    assert.ok(fs.existsSync(generatedPath), `missing generated command: ${generatedPath}`);
    const body = fs.readFileSync(generatedPath, "utf8");
    assert.ok(body.includes(`/${harness === "claude" ? ".claude" : harness === "codex" ? ".codex" : ".gemini"}/skills/${id}/SKILL.md`),
      `${generatedPath} does not reference the correct SKILL.md read path`);
  }
}

// --- package enablement / dry-run round trip via the real CLI ---
for (const id of Object.keys(SKILLS)) {
  const result = spawnSync(process.execPath, [cli, "package", "validate", id], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `roborepo package validate ${id} failed: ${result.stderr}\n${result.stdout}`);
}

console.log("ok: plan-promote / plan-start discoverability, frontmatter, generated commands, and boundaries");

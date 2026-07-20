#!/usr/bin/env node
// Unit checks for scripts/cli/context-cost.mjs: estimator determinism, level thresholds,
// active/potential separation, rules reconciliation, load classes, and cache behavior.
// Everything runs against injected in-memory deps — no real filesystem or catalog.
import assert from "node:assert/strict";
import {
  ESTIMATOR,
  CONTEXT_LEVEL_THRESHOLDS,
  ON_DEMAND_LEVEL_THRESHOLDS,
  estimateTokens,
  classifyStartupLevel,
  classifyOnDemandLevel,
  buildContextCost,
  invalidateContextCostCache,
} from "../cli/context-cost.mjs";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

// --------------------------------------------------------------------------- fixture

const REPO = "/fixture-repo";

function makeFixture() {
  const files = new Map([
    [`${REPO}/globals/system/rules/shared/00-base.md`, "# Base rules\n\nAlways be sensible.\n"],
    [`${REPO}/globals/system/rules/claude/10-claude.md`, "# Claude extras\n\nClaude-only rule.\n"],
    [`${REPO}/globals/system/rules/codex/10-codex.md`, "# Codex extras\n\nCodex-only rule with more words in it.\n"],
    [`${REPO}/pkgs/alpha/rules.md`, "## Alpha\n\nAlpha rule fragment shared by both harnesses.\n"],
    [`${REPO}/pkgs/beta/rules.md`, "## Beta\n\nBeta rule fragment, codex only.\n"],
    [`${REPO}/pkgs/gamma/skill/SKILL.md`, "---\nname: gamma\ndescription: Gamma skill for tests\n---\n\nFull gamma skill body with workflow steps.\n"],
  ]);
  const mtimes = new Map([...files.keys()].map((key) => [key, 1000]));

  const deps = {
    repoRoot: REPO,
    readFile: (absPath) => (files.has(absPath) ? files.get(absPath) : null),
    statFile: (absPath) => (files.has(absPath)
      ? { mtimeMs: mtimes.get(absPath), size: files.get(absPath).length }
      : null),
    listDir: (absDir) => [...files.keys()]
      .filter((key) => key.startsWith(`${absDir}/`) && !key.slice(absDir.length + 1).includes("/"))
      .map((key) => key.slice(absDir.length + 1))
      .sort(),
    // Mirrors renderContent: preamble + system fragments + enabled package fragments.
    renderRules(harness, enabledIds) {
      const parts = ["# Generated Harness Rules", ""];
      const dirs = [`${REPO}/globals/system/rules/shared`, `${REPO}/globals/system/rules/${harness}`];
      for (const dir of dirs) {
        for (const file of deps.listDir(dir)) parts.push(files.get(`${dir}/${file}`).trimEnd(), "");
      }
      for (const pkg of catalog) {
        if (!enabledIds.includes(pkg.id)) continue;
        for (const comp of pkg.components) {
          if (comp.type !== "rules") continue;
          if (comp.harness !== "both" && comp.harness !== harness) continue;
          parts.push(files.get(`${REPO}/${comp.source}`).trimEnd(), "");
        }
      }
      return `${parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
    },
    slashCommandPlan: () => ({
      commands: [
        { name: "gamma", kind: "skill-backed", description: "Run gamma", skill: "gamma", harnesses: ["claude", "codex"], packageId: "gamma" },
        { name: "solo", kind: "standalone", description: "Standalone command", harnesses: ["claude"], packageId: "solo" },
      ],
      expected: new Map([
        ["claude::gamma", new Map([["gamma.md", "# /gamma\n\nUse the gamma skill wrapper text.\n"]])],
        ["codex::gamma", new Map([["gamma.md", "# /gamma\n\nUse the gamma skill wrapper text.\n"]])],
        ["claude::solo", new Map([["solo.md", "# /solo\n\nStandalone command body.\n"]])],
      ]),
    }),
  };

  const catalog = [
    { id: "alpha", sourceFile: `${REPO}/pkgs/alpha/package.config.json`, components: [{ type: "rules", harness: "both", source: "pkgs/alpha/rules.md" }], resources: [{ type: "rules" }] },
    { id: "beta", sourceFile: `${REPO}/pkgs/beta/package.config.json`, components: [{ type: "rules", harness: "codex", source: "pkgs/beta/rules.md" }], resources: [{ type: "rules" }] },
    { id: "gamma", sourceFile: `${REPO}/pkgs/gamma/package.config.json`, components: [{ type: "skill", id: "gamma" }], resources: [{ type: "skill", id: "gamma" }] },
    { id: "solo", sourceFile: `${REPO}/pkgs/solo/package.config.json`, components: [], resources: [{ type: "slash-command", name: "solo" }] },
    { id: "hooky", sourceFile: `${REPO}/pkgs/hooky/package.config.json`, components: [{ type: "hooks", harness: "claude", source: "pkgs/hooky/hooks.json" }], resources: [{ type: "hooks" }] },
    { id: "mcpy", sourceFile: `${REPO}/pkgs/mcpy/package.config.json`, components: [], resources: [{ type: "mcp", preset: "mcpy" }] },
  ];

  const tools = [
    {
      id: "gamma",
      packageId: "gamma",
      inventory: {
        frontmatter: { name: "gamma", description: "Gamma skill for tests" },
        harnesses: { claude: { installed: true }, codex: { installed: false } },
        inspectPath: `${REPO}/pkgs/gamma/skill/SKILL.md`,
        contextFiles: ["references/extra.md"],
      },
    },
  ];

  return { files, mtimes, deps, catalog, tools };
}

function build(fixture, enabledIds) {
  return buildContextCost({ catalog: fixture.catalog, enabledIds, tools: fixture.tools, deps: fixture.deps });
}

// --------------------------------------------------------------------------- estimator

check("estimator: deterministic, empty, unicode, ceil", () => {
  assert.equal(estimateTokens("").tokens, 0);
  assert.equal(estimateTokens("a").tokens, 1);
  assert.equal(estimateTokens("abcd").tokens, 1);
  assert.equal(estimateTokens("abcde").tokens, 2);
  assert.equal(estimateTokens("héllo wörld").tokens, Math.ceil("héllo wörld".length / 4));
  assert.deepEqual(estimateTokens("abcd"), estimateTokens("abcd"));
  assert.equal(estimateTokens("abcd").method, ESTIMATOR.method);
});

check("levels: boundaries at 7999/8000/20000/20001", () => {
  assert.equal(classifyStartupLevel(7999), "low");
  assert.equal(classifyStartupLevel(8000), "medium");
  assert.equal(classifyStartupLevel(20000), "medium");
  assert.equal(classifyStartupLevel(20001), "high");
  assert.equal(CONTEXT_LEVEL_THRESHOLDS.mediumAt, 8000);
  assert.equal(CONTEXT_LEVEL_THRESHOLDS.highAbove, 20000);
});

check("on-demand levels: skill-size scale boundaries at 999/1000/3000/3001", () => {
  assert.equal(classifyOnDemandLevel(999), "low");
  assert.equal(classifyOnDemandLevel(1000), "medium");
  assert.equal(classifyOnDemandLevel(3000), "medium");
  assert.equal(classifyOnDemandLevel(3001), "high");
  assert.equal(ON_DEMAND_LEVEL_THRESHOLDS.mediumAt, 1000);
  assert.equal(ON_DEMAND_LEVEL_THRESHOLDS.highAbove, 3000);
});

// --------------------------------------------------------------------------- build

check("disabled package: potential measured, active zero, excluded from harness total", () => {
  invalidateContextCostCache();
  const fixture = makeFixture();
  const withAlpha = build(fixture, ["alpha", "gamma"]);
  invalidateContextCostCache();
  const withoutAlpha = build(fixture, ["gamma"]);

  const enabled = withAlpha.packages.alpha;
  const disabled = withoutAlpha.packages.alpha;
  assert.ok(disabled.startupTokens > 0);
  assert.equal(disabled.startupTokens, enabled.startupTokens);
  assert.equal(disabled.activeStartupTokens, 0);
  assert.equal(enabled.activeStartupTokens, enabled.startupTokens);
  assert.ok(withoutAlpha.harnesses.claude.startupTokens < withAlpha.harnesses.claude.startupTokens);
});

check("reconciliation: package fragments + core baseline equal full rules total", () => {
  invalidateContextCostCache();
  const fixture = makeFixture();
  const result = build(fixture, ["alpha", "beta", "gamma"]);
  for (const harness of ["claude", "codex"]) {
    const { rulesTokens, packageRulesTokens, coreBaselineTokens, reconciliationDelta } = result.harnesses[harness].breakdown;
    assert.equal(packageRulesTokens + coreBaselineTokens, rulesTokens);
    assert.equal(typeof reconciliationDelta, "number");
  }
});

check("no double counting: each rules fragment appears once in components", () => {
  invalidateContextCostCache();
  const fixture = makeFixture();
  const result = build(fixture, ["alpha"]);
  const alphaFragments = result.harnesses.claude.components.filter(
    (c) => c.packageId === "alpha" && c.sourceType === "rules",
  );
  assert.equal(alphaFragments.length, 1);
  const cores = result.harnesses.claude.components.filter((c) => c.sourceType === "core");
  assert.equal(cores.length, 1);
});

check("harness divergence: codex-only rules raise codex totals only", () => {
  invalidateContextCostCache();
  const fixture = makeFixture();
  const result = build(fixture, ["alpha", "beta"]);
  assert.notEqual(result.harnesses.claude.startupTokens, result.harnesses.codex.startupTokens);
  assert.ok(result.packages.beta.harnessesDiffer);
  assert.equal(result.packages.beta.perHarness.claude.startupTokens, 0);
  assert.ok(result.packages.beta.perHarness.codex.startupTokens > 0);
});

check("skills: discovery is startup, full body is on-demand, install gates active", () => {
  invalidateContextCostCache();
  const fixture = makeFixture();
  const result = build(fixture, ["gamma"]);
  const components = result.harnesses.claude.components.filter((c) => c.packageId === "gamma");
  const discovery = components.find((c) => c.basis === "skill-discovery-metadata");
  const body = components.find((c) => c.basis === "skill-md");
  assert.equal(discovery.load, "startup");
  assert.equal(body.load, "on-demand");
  assert.ok(body.tokens > discovery.tokens);
  assert.deepEqual(body.notes, ["reference files not counted"]);
  // codex not installed → discovery inactive there, so it never reaches codex startup total
  const codexDiscovery = result.harnesses.codex.components.find(
    (c) => c.packageId === "gamma" && c.basis === "skill-discovery-metadata",
  );
  assert.equal(codexDiscovery.active, false);
  assert.equal(result.harnesses.codex.breakdown.skillDiscoveryTokens, 0);
  assert.ok(result.harnesses.claude.breakdown.skillDiscoveryTokens > 0);
  // per-package on-demand rating uses the skill-size scale
  assert.equal(result.packages.gamma.onDemandLevel, classifyOnDemandLevel(result.packages.gamma.onDemandTokens));
});

check("active rollups honor install state, not just enabled state", () => {
  invalidateContextCostCache();
  const fixture = makeFixture();
  // gamma is enabled but its skill is only installed for claude — active totals must use the
  // per-harness active component sums so section rollups reconcile with harness totals.
  const result = build(fixture, ["gamma"]);
  const gamma = result.packages.gamma;
  assert.equal(gamma.perHarness.codex.activeStartupTokens, 0);
  assert.ok(gamma.perHarness.claude.activeStartupTokens > 0);
  assert.equal(gamma.activeStartupTokens, gamma.perHarness.claude.activeStartupTokens);
  // fully uninstalled: flip claude off too → active drops to zero while potential remains
  fixture.tools[0].inventory.harnesses.claude.installed = false;
  invalidateContextCostCache();
  const uninstalled = build(fixture, ["gamma"]);
  assert.equal(uninstalled.packages.gamma.activeStartupTokens, 0);
  assert.ok(uninstalled.packages.gamma.startupTokens > 0);
});

check("commands: wrapper counted on-demand; standalone adds discovery line", () => {
  invalidateContextCostCache();
  const fixture = makeFixture();
  const result = build(fixture, ["gamma", "solo"]);
  const wrapper = result.harnesses.claude.components.find((c) => c.id === "gamma:command-wrapper");
  assert.equal(wrapper.load, "on-demand");
  assert.ok(wrapper.tokens > 0);
  const soloDiscovery = result.harnesses.claude.components.find((c) => c.id === "solo:command-discovery");
  assert.equal(soloDiscovery.load, "startup");
  assert.ok(soloDiscovery.tokens > 0);
  // solo is claude-only: no codex wrapper component
  assert.equal(result.harnesses.codex.components.some((c) => c.id === "solo:command-wrapper"), false);
});

check("hooks and mcp: labels only, no token numbers, never summed", () => {
  invalidateContextCostCache();
  const fixture = makeFixture();
  const result = build(fixture, ["hooky", "mcpy"]);
  assert.deepEqual(result.packages.hooky.labels, ["conditional"]);
  assert.deepEqual(result.packages.mcpy.labels, ["runtime-dependent"]);
  assert.equal(result.packages.hooky.startupTokens, 0);
  assert.equal(result.packages.mcpy.onDemandTokens, 0);
});

check("cache: identical serialization on repeat call, invalidated by content change", () => {
  invalidateContextCostCache();
  const fixture = makeFixture();
  const first = build(fixture, ["alpha", "gamma"]);
  const second = build(fixture, ["alpha", "gamma"]);
  assert.equal(first, second); // same reference — snapshotChanged stays stable
  assert.equal(JSON.stringify(first), JSON.stringify(second));

  const rulesPath = `${REPO}/pkgs/alpha/rules.md`;
  fixture.files.set(rulesPath, `${fixture.files.get(rulesPath)}\nExtra rule line for invalidation.\n`);
  fixture.mtimes.set(rulesPath, 2000);
  const third = build(fixture, ["alpha", "gamma"]);
  assert.notEqual(first, third);
  assert.ok(third.packages.alpha.startupTokens > first.packages.alpha.startupTokens);

  // enabled-set change also invalidates
  const fourth = build(fixture, ["gamma"]);
  assert.equal(fourth.packages.alpha.activeStartupTokens, 0);
});

check("serializable: JSON round-trip preserves the result", () => {
  invalidateContextCostCache();
  const fixture = makeFixture();
  const result = build(fixture, ["alpha", "beta", "gamma", "solo", "hooky", "mcpy"]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

console.log(`context-cost checks passed (${passed})`);

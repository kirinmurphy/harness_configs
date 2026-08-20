#!/usr/bin/env node
// Every test file under scripts/test/ must be reachable from something that actually runs it:
// the bash suite, an npm script CALLED BY CI, or a CI job directly. A test nothing invokes passes
// forever without asserting anything.
//
// This is not hypothetical. test-install-collisions.sh sat in no test list, which is how an
// uninstall that left files behind survived a full review pass (see commit fcdd2b8). The suite
// reported green the entire time, because the check that would have failed was never called.
//
// A second, quieter version of the same failure: a file registered as a package.json `test:*`
// script is not thereby reachable. `ci.yml` does not run `npm test`; it names specific `test:*`
// scripts one by one, and test-roborepo.sh is its own hand-maintained assert list. A `test:*` entry
// that nothing calls by name is exactly as orphaned as a file with no npm script at all — it just
// looks covered. So a `test:*` script counts as reachable only when test-roborepo.sh references its
// target file, or ci.yml invokes that `test:*` name directly — never merely by existing in
// package.json.
//
// Files that are deliberately not suite entry points declare themselves in EXEMPT below, each with
// a reason. An exemption is a decision on the record; an orphan is an accident.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const testDir = path.join(repoRoot, "scripts", "test");

// Reason strings are the point of this map: each entry says why nothing runs the file, so a future
// reader can tell a deliberate non-test from a test that quietly fell out of the suite.
const EXEMPT = new Map([
  ["test-roborepo.sh", "the suite runner itself"],
  ["telemetry-schemas-persistence-child.mjs", "child process spawned by telemetry-schemas-check.mjs"],
  ["telemetry-spool-bench.mjs", "micro-benchmark against the live spool; run by hand, not asserted"],
  ["test-telemetry-pid.sh", "binds a real port; manual smoke, deliberately out of the automated suite"],
  ["hermetic-suite.sh", "wrapper that re-runs test-roborepo.sh under a sanitized HOME/PATH"],
  ["install-smoke.mjs", "post-install probe against a LIVE installation; run by hand after `roborepo update`, not in CI"],
  ["promote-npm-latest-check.mjs", "touches the real npm registry; release-only, never run in CI"],
  ["publish-npm-check.mjs", "touches the real npm registry; release-only, never run in CI"],
  // The following have a registered package.json test:* script but nothing calls that script by
  // name from test-roborepo.sh or ci.yml. Found by tightening this checker's reachability rule
  // (package.json registration alone no longer counts). Pre-existing gap, not a decision made here
  // -- each needs its own review to decide whether it gets wired into CI or stays intentionally
  // manual and moves into one of the reasoned exemptions above.
  ["capture-dense-bash-check.mjs", "pre-existing gap: test:capture-dense-bash exists but nothing calls it"],
  ["context-cost-check.mjs", "pre-existing gap: test:context-cost exists but nothing calls it"],
  ["localhoster-docker-check.mjs", "pre-existing gap: test:localhoster-docker exists but nothing calls it"],
  ["localhoster-process-check.mjs", "pre-existing gap: test:localhoster-process exists but nothing calls it"],
  ["maintenance-stores-check.mjs", "pre-existing gap: test:maintenance-stores exists but nothing calls it"],
  ["repositories-branch-sync-check.mjs", "pre-existing gap: test:repositories-branch-sync exists but nothing calls it"],
  ["retention-policy-check.mjs", "pre-existing gap: test:retention exists but nothing calls it"],
  ["telemetry-store-bounds-check.mjs", "pre-existing gap: test:telemetry-store-bounds exists but nothing calls it"],
  ["telemetry-time-axis-check.mjs", "pre-existing gap: chained via test:telemetry (node a.mjs && node b.mjs), but test:telemetry itself is never called by ci.yml"],
  ["usage-domain-check.mjs", "pre-existing gap: test:usage-domain exists but nothing calls it"],
  ["usage-statusline-check.mjs", "pre-existing gap: test:usage-statusline exists but nothing calls it"],
]);

// Direct runners: substring matching on filename is deliberate. These files call their children in
// several shapes (node "${repo_root}/scripts/test/x.mjs", bash scripts/test/x.sh), and matching the
// filename catches all of them without trying to parse two languages.
const DIRECT_RUNNER_SOURCES = ["scripts/test/test-roborepo.sh", ".github/workflows/ci.yml"];

function readIfPresent(relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : "";
}

const directHaystack = DIRECT_RUNNER_SOURCES.map(readIfPresent).join("\n");
const ciWorkflow = readIfPresent(".github/workflows/ci.yml");
const packageJsonRaw = readIfPresent("package.json");
const packageJsonScripts = JSON.parse(packageJsonRaw || "{}").scripts || {};

// A test:* npm script only counts as a runner when CI names that script directly (e.g. `npm run
// --silent test:packages`). Being registered in package.json is not enough — ci.yml does not run
// `npm test`, so an unreferenced test:* entry is exactly as unreachable as having no script at all.
const targetsOfCiCalledScripts = new Set();
for (const [scriptName, command] of Object.entries(packageJsonScripts)) {
  if (!scriptName.startsWith("test:")) continue;
  const calledByCi = new RegExp(`\\b${scriptName}\\b`).test(ciWorkflow);
  if (!calledByCi) continue;
  const match = command.match(/scripts\/test\/([a-zA-Z0-9_.-]+\.(mjs|sh|ps1))/);
  if (match) targetsOfCiCalledScripts.add(match[1]);
}

const testFiles = fs
  .readdirSync(testDir)
  .filter((name) => /\.(mjs|sh|ps1)$/.test(name))
  .sort();

const orphans = [];
for (const name of testFiles) {
  if (EXEMPT.has(name)) continue;
  if (directHaystack.includes(name)) continue;
  if (targetsOfCiCalledScripts.has(name)) continue;
  orphans.push(name);
}

// A stale exemption is its own kind of drift: the file was deleted or renamed, and the reason string
// now documents nothing. Cheap to catch here rather than letting the map rot.
const staleExemptions = [...EXEMPT.keys()].filter((name) => !testFiles.includes(name));

let failed = false;

if (orphans.length > 0) {
  failed = true;
  console.error(`fail: ${orphans.length} test file(s) under scripts/test/ are not run by anything:`);
  for (const name of orphans) console.error(`  ${name}`);
  console.error("");
  console.error("Add each to scripts/test/test-roborepo.sh, a package.json test:* script, or a CI job.");
  console.error(`If it is deliberately not a suite entry point, add it to EXEMPT in ${path.relative(repoRoot, fileURLToPath(import.meta.url))} with a reason.`);
}

if (staleExemptions.length > 0) {
  failed = true;
  console.error(`fail: EXEMPT names ${staleExemptions.length} file(s) that no longer exist:`);
  for (const name of staleExemptions) console.error(`  ${name}`);
}

if (failed) process.exit(1);

console.log(`ok: all ${testFiles.length - EXEMPT.size} test files reachable (${EXEMPT.size} exempt)`);

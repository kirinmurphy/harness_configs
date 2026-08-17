#!/usr/bin/env node
// Every test file under scripts/test/ must be reachable from something that actually runs it:
// the bash suite, an npm script, or a CI job. A test nothing invokes passes forever without
// asserting anything.
//
// This is not hypothetical. test-install-collisions.sh sat in no test list, which is how an
// uninstall that left files behind survived a full review pass (see commit fcdd2b8). The suite
// reported green the entire time, because the check that would have failed was never called.
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
]);

// Where a test can be invoked from. Substring matching on filename is deliberate: these files call
// their children in several shapes (node "${repo_root}/scripts/test/x.mjs", npm run --silent
// test:x, bash scripts/test/x.sh), and matching the filename catches all of them without trying to
// parse three languages.
const RUNNER_SOURCES = [
  "scripts/test/test-roborepo.sh",
  ".github/workflows/ci.yml",
  "package.json",
];

function readIfPresent(relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : "";
}

const haystack = RUNNER_SOURCES.map(readIfPresent).join("\n");

const testFiles = fs
  .readdirSync(testDir)
  .filter((name) => /\.(mjs|sh|ps1)$/.test(name))
  .sort();

const orphans = [];
for (const name of testFiles) {
  if (EXEMPT.has(name)) continue;
  if (!haystack.includes(name)) orphans.push(name);
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

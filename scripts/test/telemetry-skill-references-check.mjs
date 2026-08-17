#!/usr/bin/env node
// Covers reference-loading observability: given a set of required skill references and a session's
// captured read events, which references can be shown to have been read.
//
// The failure this guards against is silent and confident. Hash the wrong path root and every
// lookup misses, the report comes back empty, and empty is indistinguishable from "the agent read
// nothing" — so the check that matters most here is that the paths hashed are the ones an agent
// actually opens (`~/.claude/skills/...`), not the roborepo cache they resolve to.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { privacyHash } from "../cli/telemetry-schemas/hash.mjs";
import {
  harnessSkillRoots,
  referenceCandidatePaths,
  buildReferenceIndex,
  observedReferences,
  renderReferenceReport,
  declaredReferences,
} from "../cli/telemetry-skill-references.mjs";

const HOME = "/home/example";

testCandidatePathsUseHarnessRootsNotTheCache();
testIndexOnlyKnowsPathsItWasGiven();
testObservedAndUnobservedAreReportedSeparately();
testEitherHarnessCounts();
testSessionScoping();
testNoCapturedReadsIsDistinctFromNothingMatched();
testReportNeverClaimsAReferenceWentUnread();
testDeclaredReferencesParsesInstalledSkillProse();
testDeclaredReferencesReturnsNothingRatherThanGuessing();
console.log("ok: telemetry skill reference observability checks passed");

// --- helpers ------------------------------------------------------------------------------------

function readEvent(absolutePath, { sessionId = "s1", ts = "2026-08-17T00:00:00.000Z" } = {}) {
  return { session_id: sessionId, ts, tool: { name: "Read", file_path_hash: privacyHash(absolutePath) } };
}

function claudePath(skill, reference) {
  return path.join(HOME, ".claude", "skills", skill, reference);
}

function required() {
  return [{ skill: "technical-writing", references: ["references/review-loop.md", "references/anti-patterns.md"] }];
}

// --- path roots ---------------------------------------------------------------------------------

// The whole mechanism rests on hashing the string the agent's own tool call used. `~/.roborepo/
// skills` is where the files live; `~/.claude/skills` is how they are opened. Verified against a
// real capture spool: the harness path matches recorded reads and the cache path matches nothing.
function testCandidatePathsUseHarnessRootsNotTheCache() {
  const roots = harnessSkillRoots(HOME);
  assert.deepEqual(roots, [path.join(HOME, ".claude", "skills"), path.join(HOME, ".codex", "skills")],
    "candidate roots are the harness-native skill directories");
  for (const root of roots) {
    assert.ok(!root.includes(".roborepo"),
      "the roborepo cache path must never be hashed: agents open the harness path, so cache hashes match nothing and the report comes back silently empty");
  }

  const candidates = referenceCandidatePaths("technical-writing", "references/review-loop.md", HOME);
  assert.equal(candidates.length, 2, "one candidate per harness root");
  assert.ok(candidates.includes(claudePath("technical-writing", "references/review-loop.md")));
}

// --- privacy ------------------------------------------------------------------------------------

// The pipeline stores hashes, never paths. That makes this a presence test against candidates the
// caller already knows, and it must stay that way — an index that could resolve an arbitrary hash
// would turn stored telemetry into a list of everything the user read.
function testIndexOnlyKnowsPathsItWasGiven() {
  const index = buildReferenceIndex(required(), HOME);
  assert.equal(index.size, 4, "two references times two harness roots");
  assert.ok(index.has(privacyHash(claudePath("technical-writing", "references/review-loop.md"))));
  assert.equal(index.get(privacyHash("/some/unrelated/file.md")), undefined,
    "a path that was never supplied cannot be resolved; presence-testing is the only capability here");
}

// --- resolution ---------------------------------------------------------------------------------

function testObservedAndUnobservedAreReportedSeparately() {
  const events = [
    readEvent(claudePath("technical-writing", "references/review-loop.md")),
    readEvent("/somewhere/else/notes.md"),
  ];
  const result = observedReferences(events, required(), { home: HOME });

  assert.deepEqual(result.observed.map((item) => item.reference), ["references/review-loop.md"]);
  assert.deepEqual(result.unobserved.map((item) => item.reference), ["references/anti-patterns.md"]);
  assert.equal(result.readEvents, 2, "every read carrying a path counts, matched or not");
  assert.equal(result.observed[0].firstSeenAt, "2026-08-17T00:00:00.000Z", "an observation carries when it happened");
}

function testEitherHarnessCounts() {
  const codexRead = readEvent(path.join(HOME, ".codex", "skills", "technical-writing", "references/review-loop.md"));
  const result = observedReferences([codexRead], required(), { home: HOME });
  assert.deepEqual(result.observed.map((item) => item.reference), ["references/review-loop.md"],
    "the same reference read through either harness is the same reference");
}

function testSessionScoping() {
  const events = [
    readEvent(claudePath("technical-writing", "references/review-loop.md"), { sessionId: "other" }),
    readEvent(claudePath("technical-writing", "references/anti-patterns.md"), { sessionId: "s1" }),
  ];
  const scoped = observedReferences(events, required(), { home: HOME, sessionId: "s1" });
  assert.deepEqual(scoped.observed.map((item) => item.reference), ["references/anti-patterns.md"],
    "another session's reads are not evidence about this one");
  assert.equal(scoped.readEvents, 1, "read counts are scoped too, or the denominator describes the wrong session");
}

// Zero matches with reads present and zero matches with no reads at all mean different things, and
// conflating them is how a broken pipeline reads as a compliant one.
function testNoCapturedReadsIsDistinctFromNothingMatched() {
  const empty = observedReferences([], required(), { home: HOME });
  assert.equal(empty.readEvents, 0);
  assert.equal(empty.observed.length, 0);
  assert.match(renderReferenceReport(empty), /No read events were captured/,
    "an empty capture must say so rather than presenting itself as a finding about the references");

  const unmatched = observedReferences([readEvent("/unrelated.md")], required(), { home: HOME });
  assert.equal(unmatched.readEvents, 1);
  assert.doesNotMatch(renderReferenceReport(unmatched), /No read events were captured/,
    "reads happened here; they just did not match, which is a different report");
}

// Capture can start mid-session, and a path this module did not try still reads fine. A miss is
// weaker evidence than a hit, and the wording has to carry that.
function testReportNeverClaimsAReferenceWentUnread() {
  const report = renderReferenceReport(observedReferences(
    [readEvent(claudePath("technical-writing", "references/review-loop.md"))], required(), { home: HOME },
  ));
  assert.match(report, /read {6}technical-writing\/references\/review-loop\.md/);
  assert.match(report, /not seen {2}technical-writing\/references\/anti-patterns\.md/);
  assert.doesNotMatch(report, /did not read|was not read|skipped|violation/i,
    "the report states what was observed; asserting what an agent failed to do is a claim the capture cannot support");
  assert.match(report, /not that the reference went unread/,
    "the limit of the evidence is stated in the report itself, not left to the reader");
}

// --- declared reference lookup --------------------------------------------------------------------

function testDeclaredReferencesParsesInstalledSkillProse() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-skill-refs-"));
  try {
    const skillDir = path.join(home, ".claude", "skills", "demo-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
      "# Demo", "",
      "For a named mode, read only the needed references:", "",
      "- Always read this file.",
      "- `write`: also read `references/shapes.md`, `references/guidance.md`, and",
      "  `references/review-loop.md`.",
      "- `review`: also read `references/review-loop.md`.", "",
      "## Something else", "",
    ].join("\n"));

    assert.deepEqual(declaredReferences("demo-skill", "write", home),
      ["references/shapes.md", "references/guidance.md", "references/review-loop.md"],
      "the reference set is read from the installed prose, including references that wrap onto the next line");
    assert.deepEqual(declaredReferences("demo-skill", "review", home), ["references/review-loop.md"]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// Reporting on a guessed reference set would be worse than reporting nothing: it produces confident
// output about requirements the skill never stated.
function testDeclaredReferencesReturnsNothingRatherThanGuessing() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-skill-refs-"));
  try {
    assert.deepEqual(declaredReferences("absent-skill", "write", home), [],
      "an uninstalled skill declares nothing");

    const skillDir = path.join(home, ".claude", "skills", "no-matrix");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# No matrix here\n\nJust prose.\n");
    assert.deepEqual(declaredReferences("no-matrix", "write", home), [],
      "a skill with no parseable matrix declares nothing rather than an invented set");

    fs.mkdirSync(path.join(home, ".claude", "skills", "modes"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "skills", "modes", "SKILL.md"),
      "For a named mode, read only the needed references:\n\n- `write`: also read `references/a.md`.\n\n");
    assert.deepEqual(declaredReferences("modes", "missing-mode", home), [],
      "an unknown mode declares nothing");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

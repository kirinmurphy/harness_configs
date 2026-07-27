#!/usr/bin/env node
import assert from "node:assert/strict";
import { finding, messagesOf, sortBySeverity, FINDING_CODES } from "../../modules/plan-docs/findings.mjs";
import { validateForLifecycle, lifecyclePolicies } from "../../modules/plan-docs/lifecycle-policy.mjs";
import { SECTION_SYNONYMS, SECTION_FINDING_CODES } from "../../modules/plan-docs/section-synonyms.mjs";
import { parsePlanMarkdown } from "../../modules/plan-docs/index.mjs";

// The validation layer is pure — it reads a parsed document and returns findings, touching no
// filesystem — so these drive it directly with in-memory markdown, the same way
// plans-portal-state-check.mjs drives the portal's pure helpers. Filesystem behavior (fresh-disk
// reads, guarded moves) is covered by plan-docs-check.mjs instead.

const PRIORITIES = new Set(["high", "medium", "low", "none"]);
const normalizeHeading = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

testSynonymsAreNormalized();
testSynonymKeysMapToRealCodes();
testEveryEmittedCodeIsCatalogued();
testFindingRejectsUnknownCode();
testMessagesOfProjectsMessages();
testSortBySeverityPutsBlockingFirst();
testBacklogAcceptsDraftReadyAndBlocked();
testBacklogRequiresNextAction();
testActiveReportsEveryProblemTogether();
testActiveAcceptsCompletePlan();
testActiveFlagsEmptyBlockerEntry();
testCompletedReportsEveryProblemTogether();
testCompletedAcceptsFinishedPlan();
testCompletedRejectsBareVerificationHeading();
testArchivedDoesNotRequireCompletion();
testUnclassifiedReportsMisplacementAndStillChecksSections();
testUncheckedTaskCountMatchesRemaining();
testFindingsAreDeterministic();
testValidationDoesNotMutateInput();
testSectionSynonymsAreInterchangeable();
testAcceptedHeadingsTravelOnSectionFindings();
console.log("ok: plan docs findings and lifecycle policy checks passed");

// --- helpers ----------------------------------------------------------------------------------

// Builds a plan document from parts so each test states only what it cares about. Defaults
// produce a document that satisfies every universal rule.
function doc({
  frontmatter = "id: sample-plan\npriority: high\n",
  title = "# Sample Plan\n",
  sections = ["Summary", "Goals", "Context", "Proposed Design", "Validation"],
  extra = "",
} = {}) {
  const body = sections.map((name) => `## ${name}\n\nSome real content.\n`).join("\n");
  return parsePlanMarkdown(`---\n${frontmatter}---\n\n${title}\n${body}\n${extra}`, {});
}

function validate(parsed, lifecycle) {
  return validateForLifecycle(parsed, { lifecycle, priorities: PRIORITIES, normalizeHeading });
}

function codesFor(parsed, lifecycle) {
  return validate(parsed, lifecycle).findings.map((item) => item.code);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

// --- catalog integrity ------------------------------------------------------------------------

// A synonym that isn't already in normalized form would silently never match any heading, which
// is the worst failure mode for a list people hand-edit. Catch it here instead.
function testSynonymsAreNormalized() {
  for (const [section, names] of Object.entries(SECTION_SYNONYMS)) {
    for (const name of names) {
      assert.equal(normalizeHeading(name), name,
        `SECTION_SYNONYMS.${section} entry "${name}" must already be normalized (lowercase, single spaces, no punctuation) or it can never match a heading`);
    }
  }
}

function testSynonymKeysMapToRealCodes() {
  for (const section of Object.keys(SECTION_SYNONYMS)) {
    assert.ok(SECTION_FINDING_CODES[section],
      `every section in SECTION_SYNONYMS needs a finding code; "${section}" has none`);
    assert.ok(FINDING_CODES.includes(SECTION_FINDING_CODES[section]),
      `SECTION_FINDING_CODES.${section} names a code missing from the findings catalog`);
  }
}

// Guards against a validator emitting a code that was renamed or never added to the catalog.
function testEveryEmittedCodeIsCatalogued() {
  const empty = parsePlanMarkdown("no frontmatter, no headings", {});
  for (const lifecycle of [...Object.keys(lifecyclePolicies), "unclassified"]) {
    for (const code of codesFor(empty, lifecycle)) {
      assert.ok(FINDING_CODES.includes(code), `validator emitted uncatalogued finding code: ${code}`);
    }
  }
}

function testFindingRejectsUnknownCode() {
  assert.throws(() => finding("NOT_A_REAL_CODE"), /unknown finding code/,
    "an unknown code must fail loudly rather than producing an undefined-message finding");
}

function testMessagesOfProjectsMessages() {
  const findings = [finding("MISSING_TITLE"), finding("MISSING_ID")];
  assert.deepEqual(messagesOf(findings), ["Missing H1 title.", "Missing frontmatter id."],
    "messagesOf must project exactly the message field, in order");
}

function testSortBySeverityPutsBlockingFirst() {
  const sorted = sortBySeverity([finding("MISSING_TITLE"), finding("MISSING_ID"), finding("MISSING_SUMMARY")]);
  assert.deepEqual(sorted.map((item) => item.code), ["MISSING_ID", "MISSING_TITLE", "MISSING_SUMMARY"],
    "blocking findings lead, and original order is preserved within each severity group");
}

// --- backlog ----------------------------------------------------------------------------------

// Backlog is the resting state for anything not started — proposed, draft, or blocked all belong.
function testBacklogAcceptsDraftReadyAndBlocked() {
  const ready = doc({ frontmatter: "id: p\npriority: high\nnext_action: Do the thing\n" });
  assert.deepEqual(codesFor(ready, "backlog"), [], "a complete backlog plan reports nothing");

  const blocked = doc({ frontmatter: "id: p\npriority: low\nnext_action: Wait\nblocked_by:\n  - other-plan\n" });
  assert.deepEqual(codesFor(blocked, "backlog"), [],
    "a blocked plan is still a valid backlog plan — blockers are not a readiness problem here");

  const unstarted = doc({ frontmatter: "id: p\npriority: none\nnext_action: Decide scope\n" });
  assert.deepEqual(codesFor(unstarted, "backlog"), [], "priority none is a valid backlog state");
}

function testBacklogRequiresNextAction() {
  assert.deepEqual(codesFor(doc(), "backlog"), ["MISSING_NEXT_ACTION"],
    "backlog is actionable, so it needs to say what the next step would be");
}

// --- active -----------------------------------------------------------------------------------

// The plan doc requires every problem in one response, not one field at a time.
function testActiveReportsEveryProblemTogether() {
  const bare = doc({ frontmatter: "id: p\npriority: high\n", sections: ["Summary", "Goals", "Context"] });
  assert.deepEqual(codesFor(bare, "active"), [
    "MISSING_DESIGN",
    "MISSING_CRITERIA",
    "MISSING_NEXT_ACTION",
    "MISSING_IMPLEMENTATION_CONTEXT",
    "MISSING_SUCCESS_CRITERIA",
  ], "all five problems surface together in one pass, universal rules before destination rules");
}

function testActiveAcceptsCompletePlan() {
  const complete = doc({ frontmatter: "id: p\npriority: high\nnext_action: Build it\n" });
  assert.deepEqual(codesFor(complete, "active"), [], "a plan with every section and a next action is active-ready");
}

function testActiveFlagsEmptyBlockerEntry() {
  const parsed = doc({ frontmatter: "id: p\npriority: high\nnext_action: Go\nblocked_by:\n  - real-plan\n" });
  parsed.frontmatter.blocked_by = ["real-plan", "  "];
  const blank = validate(parsed, "active").findings.find((item) => item.code === "EMPTY_BLOCKER_ENTRY");
  assert.ok(blank, "a whitespace-only blocker entry is reported");
  assert.equal(blank.count, 1, "the count reflects how many blocker entries were empty");
}

// --- completed --------------------------------------------------------------------------------

function testCompletedReportsEveryProblemTogether() {
  const unfinished = doc({
    frontmatter: "id: p\npriority: high\nnext_action: Still going\nblocked_by:\n  - other\n",
    extra: "## Work\n\n- [ ] one\n- [ ] two\n- [x] three\n",
  });
  const codes = codesFor(unfinished, "completed");
  for (const expected of ["UNCHECKED_REQUIRED_TASKS", "NEXT_ACTION_REMAINS", "BLOCKERS_REMAIN", "MISSING_VERIFICATION"]) {
    assert.ok(codes.includes(expected), `completed validation must report ${expected} alongside the others`);
  }
}

function testCompletedAcceptsFinishedPlan() {
  const done = doc({
    frontmatter: "id: p\npriority: high\n",
    extra: "## Verification\n\nRan the suite; all green.\n\n## Work\n\n- [x] one\n- [x] two\n",
  });
  assert.deepEqual(codesFor(done, "completed"), [],
    "no unchecked tasks, no next action, no blockers, and real verification content passes");
}

// hasContent is what separates a real section from a heading someone added to silence a warning.
function testCompletedRejectsBareVerificationHeading() {
  const bare = doc({ frontmatter: "id: p\npriority: high\n", extra: "## Verification\n" });
  assert.ok(codesFor(bare, "completed").includes("MISSING_VERIFICATION"),
    "an empty Verification heading does not count as evidence");

  const filled = doc({ frontmatter: "id: p\npriority: high\n", extra: "## Verification\n\nTests pass.\n" });
  assert.ok(!codesFor(filled, "completed").includes("MISSING_VERIFICATION"),
    "a Verification section with content satisfies the requirement");
}

// --- archived ---------------------------------------------------------------------------------

// Archived means terminated or retained for history — deliberately not a claim the work finished.
function testArchivedDoesNotRequireCompletion() {
  const abandoned = doc({
    frontmatter: "id: p\npriority: low\n",
    extra: "## Work\n\n- [ ] never done\n- [ ] also never done\n",
  });
  assert.deepEqual(codesFor(abandoned, "archived"), [],
    "archived accepts unchecked tasks and absent verification — it is not Completed");
}

function testUnclassifiedReportsMisplacementAndStillChecksSections() {
  const codes = codesFor(doc({ sections: ["Summary"] }), "unclassified");
  assert.ok(codes.includes("UNCLASSIFIED_LOCATION"), "a file outside a lifecycle folder is flagged as misplaced");
  assert.ok(codes.includes("MISSING_GOALS"),
    "misplacement is one more finding, not a reason to stop describing the document");
}

// --- metadata and determinism -----------------------------------------------------------------

function testUncheckedTaskCountMatchesRemaining() {
  const parsed = doc({
    frontmatter: "id: p\npriority: high\n",
    extra: "## Verification\n\nDone.\n\n## Work\n\n- [ ] a\n- [ ] b\n- [ ] c\n- [x] d\n",
  });
  const found = validate(parsed, "completed").findings.find((item) => item.code === "UNCHECKED_REQUIRED_TASKS");
  assert.equal(found.count, 3, "count equals the number of unchecked tasks");
  assert.equal(found.count, parsed.taskCounts.remaining, "count is taskCounts.remaining, not recomputed differently");
  assert.deepEqual(found.meta, { remaining: 3, total: 4 }, "metadata carries both remaining and total");
  assert.match(found.message, /unchecked/, "the message describes the problem in plain language");
}

function testFindingsAreDeterministic() {
  const parsed = doc({ frontmatter: "id: p\npriority: high\nnext_action: Go\n", sections: ["Summary"] });
  assert.deepEqual(validate(parsed, "active").findings, validate(parsed, "active").findings,
    "identical input produces deep-equal findings, so codes and metadata are stable across calls");
}

function testValidationDoesNotMutateInput() {
  const parsed = deepFreeze(doc({ sections: ["Summary"] }));
  assert.doesNotThrow(() => validate(parsed, "completed"),
    "validation must not write to the parsed document it was handed");
}

// Every synonym must be genuinely interchangeable — otherwise the list lies about what it accepts.
function testSectionSynonymsAreInterchangeable() {
  for (const [section, names] of Object.entries(SECTION_SYNONYMS)) {
    const code = SECTION_FINDING_CODES[section];
    for (const name of names) {
      const sections = Object.entries(SECTION_SYNONYMS)
        .map(([key, list]) => (key === section ? name : list[0]));
      assert.ok(!codesFor(doc({ sections }), "backlog").includes(code),
        `"${name}" is listed as a ${section} synonym but does not satisfy the ${section} requirement`);
    }
  }
}

// The repair prompt names acceptable headings from this metadata, so it has to be present.
function testAcceptedHeadingsTravelOnSectionFindings() {
  const found = validate(doc({ sections: ["Goals"] }), "backlog").findings
    .find((item) => item.code === "MISSING_SUMMARY");
  assert.deepEqual(found.meta.accepted, SECTION_SYNONYMS.summary,
    "a missing-section finding carries the accepted heading names so the repair prompt can list them");
}

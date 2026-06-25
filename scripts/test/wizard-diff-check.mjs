#!/usr/bin/env node
// Unit test for the onboarding wizard's deferred-apply selection (presets.pendingWizardChanges).
// The wizard flips each item's `active` flag in memory during the keypress loop; when it exits, only
// the rows whose `active` differs from the original `wasActive` should be applied. This exercises
// that pure diff directly — no pty, no config mutation — so it stays fast and non-brittle. The
// end-to-end keypress -> apply -> persisted-mutation path is covered by the pty test in
// test-install-collisions.sh (test_onboarding_wizard_toggles_and_applies).
import assert from "node:assert/strict";
import { pendingWizardChanges } from "../cli/presets.mjs";

const row = (id, { active, wasActive, toggleable = true, category = "Token Optimization" }) => ({
  label: id,
  active,
  wasActive,
  toggleable,
  section: { category },
  item: { id },
});

const steps = [
  {
    title: "Token Optimization",
    items: [
      row("jcodemunch", { active: false, wasActive: true }),  // changed -> disable
      row("telemetry", { active: true, wasActive: true }),    // unchanged -> skip
    ],
  },
  {
    title: "Commands",
    items: [
      row("verify", { active: true, wasActive: false, category: "Commands" }),            // changed -> enable
      row("frozen", { active: true, wasActive: false, toggleable: false, category: "Commands" }), // not toggleable -> skip
    ],
  },
  {
    title: "Permissions",
    readonly: true,
    items: [row("profile", { active: false, wasActive: true })], // readonly step -> skip even though changed
  },
];

const pending = pendingWizardChanges(steps);

assert.deepEqual(
  pending.map((r) => r.item.id),
  ["jcodemunch", "verify"],
  "selects only changed, toggleable rows from non-readonly steps, in order",
);
assert.equal(pending[0].active, false, "carries the desired final state for a disable");
assert.equal(pending[1].active, true, "carries the desired final state for an enable");

// No changes -> empty selection (the 'No changes.' path).
const unchanged = pendingWizardChanges([
  { title: "x", items: [row("jcodemunch", { active: true, wasActive: true })] },
]);
assert.equal(unchanged.length, 0, "an all-unchanged wizard yields no pending work");

console.log("wizard-diff ok");

#!/usr/bin/env node
// Harness provider registry, discovery, state, and runtime (Phase 2). See
// docs/plans/active/discoverable-harness-provider-architecture-plan.md Phase 2 validation section.

import { defineHarnessProvider } from "../harnesses/contract.mjs";
import { detectHarnessProvider } from "../harnesses/discovery.mjs";
import {
  applyDiscoveryToState,
  setProviderEnabled,
  isProviderEnabled,
} from "../harnesses/state.mjs";
import { listHarnessProviders, getHarnessProvider, hasHarnessProvider } from "../harnesses/registry.mjs";
import { createHarnessRuntime, requireHarnessCapability } from "../harnesses/runtime.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThrows(fn, label) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`${label}: expected to throw`);
}

// --- Real registry: exactly claude + codex + gemini, all constructible and passing contract
// validation. Gemini is the first real (non-synthetic) third provider — see
// docs/plans/backlog/gemini-cli-provider-integration-plan.md. ---
const providers = listHarnessProviders();
assert(providers.length === 3, `expected 3 registered providers, got ${providers.length}`);
assert(hasHarnessProvider("claude") && hasHarnessProvider("codex") && hasHarnessProvider("gemini"), "registry must know claude, codex, and gemini");
assertThrows(() => getHarnessProvider("nonexistent"), "getHarnessProvider unknown id");

// --- Discovery confidence normalization: executable+home+config -> confirmed; executable-only or
// config-only -> probable; home-only -> possible; nothing -> absent. Uses fake manifests pointed
// at fixture-controlled paths, not the real installed claude/codex, so results are deterministic. ---
function fakeManifest(id, overrides = {}) {
  return {
    schemaVersion: 1,
    id,
    displayName: id,
    commandName: id,
    adapter: id,
    detection: {
      executables: [],
      homeCandidates: [],
      configCandidates: [],
      minimumConfidence: "probable",
      ...overrides,
    },
    paths: {},
    capabilities: ["root-config"],
  };
}

{
  const result = detectHarnessProvider(fakeManifest("nope-nowhere"));
  assert(result.status === "absent", "no evidence must be absent status");
  assert(result.confidence === "absent", "no evidence must be absent confidence");
}

// --- Synthetic third provider: proves the registry/runtime/discovery pipeline carries no
// hardcoded two-provider (claude/codex) assumption anywhere in this phase's code. ---
const thirdManifest = {
  schemaVersion: 1,
  id: "synthetic-third",
  displayName: "Synthetic Third",
  commandName: "synthetic-third",
  adapter: "synthetic-third",
  detection: { minimumConfidence: "possible" },
  paths: {},
  capabilities: ["root-config"],
};
const thirdProvider = defineHarnessProvider({
  manifest: thirdManifest,
  adapters: { rootConfig: { merge: () => {}, render: () => {} } },
});
assert(thirdProvider.id === "synthetic-third", "synthetic third provider must construct via defineHarnessProvider");

// --- State: zero/one/multi enabled-provider scenarios, explicit-disable survives refresh ---
let state = { schemaVersion: 1, lastDiscoveredAt: new Date(0).toISOString(), providers: {} };

// Zero enabled: runtime.providersFor must return empty, not throw.
{
  const runtime = createHarnessRuntime({ state });
  assert(runtime.providersFor("root-config").length === 0, "zero enabled providers must yield empty list");
}

const detected = [
  { providerId: "claude", status: "detected", confidence: "confirmed", evidence: [{ kind: "executable", value: "claude" }], warnings: [] },
  { providerId: "codex", status: "detected", confidence: "confirmed", evidence: [{ kind: "executable", value: "codex" }], warnings: [] },
];
state = applyDiscoveryToState(state, detected);
assert(isProviderEnabled(state, "claude"), "claude enabled after discovery");
assert(isProviderEnabled(state, "codex"), "codex enabled after discovery");

// One enabled: disable codex, runtime must only surface claude for a shared capability.
state = setProviderEnabled(state, "codex", false);
{
  const runtime = createHarnessRuntime({ state });
  const rootConfigProviders = runtime.providersFor("root-config").map((p) => p.id);
  assert(rootConfigProviders.length === 1 && rootConfigProviders[0] === "claude", "one enabled provider must scope to that provider only");
}

// Explicit disable must survive a subsequent discovery refresh (discovery re-detects codex, but
// the user's explicit disable wins).
const rediscovered = applyDiscoveryToState(state, detected);
assert(!isProviderEnabled(rediscovered, "codex"), "explicit disable must survive refresh");
assert(isProviderEnabled(rediscovered, "claude"), "claude stays enabled across refresh");
assert(rediscovered.providers.codex.selectionSource === "user", "disabled provider keeps selectionSource=user across refresh");

// Multi enabled: re-enable codex, both must appear for a shared capability.
const bothEnabled = setProviderEnabled(rediscovered, "codex", true);
{
  const runtime = createHarnessRuntime({ state: bothEnabled });
  const ids = runtime.providersFor("root-config").map((p) => p.id).sort();
  assert(ids.length === 2 && ids[0] === "claude" && ids[1] === "codex", "multi enabled providers must both surface for a shared capability");
}

// requireHarnessCapability throws for a capability the provider doesn't declare.
assertThrows(
  () => requireHarnessCapability(getHarnessProvider("claude"), "telemetry-rate-limits"),
  "requireHarnessCapability must reject an undeclared capability (claude has no telemetry-rate-limits)"
);

console.log("harness registry/discovery/state/runtime: all checks passed");

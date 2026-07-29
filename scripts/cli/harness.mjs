// `roborepo harness ...` command implementations. Thin CLI layer over
// scripts/harnesses/{registry,discovery,state,runtime}.mjs — this module owns argument parsing
// and console output only; harness provider logic stays in scripts/harnesses/.

import { listHarnessProviders, getHarnessProvider, hasHarnessProvider } from "../harnesses/registry.mjs";
import { discoverHarnessProviders } from "../harnesses/discovery.mjs";
import { readHarnessState, writeHarnessState, applyDiscoveryToState, setProviderEnabled } from "../harnesses/state.mjs";

function requireProviderId(rest, label) {
  const id = rest[0];
  if (!id) {
    console.error(`usage: roborepo harness ${label} <id>`);
    process.exit(2);
  }
  if (!hasHarnessProvider(id)) {
    const known = listHarnessProviders().map((p) => p.id).join(", ");
    console.error(`unknown harness: ${id}. Known harnesses: ${known}`);
    process.exit(2);
  }
  return id;
}

export function harnessList() {
  const state = readHarnessState();
  for (const provider of listHarnessProviders()) {
    const entry = state.providers[provider.id];
    const status = entry?.enabled ? "enabled" : "disabled";
    const confidence = entry?.confidence ?? "absent";
    console.log(`${provider.id}\t${provider.manifest.displayName}\t${status}\t${confidence}`);
  }
}

export function harnessInspect(rest) {
  const id = requireProviderId(rest, "inspect");
  const provider = getHarnessProvider(id);
  const state = readHarnessState();
  console.log(JSON.stringify({ manifest: provider.manifest, state: state.providers[id] ?? null }, null, 2));
}

export function harnessRefresh() {
  const previous = readHarnessState();
  const results = discoverHarnessProviders(listHarnessProviders());
  const next = applyDiscoveryToState(previous, results);
  writeHarnessState(next);
  harnessList();
}

export function harnessEnable(rest) {
  const id = requireProviderId(rest, "enable");
  const state = readHarnessState();
  writeHarnessState(setProviderEnabled(state, id, true));
  console.log(`enabled: ${id}`);
}

export function harnessDisable(rest) {
  const id = requireProviderId(rest, "disable");
  const state = readHarnessState();
  writeHarnessState(setProviderEnabled(state, id, false));
  console.log(`disabled: ${id}`);
}

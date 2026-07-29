// Trusted static harness-provider registry. RoboRepo-owned executable adapter bindings only —
// a user workspace can enable/disable/configure a known provider but cannot name an arbitrary
// module for RoboRepo to execute. See contract.mjs for validation and capability vocabulary.

import { claudeProvider } from "./claude/index.mjs";
import { codexProvider } from "./codex/index.mjs";

const PROVIDERS = new Map([
  [claudeProvider.id, claudeProvider],
  [codexProvider.id, codexProvider],
]);

export function listHarnessProviders() {
  return [...PROVIDERS.values()];
}

export function getHarnessProvider(id) {
  const provider = PROVIDERS.get(id);
  if (!provider) throw new Error(`unsupported harness: ${id}`);
  return provider;
}

export function hasHarnessProvider(id) {
  return PROVIDERS.has(id);
}

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { scanForString } from "../lib/scan-for-string.mjs";

export function assertNoSourceCoupling(homeDir, checkoutPath) {
  const matches = scanForString(homeDir, checkoutPath);
  assert.equal(
    matches.length,
    0,
    `found source-checkout path leaked into generated files: ${matches.join(", ")}`,
  );
}

export function assertNoVersionedPathCoupling(scanRoot, prefixDir, { allowInstallStateExemption = true } = {}) {
  const versionedRoot = fs.realpathSync(path.join(prefixDir, "lib", "node_modules", "codethings-roborepo-alpha"));
  const exemptSuffix = path.join(".roborepo", "install-state.json");
  const rawMatches = scanForString(scanRoot, versionedRoot);
  const matches = allowInstallStateExemption
    ? rawMatches.filter((relPath) => !relPath.endsWith(exemptSuffix))
    : rawMatches;
  const exempted = allowInstallStateExemption
    ? rawMatches.filter((relPath) => relPath.endsWith(exemptSuffix))
    : [];
  if (exempted.length) {
    console.log(`exempted from versioned-path check (${exemptSuffix}): ${exempted.join(", ")}`);
  }
  assert.equal(
    matches.length,
    0,
    `found versioned npm install path leaked into generated files outside the documented install-state.json exemption: ${matches.join(", ")}`,
  );
}

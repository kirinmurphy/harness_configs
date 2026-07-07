// Shared paths for roborepo command modules. repoRoot is derived from this file's location
// (scripts/cli/paths.mjs -> two levels up), so the whole CLI resolves the same roborepo
// root regardless of cwd. The test suite copies scripts/cli/ (entry main.mjs + modules) into a
// throwaway root to exercise writes safely.

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, "..", "..");
export const sharedSkillsDir = path.join(repoRoot, "globals", "agents", "skills");
// Claude/Codex harness home directories. Single source of truth for the claude/codex -> ~/.claude,
// ~/.codex mapping — presets.mjs, update-report.mjs, and config.mjs all need it and previously each
// hand-defined their own copy.
export const harnessHome = {
  claude: path.join(os.homedir(), ".claude"),
  codex: path.join(os.homedir(), ".codex"),
};
// Root config baseline paths (the repo-tracked templates for mutable harness config).
export const rootConfigBaseline = {
  claude: path.join(repoRoot, "globals", "claude", "settings.json"),
  codex: path.join(repoRoot, "globals", "codex", "config.toml"),
};
// Root config active paths (what the harness actually reads).
export const rootConfigActive = {
  claude: path.join(harnessHome.claude, "settings.json"),
  codex: path.join(harnessHome.codex, "config.toml"),
};

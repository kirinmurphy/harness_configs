// Service layer bridging the domain-neutral repository registry (modules/repositories) to the CLI
// and portal. Records cross-domain discoveries into the registry and performs the server-side Plans
// enrollment operation. Kept dependency-injectable (stateRoot / fsApi / plan hooks) so tests drive
// it without touching real home-dir state.
import fs from "node:fs";
import { stateRoot as defaultStateRoot } from "./paths.mjs";
import {
  loadRegistry,
  updateRegistry,
  upsertRepository,
  recordDiscovery,
  registerLocalRoot,
  setEnrollment,
  planPlansEnrollment,
  providerUrlForRepositoryId,
} from "../../modules/repositories/index.mjs";
import { readPlanSettings } from "../../modules/plan-docs/index.mjs";
import { updatePlanSettings as updatePlanSettingsDefault, refreshPlans as refreshPlansDefault } from "./plans.mjs";

// Register (or refresh) a repository discovered by a domain. Idempotent; batches every mutation for
// one discovery into a single registry write. `localRoot` (an opaque rootId) is optional and, when
// present, records the specific clone/worktree the discovery came from. Enrollment is NEVER enabled
// here — discovery and enrollment are separate concerns (doc §"Discovery Sources and Provenance":
// Localhoster discovery must not silently enable Plans).
export function recordRepositoryDiscovery({
  repositoryId,
  kind,
  displayName,
  normalizedRemote = null,
  source,
  evidence,
  confidence,
  localRoot = null,
  localRootKind = "clone",
  stateRoot = defaultStateRoot,
  fsApi = fs,
  now = new Date().toISOString(),
}) {
  return updateRegistry({
    stateRoot,
    fsApi,
    mutate: (registry) => {
      upsertRepository(registry, {
        id: repositoryId,
        kind,
        displayName,
        providerUrl: providerUrlForRepositoryId(repositoryId),
        normalizedRemote: normalizedRemote || (kind === "git" ? repositoryId : null),
        now,
      });
      let changed = false;
      if (recordDiscovery(registry, repositoryId, { source, evidence, confidence, now })) changed = true;
      if (localRoot && registerLocalRoot(registry, repositoryId, { rootId: localRoot, kind: localRootKind, now })) changed = true;
      // upsert of a brand-new repository is itself a change even if discovery/root debounced.
      return changed || registry.repositories[repositoryId].createdAt === now;
    },
  });
}

// Server-side "Include plans" enrollment for a repository discovered elsewhere (e.g. by Localhoster).
// Steps (doc §"Enrollment from Localhoster"):
//   1. resolve the exact repo root (caller supplies it — it is machine-local and never leaves here)
//   2. determine whether an existing Plans source already covers it
//   3. if covered: refresh, add no duplicate source
//   4. if not: add the EXACT repo root as the narrow default (never a broad parent silently)
//   5. update Plans source config + trigger a Plans refresh
//   6. record that Plans monitoring was explicitly enabled
// If the Plans write/refresh throws, the registry is NOT marked enabled (step 6 only runs on
// success) — enrollment failure leaves the repository unmonitored.
export function enrollRepositoryInPlans({
  repositoryId,
  repoRoot,
  stateRoot = defaultStateRoot,
  fsApi = fs,
  readSettings = readPlanSettings,
  updatePlanSettings = updatePlanSettingsDefault,
  refreshPlans = refreshPlansDefault,
  now = new Date().toISOString(),
}) {
  if (!repoRoot || typeof repoRoot !== "string") throw new Error("enrollment requires the repository root");
  const registry = loadRegistry({ stateRoot, fsApi });
  if (!registry.repositories[repositoryId]) throw new Error(`unknown repository: ${repositoryId}`);

  const settings = readSettings({ stateRoot });
  const plan = planPlansEnrollment(repoRoot, settings.discoveryRoots || []);

  let sourceAdded = null;
  if (!plan.covered) {
    // Add ONLY the exact repo root. Broadening to a parent is an explicit, separate user choice.
    const nextRoots = [...new Set([...(settings.discoveryRoots || []), plan.suggestedSource])];
    updatePlanSettings({ discoveryRoots: nextRoots });
    sourceAdded = plan.suggestedSource;
  }
  // Refresh so the newly-covered repository's plans are discovered (or the registry re-syncs).
  refreshPlans();

  // Only now — after Plans config + refresh succeeded — mark monitoring enabled.
  updateRegistry({
    stateRoot,
    fsApi,
    mutate: (reg) => setEnrollment(reg, repositoryId, "plans", { enabled: true, now }),
  });

  return { covered: plan.covered, coveringSource: plan.coveringSource || null, sourceAdded };
}

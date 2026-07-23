import { loadPackageCatalog, isPackageAvailable } from "./package-catalog.mjs";
import { buildPackageLiveState } from "./package-probes.mjs";
import { stateRoot } from "./paths.mjs";
import {
  buildPlanSnapshot,
  buildPrompt,
  findPlanByKey,
  normalizeRootInput,
  readPlanDocument,
  readPlanSettings,
  updatePlanPriority as updatePlanPriorityInDocs,
  writePlanSettings,
} from "../../modules/plan-docs/index.mjs";

let cachedSnapshot = null;

export function loadPlansSnapshot() {
  cachedSnapshot = buildPlanSnapshot({ stateRoot, packageState: planDocsPackageState() });
  return publicSnapshot(cachedSnapshot);
}

export function loadPlanDocument({ key }) {
  const snapshot = cachedSnapshot || buildPlanSnapshot({ stateRoot, packageState: planDocsPackageState() });
  return readPlanDocument(snapshot, key);
}

export function buildPlansPrompt({ action, keys, mode }) {
  const snapshot = cachedSnapshot || buildPlanSnapshot({ stateRoot, packageState: planDocsPackageState() });
  const selected = (Array.isArray(keys) ? keys : []).map((key) => findPlanByKey(snapshot, key));
  if (selected.length === 0) throw new Error("select at least one plan");
  return { prompt: buildPrompt(action, selected, { mode }) };
}

export function updatePlanSettings({ discoveryRoots }) {
  if (!Array.isArray(discoveryRoots)) throw new Error("expected discoveryRoots array");
  const current = readPlanSettings({ stateRoot });
  const normalized = [...new Set(discoveryRoots.map((root) => normalizeRootInput(root)))];
  writePlanSettings({ stateRoot, discoveryRoots: normalized, ignoredDirectories: current.ignoredDirectories });
  cachedSnapshot = null;
  return loadPlansSnapshot();
}

export function updatePlanPriority({ key, priority, mtimeMs }) {
  const snapshot = cachedSnapshot || buildPlanSnapshot({ stateRoot, packageState: planDocsPackageState() });
  const result = updatePlanPriorityInDocs(snapshot, key, priority, mtimeMs);
  cachedSnapshot = null;
  return result;
}

export function refreshPlans() {
  cachedSnapshot = null;
  return loadPlansSnapshot();
}

// Matches config.mjs's readConfigSnapshot(): the raw catalog entry only carries the package's
// static definition (id/label/lifecycle/etc), never its live enabled/disabled state — that comes
// from buildPackageLiveState(), which actually probes installed rules/hooks/permissions on disk.
function planDocsPackageState() {
  const allPackages = loadPackageCatalog({ includeUnavailable: true });
  const pkg = allPackages.find((item) => item.id === "plan-docs");
  if (!pkg) return { available: false, enabled: false, status: "missing" };
  const available = isPackageAvailable(pkg);
  const liveState = available ? buildPackageLiveState([pkg]).get(pkg.id) : null;
  return {
    available,
    enabled: liveState?.desired || false,
    status: liveState?.status || "disabled",
    message: "",
  };
}

function publicSnapshot(snapshot) {
  return {
    ...snapshot,
    plans: snapshot.plans.map(({ absolutePath, repository, ...plan }) => ({
      ...plan,
      repository: stripRepositoryRoot(repository),
    })),
    repositories: snapshot.repositories.map(({ root, ...repo }) => repo),
  };
}

function stripRepositoryRoot(repository) {
  const { root, ...publicRepository } = repository || {};
  return publicRepository;
}

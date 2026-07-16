import { loadPackageCatalog } from "./package-catalog.mjs";
import { stateRoot } from "./paths.mjs";
import {
  buildPlanSnapshot,
  buildPrompt,
  findPlanByKey,
  normalizeRootInput,
  readPlanDocument,
  readPlanSettings,
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

export function refreshPlans() {
  cachedSnapshot = null;
  return loadPlansSnapshot();
}

function planDocsPackageState() {
  const pkg = loadPackageCatalog({ includeUnavailable: true }).find((item) => item.id === "plan-docs");
  if (!pkg) return { available: false, enabled: false, status: "missing" };
  return {
    available: pkg.catalogStatus !== "unavailable",
    enabled: pkg.status === "enabled",
    status: pkg.status || "disabled",
    message: pkg.message || "",
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

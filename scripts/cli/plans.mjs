import { loadPackageCatalog, isPackageAvailable } from "./package-catalog.mjs";
import { buildPackageLiveState } from "./package-probes.mjs";
import { stateRoot } from "./paths.mjs";
import {
  buildPlanSnapshot,
  buildPrompt,
  findPlanByKey,
  movePlanLifecycle as movePlanLifecycleInDocs,
  normalizeRootInput,
  readPlanDocument,
  readPlanSettings,
  updatePlanPriority as updatePlanPriorityInDocs,
  writePlanSettings,
} from "../../modules/plan-docs/index.mjs";
import { repairPlansMissingFrontmatter } from "../../modules/plan-docs/repair.mjs";

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

export function updatePlanPriority({ id, key, priority, expectedPriority, mtimeMs, repositoryId }) {
  const snapshot = cachedSnapshot || buildPlanSnapshot({ stateRoot, packageState: planDocsPackageState() });
  const result = updatePlanPriorityInDocs(snapshot, { id, key, priority, expectedPriority, mtimeMs, repositoryId });
  cachedSnapshot = null;
  return publicMutationResult(result);
}

export function updatePlanLifecycle({ id, key, lifecycle, expectedLifecycle, mtimeMs, repositoryId, skipDestinationValidation }) {
  const snapshot = cachedSnapshot || buildPlanSnapshot({ stateRoot, packageState: planDocsPackageState() });
  const result = movePlanLifecycleInDocs(snapshot, { id, key, lifecycle, expectedLifecycle, mtimeMs, repositoryId, skipDestinationValidation });
  cachedSnapshot = null;
  return publicMutationResult(result);
}

// Strips the same private fields (absolutePath, repository.root) from a mutation result's record
// that publicSnapshot() strips from every plan in a full snapshot — the domain layer's record
// shape always carries them internally, but they must never cross the HTTP boundary.
function publicMutationResult(result) {
  const { absolutePath, repository, ...plan } = result.record;
  return { change: result.change, record: { ...plan, repository: stripRepositoryRoot(repository) } };
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

export function plansCommand(args) {
  const [sub, ...rest] = args;
  if (sub === "repair") return plansRepairCommand(rest);
  console.error(`unknown: roborepo plans ${sub ?? ""}`.trim());
  console.error("usage: roborepo plans repair <root> [--dry-run]");
  process.exit(2);
}

function plansRepairCommand(args) {
  const dryRun = args.includes("--dry-run");
  const root = args.find((arg) => !arg.startsWith("--"));
  if (!root) {
    console.error("usage: roborepo plans repair <root> [--dry-run]");
    process.exit(2);
  }
  const resolvedRoot = normalizeRootInput(root);
  const { repaired, errors } = repairPlansMissingFrontmatter(resolvedRoot, { dryRun });
  if (repaired.length === 0) {
    console.log("no plan docs missing frontmatter found.");
  } else {
    const verb = dryRun ? "would scaffold frontmatter for" : "scaffolded frontmatter for";
    console.log(`${verb} ${repaired.length} plan doc${repaired.length === 1 ? "" : "s"}:`);
    for (const item of repaired) console.log(`  ${item.repository}: ${item.relativePath}`);
  }
  for (const err of errors) console.error(`warning: ${err.root || err.repository}: ${err.error}`);
  if (errors.length > 0) process.exit(1);
}

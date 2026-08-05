// Filter state, matching, sorting, and facet counts — no DOM here. app.js owns wiring DOM events
// to this module's functions; templates.js owns turning its output into markup.

export const LIFECYCLE_LABELS = {
  active: "Active",
  backlog: "Backlog",
  completed: "Completed",
  archived: "Archived",
  unclassified: "Unclassified",
};

export const FILTER_IDS = [
  "search",
  "repository",
  "priority",
  "blocked",
  "readiness",
  "review",
  "health",
];

export const FILTER_DEFAULTS = {
  search: "",
  repository: "all",
  priority: "all",
  blocked: "all",
  readiness: "all",
  review: "all",
  health: "all",
};

export const FILTER_LABELS = {
  repository: "repo",
  priority: "priority",
  blocked: "blocked",
  readiness: "readiness",
  review: "review",
  health: "health",
};

// Canonical repository key for filtering: prefer the shared canonical repositoryId (so two local
// clones of one remote resolve to a single filter option), falling back to the legacy content-hash
// id for any record that has no canonical id yet.
export function repositoryFilterKey(repo) {
  return repo.repositoryId || repo.id;
}

export const FILTER_OPTION_DEFS = {
  repository: (snapshot) => {
    const seen = new Map();
    for (const repo of snapshot.repositories) {
      const key = repositoryFilterKey(repo);
      if (!seen.has(key)) seen.set(key, repo.name);
    }
    return [["all", "all repositories"], ...seen.entries()];
  },
  priority: () => [
    ["all", "all priority"],
    ...["high", "medium", "low", "none"].map((v) => [v, v]),
  ],
  blocked: () => [
    ["all", "all blockers"],
    ["blocked", "blocked"],
    ["unblocked", "unblocked"],
  ],
  readiness: () => [
    ["all", "all readiness"],
    ["ready", "ready"],
    ["draft", "draft"],
  ],
  review: () => [
    ["all", "all review"],
    ...["never-reviewed", "current", "possibly-stale", "unknown"].map((v) => [
      v,
      v,
    ]),
  ],
  health: () => [
    ["all", "all health"],
    ["warnings", "has warnings"],
    ["valid", "valid"],
  ],
};

// Per-field predicates keyed by filter id, each taking the field's current filter value.
// Shared by filteredPlans() (applies all fields) and optionCounts() (applies all fields except
// the one being counted, for facet-style "N remaining if you pick this" counts).
export const FIELD_MATCHERS = {
  repository: (record, value) =>
    value === "all" || repositoryFilterKey(record.repository) === value,
  priority: (record, value) =>
    value === "all" || record.plan.priority === value,
  blocked: (record, value) => {
    if (value === "blocked") return record.plan.blockers.length > 0;
    if (value === "unblocked") return record.plan.blockers.length === 0;
    return true;
  },
  readiness: (record, value) =>
    value === "all" || record.plan.readiness === value,
  review: (record, value) =>
    value === "all" || record.plan.reviewState === value,
  health: (record, value) => {
    if (value === "warnings") return record.plan.validation.warnings.length > 0;
    if (value === "valid") return record.plan.validation.warnings.length === 0;
    return true;
  },
  search: (record, value) => {
    const q = value.toLowerCase().trim();
    if (!q) return true;
    const plan = record.plan;
    return [
      plan.title,
      plan.id,
      plan.relativePath,
      plan.nextAction,
      record.repository.name,
      ...plan.blockers,
      ...plan.validation.warnings,
    ]
      .join(" ")
      .toLowerCase()
      .includes(q);
  },
};

export function optionLabel(snapshot, id, value) {
  const def = FILTER_OPTION_DEFS[id](snapshot).find(
    ([optValue]) => optValue === value,
  );
  return def ? def[1] : value;
}

export function matchesFilters(record, filters, excludeId) {
  for (const id of FILTER_IDS) {
    if (id === excludeId) continue;
    if (!FIELD_MATCHERS[id](record, filters[id])) return false;
  }
  return true;
}

export function filteredPlans(plans, filters) {
  return plans
    .filter((record) => matchesFilters(record, filters, null))
    .sort(planSort);
}

export function actionablePlans(plans) {
  return plans.filter(
    (record) => !["completed", "archived"].includes(record.plan.lifecycle),
  );
}

// Facet-style counts: for `id`, how many plans would match each candidate value in `values` if
// every OTHER active filter stayed as-is. Excludes `id` itself so picking an option doesn't
// shrink its own count relative to the other options.
export function optionCounts(id, values, plans, filters) {
  const pool = plans.filter((record) => matchesFilters(record, filters, id));
  const counts = new Map();
  for (const value of values) {
    counts.set(
      value,
      value === "all"
        ? pool.length
        : pool.filter((record) => FIELD_MATCHERS[id](record, value)).length,
    );
  }
  return counts;
}

export function planSort(a, b) {
  const priority = { high: 0, medium: 1, low: 2, none: 3 };
  const activeBlocked =
    (b.plan.lifecycle === "active" && b.plan.blockers.length ? 1 : 0) -
    (a.plan.lifecycle === "active" && a.plan.blockers.length ? 1 : 0);
  return (
    activeBlocked ||
    (priority[a.plan.priority] ?? 3) - (priority[b.plan.priority] ?? 3) ||
    Date.parse(b.plan.modifiedAt) - Date.parse(a.plan.modifiedAt) ||
    a.plan.title.localeCompare(b.plan.title)
  );
}

export function repositoryContext(record) {
  return `Review the plan at \`${record.plan.relativePath}\` in this repository.\n\nFocus on:\n- the current next action\n- unresolved tasks\n- blockers\n- whether the plan still matches the implementation\n\nDo not assume the document is current. Verify relevant claims against the repository.`;
}

export function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString();
}

// How a plan's task progress should be displayed: "bar", "complete", or "none".
//
// Progress is worth showing whenever it says something the lifecycle does not already imply.
// Nothing started in backlog is the default state of everything in backlog, so a 0% bar there is
// noise; started work is not the default anywhere, and neither is a finished task list. Active
// always shows a bar because progress is the point of the lifecycle, even at 0%.
//
// A finished list gets a badge rather than a full bar: a 100% bar reads as "in progress, at the
// end", which is a different claim than "done".
export function taskProgressDisplay(plan) {
  const { total, remaining } = plan.taskCounts;
  if (total > 0 && remaining === 0) return "complete";
  const started = total > 0 && remaining < total;
  if (started) return "bar";
  return plan.lifecycle === "active" ? "bar" : "none";
}

// --- lifecycle tab <-> URL state -----------------------------------------------------------
// The selected lifecycle tab is serialized into `?lifecycle=` so the tab survives a refresh and
// participates in back/forward navigation (unlike telemetry's filters, which intentionally use
// replaceState — lifecycle tab switches are meant to be real history stops).

const LIFECYCLE_QUERY_KEY = "lifecycle";
const VALID_LIFECYCLES = new Set([...Object.keys(LIFECYCLE_LABELS)]);

export function lifecycleFromSearchParams(params, fallback = "active") {
  const value = params.get(LIFECYCLE_QUERY_KEY);
  return value && VALID_LIFECYCLES.has(value) ? value : fallback;
}

export function urlForLifecycle(lifecycle) {
  const params = new URLSearchParams(location.search);
  params.set(LIFECYCLE_QUERY_KEY, lifecycle);
  return `${location.pathname}?${params.toString()}`;
}

// --- mutation orchestration helpers ---------------------------------------------------------
// Pure functions the app.js mutation orchestrator uses to decide what a successful lifecycle or
// priority change should do to the visible list and which outcome surface (if any) to show.

// A record is visible when it's on the currently selected lifecycle tab AND matches every active
// filter. Used both before a mutation (to know if a toast/dialog needs to explain a disappearance)
// and after (to know whether the mutated record is still on screen).
export function isVisible(record, selectedLifecycle, filters) {
  return record.plan.lifecycle === selectedLifecycle && matchesFilters(record, filters, null);
}

// Replaces the record at `oldKey` with `newRecord` in a plans array, returning a new array. A
// lifecycle move changes `key` (it's derived from the file's path), so this can't be a simple
// in-place field mutation — the old key must be looked up once, then the whole record swapped for
// the server's rebuilt one.
export function replaceRecord(plans, oldKey, newRecord) {
  return plans.map((record) => (record.key === oldKey ? newRecord : record));
}

// Determines whether the passive toast's "View {value} plans" filtered-list shortcut should
// appear: only when the specific filter dimension that changed currently equals the *previous*
// value (i.e. the mutation is what caused the plan to leave that filtered view). Returns a
// descriptor the toast controller can render, or null when the shortcut doesn't apply.
export function filteredListActionFor(change, state) {
  if (change.property === "lifecycle") {
    if (state.selectedLifecycle !== change.previousValue) return null;
    return { type: "lifecycle", value: change.newValue, label: `View ${LIFECYCLE_LABELS[change.newValue]} plans` };
  }
  if (change.property === "priority") {
    if (state.filters.priority !== change.previousValue) return null;
    return { type: "priority", value: change.newValue, label: `View ${change.newValue} priority plans` };
  }
  return null;
}

// --- blocker/blocking resolution -------------------------------------------------------------
// Resolved live from the current snapshot on every call (not cached on the record) so a mutation
// that only rebuilds one record (see updatePlanPriority/movePlanLifecycle) never leaves stale
// blocker/blocking data behind — the next render always recomputes from state.snapshot.plans.
// Plan ids are only unique within one repository (see modules/plan-docs/index.mjs's
// relationshipWarnings), so matches are scoped to the same repository.id as the referencing plan.

// Every blocked_by id, resolved to its plan record when one exists in the same repository.
// Unresolvable ids (typo, wrong repo, deleted plan) come back with resolved: false and no record.
export function resolveBlockers(record, allPlans) {
  return (record.plan.blockers || []).map((id) => {
    const target = allPlans.find((item) => item.plan.id === id && item.repository.id === record.repository.id);
    return target
      ? { id, title: target.plan.title, key: target.key, resolved: true }
      : { id, title: id, key: null, resolved: false };
  });
}

// The reverse of resolveBlockers: every other plan in the same repository whose blocked_by lists
// this plan's id — i.e. what this plan is currently blocking. Always resolved, since these are
// found by scanning the snapshot rather than looked up by a possibly-stale id.
export function resolveBlocking(record, allPlans) {
  if (!record.plan.id) return [];
  return allPlans
    .filter((item) =>
      item.key !== record.key &&
      item.repository.id === record.repository.id &&
      (item.plan.blockers || []).includes(record.plan.id))
    .map((item) => ({ id: item.plan.id, title: item.plan.title, key: item.key, resolved: true }));
}

// --- lifecycle readiness errors ---------------------------------------------------------------

// Splits a rejected move's findings into what must be fixed and what is merely worth fixing, so
// the dialog and the repair prompt present them in the same order. Falls back to the plain
// `details` strings for any error that predates structured findings, so an older or non-plans
// route still renders something useful.
export function lifecycleFindingGroups(err) {
  const findings = Array.isArray(err?.findings) && err.findings.length
    ? err.findings
    : (err?.details || []).map((message) => ({ message, severity: "blocking" }));
  return {
    blocking: findings.filter((item) => item.severity === "blocking"),
    advisory: findings.filter((item) => item.severity !== "blocking"),
  };
}

// Whether a repair prompt is available to copy. The descriptor is generated server-side and only
// accompanies readiness failures, so the button stays hidden for every other error.
export function canRepairLifecycleError(err) {
  return typeof err?.repair?.prompt === "string" && err.repair.prompt.length > 0;
}

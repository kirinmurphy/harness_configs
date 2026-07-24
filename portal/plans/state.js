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

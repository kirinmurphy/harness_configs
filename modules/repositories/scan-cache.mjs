// Per-scan memoization for repository-root-keyed work (Git context, future per-root metadata).
//
// Why an explicit object rather than a module-level Map: the cache MUST NOT outlive one scan. A
// process-lifetime cache would pin the first branch/dirty reading a long-lived portal ever took and
// report it forever. Making the cache an object the caller creates and drops makes that lifetime a
// property of the code shape instead of a rule someone has to remember.
//
// Domain-neutral on purpose. Localhoster is the first consumer, but "cache work keyed by repository
// root for the duration of one scan" is not a Localhoster concept — Plans, Telemetry, and Doctor all
// resolve roots too, and a second copy in modules/localhoster/ is exactly the duplicate resolver
// code the canonical-repository-identity migration removed.

export function createScanCache() {
  const entries = new Map();

  return {
    // Memoize-on-miss. computeFn may be async; the PROMISE is what gets cached, so N instances
    // discovered under one repository root share a single in-flight read rather than each starting
    // their own (the value is only settled once, so a late caller still gets the same result).
    get(rootKey, computeFn) {
      if (!rootKey || typeof rootKey !== "string") return computeFn();
      if (entries.has(rootKey)) return entries.get(rootKey);
      const value = computeFn();
      entries.set(rootKey, value);
      return value;
    },

    get size() {
      return entries.size;
    },
  };
}

// Phase 2 only wires the registry/discovery/state runtime — it does not migrate any capability's
// real behavior yet. This produces placeholder adapter methods that satisfy
// validateCapabilityAdapters()'s required-method shape check so providers can be registered now,
// while failing loudly (not silently no-opping) if anything calls them before Phases 3-6 land the
// real implementation.

export function notYetMigrated(providerId, group, method) {
  return () => {
    throw new Error(
      `harness provider "${providerId}" adapter "${group}.${method}" is not migrated yet ` +
        `(tracked in discoverable-harness-provider-architecture-plan.md Phases 3-6)`
    );
  };
}

export function stubAdapterGroups(providerId, groups) {
  const adapters = {};
  for (const [group, methods] of Object.entries(groups)) {
    adapters[group] = {};
    for (const method of methods) {
      adapters[group][method] = notYetMigrated(providerId, group, method);
    }
  }
  return adapters;
}

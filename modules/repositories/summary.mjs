// Browser-safe repository summary shapes (doc §"Browser-Safe API Contracts"). The ONLY repository
// data that crosses to the browser goes through here. It must never contain: absolute local paths,
// raw Git config, credentials, telemetry prompt/result content, or the internal alias graph.
// `capabilities` (associated domain data exists / can be queried) is deliberately distinct from
// `enrollments` (an ongoing user-controlled scan is enabled).

// One repository, summarized for a list or embed.
export function repositorySummary(record) {
  const discoveredBy = (record.discoveries || []).map((d) => d.source);
  const best = bestDiscovery(record.discoveries || []);
  return {
    repositoryId: record.id,
    displayName: record.displayName,
    providerUrl: record.providerUrl || null,
    resolution: record.resolution,
    activity: record.activity,
    visibility: record.visibility,
    confidence: best?.confidence || null,
    evidence: best?.evidence || null,
    discoveredBy: [...new Set(discoveredBy)],
    capabilities: capabilitiesFor(record),
    enrollments: enrollmentsFor(record),
  };
}

// The registry-wide list payload — array of summaries, path-free by construction.
export function repositoryListPayload(registry) {
  return {
    repositories: Object.values(registry.repositories || {}).map(repositorySummary),
  };
}

// Detail payload for one repository. Adds non-sensitive structural detail (local-root COUNTS and
// kinds, discovery provenance timestamps) but still never a path or a raw alias target.
export function repositoryDetailPayload(record) {
  return {
    ...repositorySummary(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    localRoots: (record.localRoots || []).map((r) => ({ kind: r.kind, firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt })),
    discoveries: (record.discoveries || []).map((d) => ({ source: d.source, evidence: d.evidence, confidence: d.confidence, firstSeenAt: d.firstSeenAt, lastSeenAt: d.lastSeenAt })),
  };
}

// capabilities = "associated domain data exists or can be queried". Derived from discovery sources
// and enrollment. This is intentionally coarse in v2 (presence of a discovery from a domain implies
// that domain can be queried for this repo); richer per-domain probes can refine it later.
function capabilitiesFor(record) {
  const sources = new Set((record.discoveries || []).map((d) => d.source));
  return {
    localhoster: sources.has("localhoster"),
    plans: sources.has("plans") || isEnabled(record, "plans"),
    telemetry: sources.has("telemetry"),
    agentConfig: sources.has("agentConfig"),
    health: sources.has("doctor"),
  };
}

function enrollmentsFor(record) {
  const out = {};
  for (const [domain, e] of Object.entries(record.enrollments || {})) out[domain] = e.enabled === true;
  return out;
}

function isEnabled(record, domain) {
  return record.enrollments?.[domain]?.enabled === true;
}

function bestDiscovery(discoveries) {
  const rank = { high: 3, medium: 2, low: 1, suggestion: 0 };
  let best = null;
  for (const d of discoveries) {
    if (!best || (rank[d.confidence] ?? -1) > (rank[best.confidence] ?? -1)) best = d;
  }
  return best;
}

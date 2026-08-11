import { appRoot, stateRoot } from "./paths.mjs";
import { collectGitContext } from "../../modules/localhoster/git.mjs";
import {
  appendHistoryEvents,
  buildLocalhosterSnapshot,
  capabilityForPlatform,
  defaultSettings,
  diffSnapshots,
  discoverInstances,
  discoverMetadataSuggestions,
  findCurrentInstanceByOpaqueKey,
  healthIndexFromSnapshot,
  loadSettings,
  readHistoryEvents,
  updateSettings,
} from "../../modules/localhoster/index.mjs";
import { recordRepositoryDiscovery } from "./repositories.mjs";
import { resolveProjectIdentity } from "../../modules/localhoster/identity.mjs";
import { canonicalRepositoryId, rootId as computeRootId } from "../../modules/repositories/identity.mjs";

const FRESHNESS_MS = 8000;
const HISTORY_API_LIMIT = 200;

let lastSnapshot = null;
let inFlightRefresh = null;
let refreshGeneration = 0;
let portalInfo = null;
// associationKeys already present in the history file, read once. Without it, the first refresh
// after a portal restart has no previous snapshot to compare against and would emit a firstSeen for
// every running app — every restart, forever.
let knownHistoryKeys = null;

export function loadLocalhosterSnapshot() {
  const now = new Date();
  if (!lastSnapshot) {
    lastSnapshot = buildSnapshot({ discovery: emptyDiscovery(), refresh: { state: "idle", startedAt: null, error: null }, now });
    scheduleRefresh();
    return lastSnapshot;
  }
  if (Date.now() - Date.parse(lastSnapshot.generatedAt) > FRESHNESS_MS) scheduleRefresh();
  return withRefreshState(lastSnapshot);
}

export async function refreshLocalhosterSnapshot() {
  if (inFlightRefresh) return inFlightRefresh;
  const startedAt = new Date().toISOString();
  const generation = refreshGeneration + 1;
  refreshGeneration = generation;
  inFlightRefresh = (async () => {
    try {
      const settings = loadSettings({ stateRoot });
      const previous = lastSnapshot;
      // Independent of discovery, so pay for one round of latency rather than two. Both must settle
      // before portalInstance() runs below, since it reads the collected git context synchronously.
      const [discovery] = await Promise.all([
        discoverInstances({
          settings,
          // Carrying the prior health records forward is what makes failure debouncing work: the
          // classifier is pure, so the consecutive-failure count has to travel with the snapshot.
          previousHealth: healthIndexFromSnapshot(previous),
        }),
        refreshPortalGit(),
      ]);
      if (generation !== refreshGeneration && lastSnapshot) return withRefreshState(lastSnapshot);
      const portal = portalInstance();
      if (portal) {
        discovery.instances = discovery.instances.filter((instance) => !isPortalDuplicate(instance, portal));
        discovery.instances.unshift(portal);
      }
      recordDiscoveredRepositories(discovery.instances);
      lastSnapshot = buildSnapshot({ discovery, settings, refresh: { state: "idle", startedAt: null, error: null, generation } });
      // Only refreshes produce events. updateLocalhosterSettings also rebuilds a snapshot, but from
      // cached discovery with no fresh probe, so any diff there would be a settings artifact rather
      // than a real transition. Recorded after lastSnapshot is assigned so a history failure can
      // never cost us a good snapshot.
      recordHistoryEvents(previous, lastSnapshot, settings);
      return lastSnapshot;
    } catch (err) {
      const error = String(err?.message || err);
      if (lastSnapshot) {
        lastSnapshot = markLocalhosterRefreshFailed(lastSnapshot, { startedAt, error, generation });
        return lastSnapshot;
      }
      lastSnapshot = buildSnapshot({
        discovery: { ...emptyDiscovery(), warnings: [error] },
        refresh: { state: "failed", startedAt, error, generation },
      });
      return lastSnapshot;
    } finally {
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
}

// Resolution is deliberately two-step. The opaque key only ever resolves against the CURRENT
// snapshot, which is the SSRF/enumeration guard on this tokenless GET route — a browser can never
// hand the server a key the server did not itself mint. But the opaque key includes the origin, so
// it changes whenever an app's port changes; history is keyed by the port-free associationKey
// instead. Hence: opaque key -> current instance -> its associationKey -> events.
//
// Consequence: an app that has stopped has no current instance and therefore no readable history,
// even though its events remain on disk. Surfacing those needs a port-free handle for inactive
// entries, which belongs with the portal's inactive-card work.
// `snapshot` is an injection seam for tests, matching how the module layer takes runCommand/probeHttp
// — it keeps a check from triggering a live listener scan. Production callers pass nothing.
export function loadLocalhosterHistory(key, { snapshot = null } = {}) {
  const instance = findCurrentInstanceByOpaqueKey(snapshot || loadLocalhosterSnapshot(), key);
  if (!instance) return { ok: false, status: 404, error: "unknown localhoster key" };
  const events = readHistoryEvents({ stateRoot })
    .filter((event) => event.associationKey === instance.associationKey)
    .reverse()
    .slice(0, HISTORY_API_LIMIT);
  return {
    ok: true,
    key,
    app: instance.app ? { id: instance.app.id, name: instance.app.name } : null,
    associationKey: instance.associationKey,
    events,
  };
}

export async function loadLocalhosterMetadata(key) {
  const instance = findCurrentInstanceByOpaqueKey(loadLocalhosterSnapshot(), key);
  if (!instance) return { ok: false, status: 404, error: "unknown localhoster key" };
  const suggestions = await discoverMetadataSuggestions(instance.origin);
  return { ok: true, key, origin: instance.origin, suggestions };
}

export function updateLocalhosterSettings(input) {
  try {
    const settings = updateSettings({ stateRoot, input });
    const discovery = snapshotDiscovery(lastSnapshot);
    lastSnapshot = buildSnapshot({ discovery, settings });
    return { ok: true, localhoster: lastSnapshot };
  } catch (err) {
    if (err?.code === "REVISION_CONFLICT") {
      return {
        ok: false,
        status: 409,
        error: err.message,
        localhoster: buildSnapshot({ discovery: snapshotDiscovery(lastSnapshot), settings: err.current }),
      };
    }
    return { ok: false, status: 400, error: String(err?.message || err), localhoster: loadLocalhosterSnapshot() };
  }
}

export function setLocalhosterPortalInfo(info) {
  portalInfo = info;
  if (lastSnapshot) {
    const discovery = snapshotDiscovery(lastSnapshot);
    const portal = portalInstance();
    if (portal && !discovery.instances.some((instance) => instance.project?.identity === "roborepo:portal")) {
      discovery.instances.unshift(portal);
      lastSnapshot = buildSnapshot({ discovery, settings: loadSettings({ stateRoot }) });
    }
  }
}

export function markLocalhosterRefreshFailed(snapshot, { startedAt, error, generation = snapshot.refresh?.generation || null }) {
  return {
    ...snapshot,
    refresh: { state: "failed", startedAt, error, generation },
    warnings: [...(snapshot.warnings || []), error],
  };
}

export async function localhosterCommand(args) {
  const flags = new Set(args);
  const allowed = new Set(["--json", "--open"]);
  for (const arg of args) {
    if (!allowed.has(arg)) {
      console.error("usage: roborepo localhoster [--json] [--open]");
      process.exit(2);
    }
  }
  if (flags.has("--open")) {
    const { serveCommand } = await import("./telemetry.mjs");
    return serveCommand(["--detach"], { allowPortFallback: true, openPath: "/localhoster" });
  }
  const snapshot = await refreshLocalhosterSnapshot();
  if (flags.has("--json")) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }
  printLocalhosterTable(snapshot);
}

export function printLocalhosterTable(snapshot) {
  if (snapshot.capabilities.discovery !== "supported") {
    console.log(snapshot.capabilities.message);
    if (!snapshot.projects.length && !snapshot.inactiveProjects.length) return;
  }
  const rows = [];
  for (const project of snapshot.projects) {
    for (const instance of project.instances) {
      rows.push([
        project.name,
        instance.app?.name || "Web",
        instance.origin || "(no origin)",
        statusLabel(instance),
      ]);
    }
  }
  for (const instance of snapshot.unmatchedInstances) {
    rows.push(["Other instances", instance.process.command, instance.origin || "(no origin)", statusLabel(instance)]);
  }
  if (!rows.length) {
    console.log("No active localhost HTTP apps found.");
    return;
  }
  const widths = [0, 1, 2, 3].map((i) => Math.max(...rows.map((row) => row[i].length), ["Project", "App", "Origin", "Status"][i].length));
  console.log(padRow(["Project", "App", "Origin", "Status"], widths));
  console.log(padRow(widths.map((width) => "-".repeat(width)), widths));
  for (const row of rows) console.log(padRow(row, widths));
}

// Register repositories owning running processes into the shared registry (localhost tracking only
// — NEVER enables Plans, per the discovery/enrollment separation). Best-effort: a registry failure
// must never break Localhoster discovery, so each write is guarded and errors are swallowed.
function recordDiscoveredRepositories(instances) {
  const seen = new Set();
  for (const instance of instances || []) {
    const project = instance.project;
    const repositoryId = project?.repositoryId;
    if (!repositoryId || seen.has(repositoryId)) continue;
    seen.add(repositoryId);
    try {
      recordRepositoryDiscovery({
        repositoryId,
        kind: repositoryId.startsWith("git:") ? "git" : "local",
        displayName: displayNameForProject(project),
        source: "localhoster",
        evidence: project.identityKind === "git" ? "git-remote" : "cwd-in-git-root",
        confidence: project.confidence || "medium",
        localRoot: project.rootId || null,
        // The checkout this listener actually ran from. rootId is derived from exactly this path
        // (withRepositoryFields in modules/localhoster/discovery.mjs), so the two always agree —
        // recording the path alongside the id is what lets a repository be located when nothing is
        // running. Server-side only; it never enters a browser payload.
        localRootPath: project.projectRoot || null,
        stateRoot,
      });
    } catch {
      // Registry unavailable/corrupt — Localhoster keeps working; the failure surfaces elsewhere
      // (Phase 4 reports registry errors as a structured health finding).
    }
  }
}

// Append transition events for this refresh. Best-effort in the same spirit as
// recordDiscoveredRepositories: history is an observability nicety and must never be able to break
// discovery, so every failure is swallowed.
function recordHistoryEvents(previous, next, settings) {
  try {
    if (knownHistoryKeys === null) {
      knownHistoryKeys = new Set(readHistoryEvents({ stateRoot }).map((event) => event.associationKey));
    }
    const events = diffSnapshots(previous, next, { now: new Date(), knownKeys: knownHistoryKeys });
    if (!events.length) return;
    for (const event of events) knownHistoryKeys.add(event.associationKey);
    appendHistoryEvents(events, {
      stateRoot,
      retentionDays: settings?.preferences?.historyRetentionDays,
    });
  } catch {
    // History unavailable (unwritable state dir, corrupt file) — discovery continues unaffected.
  }
}

function displayNameForProject(project) {
  const id = project.repositoryId || "";
  if (id.startsWith("git:")) return id.split("/").pop() || id;
  // local: id — fall back to the last path segment of the resolved root when available.
  const root = project.projectRoot;
  if (typeof root === "string" && root) return root.replace(/\/+$/, "").split("/").pop() || "repository";
  return "repository";
}

function scheduleRefresh() {
  if (!inFlightRefresh) refreshLocalhosterSnapshot().catch(() => {});
}

function buildSnapshot({ discovery, settings = loadSettings({ stateRoot }), refresh = { state: "idle", startedAt: null, error: null }, now = new Date() }) {
  return buildLocalhosterSnapshot({ discovery, settings, refresh, now });
}

function withRefreshState(snapshot) {
  if (!inFlightRefresh) return snapshot;
  return { ...snapshot, refresh: { state: "refreshing", startedAt: snapshot.refresh?.startedAt || new Date().toISOString(), error: null } };
}

function emptyDiscovery() {
  return { capabilities: capabilityForPlatform(process.platform), warnings: [], instances: [portalInstance()].filter(Boolean) };
}

function snapshotDiscovery(snapshot) {
  if (!snapshot) return emptyDiscovery();
  return {
    capabilities: snapshot.capabilities,
    warnings: snapshot.warnings || [],
    instances: [
      ...snapshot.projects.flatMap((project) => project.instances || []),
      ...(snapshot.unmatchedInstances || []),
    ],
  };
}

// Git context for roborepo's own checkout, refreshed alongside every discovery pass. The portal is
// synthesized rather than discovered, so it has no probed cwd to resolve a repository from — appRoot
// is the honest answer and the only one available. Cached because portalInstance() is called from
// sync paths (setLocalhosterPortalInfo, emptyDiscovery) that cannot await a subprocess.
//
// undefined means "never collected" (git context omitted); null means collected and unavailable,
// which is what a package-mode install with no .git correctly reports.
let portalGit;

// Canonical repository fields for appRoot, resolved once. Same sync-caller constraint as portalGit,
// but this is pure filesystem inspection rather than a subprocess, so it is computed lazily on
// first use instead of needing its own refresh hook.
let portalRepositoryCache;
function portalRepositoryFields() {
  if (portalRepositoryCache === undefined) {
    try {
      const resolved = resolveProjectIdentity(appRoot, "roborepo");
      portalRepositoryCache = {
        repositoryId: canonicalRepositoryId(resolved),
        rootId: resolved.projectRoot ? computeRootId(resolved.projectRoot) : null,
      };
    } catch {
      portalRepositoryCache = { repositoryId: null, rootId: null };
    }
  }
  return portalRepositoryCache;
}

async function refreshPortalGit() {
  try {
    portalGit = await collectGitContext(appRoot);
  } catch {
    // A failed collection must not cost us the refresh — the card simply renders without a badge.
    portalGit = null;
  }
}

function portalInstance() {
  const port = portalInfo?.port || null;
  if (!port) return null;
  const origin = port ? `http://127.0.0.1:${port}` : null;
  return {
    key: "roborepo-portal",
    associationKey: "roborepo-portal",
    matchSignature: { key: "roborepo-portal", projectIdentity: "roborepo:portal", relativeCwd: null, command: "roborepo", title: "RoboRepo Portal" },
    origin,
    alternateOrigins: [],
    bind: { address: "127.0.0.1", port, scope: "loopback", warning: null },
    status: 200,
    latencyMs: 0,
    protocol: "http",
    title: "RoboRepo Portal",
    // Synthesized rather than classified: the portal is the process doing the asking, so it is
    // healthy by construction and never probed. A static record keeps it out of the history diff's
    // healthTransition path instead of flapping between null and a state.
    health: { state: "healthy", reason: null, consecutiveFailures: 0, since: null, firstSeenAt: null, lastProbeAt: null },
    process: { pid: process.pid, command: "roborepo" },
    project: {
      identity: "roborepo:portal",
      identityKind: "roborepo",
      confidence: "high",
      projectRoot: appRoot,
      evidence: "built-in portal",
      git: portalGit ?? null,
      // The synthetic identity above is deliberately not a git: identity — "roborepo:portal" names
      // the portal app, not the repository it ships from. But the checkout underneath appRoot is a
      // real repository, so its canonical id is resolved separately here; without it the portal was
      // the one card that could never link to its own remote and always fell back to "local repo".
      // Null in a package-mode install with no .git, exactly like any other non-repo root.
      ...portalRepositoryFields(),
    },
  };
}

function isPortalDuplicate(instance, portal) {
  return instance.process?.pid === portal.process.pid && instance.bind?.port === portal.bind.port;
}

function statusLabel(instance) {
  if (instance.tls === "untrusted") return "TLS untrusted";
  return instance.status ? `HTTP ${instance.status}` : "unknown";
}

function padRow(row, widths) {
  return row.map((cell, i) => cell.padEnd(widths[i])).join("  ");
}

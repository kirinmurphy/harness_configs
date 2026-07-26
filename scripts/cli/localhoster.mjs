import { stateRoot } from "./paths.mjs";
import {
  buildLocalhosterSnapshot,
  capabilityForPlatform,
  defaultSettings,
  discoverInstances,
  findCurrentInstanceByOpaqueKey,
  loadSettings,
  updateSettings,
} from "../../modules/localhoster/index.mjs";
import { recordRepositoryDiscovery } from "./repositories.mjs";

const FRESHNESS_MS = 8000;

let lastSnapshot = null;
let inFlightRefresh = null;
let refreshGeneration = 0;
let portalInfo = null;

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
      const discovery = await discoverInstances({ settings });
      if (generation !== refreshGeneration && lastSnapshot) return withRefreshState(lastSnapshot);
      const portal = portalInstance();
      if (portal) {
        discovery.instances = discovery.instances.filter((instance) => !isPortalDuplicate(instance, portal));
        discovery.instances.unshift(portal);
      }
      recordDiscoveredRepositories(discovery.instances);
      lastSnapshot = buildSnapshot({ discovery, settings, refresh: { state: "idle", startedAt: null, error: null, generation } });
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

export function loadLocalhosterHistory(key) {
  const instance = findCurrentInstanceByOpaqueKey(loadLocalhosterSnapshot(), key);
  if (!instance) return { ok: false, status: 404, error: "unknown localhoster key" };
  return {
    ok: true,
    key,
    app: instance.app ? { id: instance.app.id, name: instance.app.name } : null,
    events: [],
    deferred: "History JSONL is split into the localhoster-git-health-history backlog plan.",
  };
}

export function loadLocalhosterMetadata(key) {
  const instance = findCurrentInstanceByOpaqueKey(loadLocalhosterSnapshot(), key);
  if (!instance) return { ok: false, status: 404, error: "unknown localhoster key" };
  return {
    ok: true,
    key,
    origin: instance.origin,
    suggestions: [],
    deferred: "Metadata suggestions are split into the localhoster-metadata-suggestions backlog plan.",
  };
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
        stateRoot,
      });
    } catch {
      // Registry unavailable/corrupt — Localhoster keeps working; the failure surfaces elsewhere
      // (Phase 4 reports registry errors as a structured health finding).
    }
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
    process: { pid: process.pid, command: "roborepo" },
    project: { identity: "roborepo:portal", identityKind: "roborepo", confidence: "high", projectRoot: null, evidence: "built-in portal" },
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

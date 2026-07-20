import path from "node:path";
import { defaultSettings } from "./settings.mjs";

export function buildLocalhosterSnapshot({
  discovery,
  settings = defaultSettings(),
  now = new Date(),
  refresh = { state: "idle", startedAt: null, error: null },
} = {}) {
  const activeByProject = new Map();
  const unmatchedInstances = [];
  const seenApps = new Set();
  const identityCounts = countIdentities(discovery.instances || []);

  for (const instance of discovery.instances || []) {
    const projectIdentity = instance.project.identity;
    const association = settings.associations[instance.associationKey];
    const provisionalApp = identityCounts.get(projectIdentity) === 1 && (instance.project.confidence === "high" || instance.project.confidence === "medium");
    const appId = association?.appId || (provisionalApp ? "web" : null);
    if (!appId) {
      unmatchedInstances.push(instance);
      continue;
    }
    const effectiveIdentity = association?.projectIdentity || projectIdentity;
    const projectSettings = settings.projects[effectiveIdentity] || { apps: {} };
    const appSettings = projectSettings.apps?.[appId] || {};
    const project = ensureProject(activeByProject, effectiveIdentity, projectSettings, instance);
    project.instances.push({
      ...instance,
      app: {
        id: appId,
        name: appSettings.name || labelFromId(appId),
        links: (appSettings.links || []).map((link) => ({ ...link, url: instance.origin ? `${instance.origin}${link.path}` : link.path })),
        originPreference: appSettings.originPreference || "localhost",
      },
    });
    seenApps.add(`${effectiveIdentity}#${appId}`);
  }

  const inactiveProjects = [];
  for (const [identity, project] of Object.entries(settings.projects || {})) {
    for (const [appId, app] of Object.entries(project.apps || {})) {
      if (!seenApps.has(`${identity}#${appId}`)) {
        inactiveProjects.push({
          identity,
          name: project.name || inferredName(identity),
          app: {
            id: appId,
            name: app.name || labelFromId(appId),
            links: app.links || [],
            originPreference: app.originPreference || "localhost",
          },
        });
      }
    }
  }

  return {
    generatedAt: toIso(now),
    refresh,
    settingsRevision: settings.revision,
    capabilities: discovery.capabilities,
    warnings: discovery.warnings || [],
    projects: [...activeByProject.values()].sort(compareProjects).map(sortProject),
    unmatchedInstances: unmatchedInstances.sort(compareInstances),
    inactiveProjects: inactiveProjects.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function countIdentities(instances) {
  const counts = new Map();
  for (const instance of instances) {
    const identity = instance.project?.identity;
    if (!identity) continue;
    counts.set(identity, (counts.get(identity) || 0) + 1);
  }
  return counts;
}

function ensureProject(map, identity, settings, instance) {
  if (!map.has(identity)) {
    map.set(identity, {
      identity,
      name: settings.name || inferredName(identity, instance.project.projectRoot),
      identityKind: instance.project.identityKind,
      confidence: instance.project.confidence,
      evidence: instance.project.evidence,
      instances: [],
    });
  }
  return map.get(identity);
}

function sortProject(project) {
  project.instances = project.instances.sort(compareInstances);
  return project;
}

function compareProjects(a, b) {
  return a.name.localeCompare(b.name) || a.identity.localeCompare(b.identity);
}

function compareInstances(a, b) {
  return (a.app?.name || "").localeCompare(b.app?.name || "") || a.bind.port - b.bind.port;
}

function inferredName(identity, projectRoot = null) {
  if (identity.startsWith("git:")) return identity.split("/").at(-1) || identity;
  if (identity.startsWith("path:")) return path.basename(identity.slice("path:".length));
  if (projectRoot) return path.basename(projectRoot);
  return identity.split(":").at(-1) || identity;
}

function labelFromId(value) {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (s) => s.toUpperCase());
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

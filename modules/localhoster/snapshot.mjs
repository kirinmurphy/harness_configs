import { createHash } from "node:crypto";
import path from "node:path";
import { defaultSettings, resolveProjectAlias } from "./settings.mjs";

export function buildLocalhosterSnapshot({
  discovery,
  settings = defaultSettings(),
  now = new Date(),
  refresh = { state: "idle", startedAt: null, error: null },
} = {}) {
  const activeByProject = new Map();
  const unmatchedInstances = [];
  const seenApps = new Set();
  let hiddenCount = 0;
  const shapeGroups = groupByIdentityShape(discovery.instances || []);

  for (const instance of discovery.instances || []) {
    const projectIdentity = resolveProjectAlias(settings, instance.project.identity);
    const association = settings.associations[instance.associationKey];
    // A single distinct "shape" (same title + cwd) under this identity is treated as one app slot
    // even if it has multiple listeners — those extra listeners are near-certainly redundant
    // processes (e.g. two different static-file-server tools pointed at the same directory), not
    // separate services. Two or more genuinely different shapes under one identity still can't be
    // auto-assigned, since there's no reliable way to guess which one is "the" app.
    const shapeKey = instanceShapeKey(instance);
    const group = shapeGroups.get(instance.project.identity);
    const provisionalApp = group?.shapes.size === 1 && (instance.project.confidence === "high" || instance.project.confidence === "medium");
    const appId = association?.appId || (provisionalApp ? "web" : null);
    if (!appId) {
      unmatchedInstances.push(withOpaqueKey(instance, projectIdentity, null));
      continue;
    }
    const effectiveIdentity = resolveProjectAlias(settings, association?.projectIdentity || projectIdentity);
    const projectSettings = settings.projects[effectiveIdentity] || { apps: {} };
    const appSettings = projectSettings.apps?.[appId] || {};
    if (projectSettings.hidden || appSettings.hidden) {
      hiddenCount += 1;
      seenApps.add(`${effectiveIdentity}#${appId}`);
      continue;
    }
    const duplicates = group?.byShape.get(shapeKey) || [];
    // Only the first same-shape instance we encounter becomes the visible card; later duplicates
    // stay out of the rendered list but still contribute their port to duplicatePorts below.
    if (duplicates[0] !== instance) continue;
    const project = ensureProject(activeByProject, effectiveIdentity, projectSettings, instance);
    project.instances.push(withOpaqueKey({
      ...instance,
      duplicatePorts: duplicates.length > 1 ? duplicates.map((dup) => dup.bind.port) : [],
      app: {
        id: appId,
        name: appSettings.name || labelFromId(appId),
        favorite: appSettings.favorite === true,
        hidden: appSettings.hidden === true,
        links: (appSettings.links || []).map((link) => ({ ...link, url: instance.origin ? `${instance.origin}${link.path}` : link.path })),
        originPreference: appSettings.originPreference || "localhost",
        health: appSettings.health || {},
        match: appSettings.match || {},
      },
    }, effectiveIdentity, appId));
    seenApps.add(`${effectiveIdentity}#${appId}`);
  }

  const inactiveProjects = [];
  for (const [identity, project] of Object.entries(settings.projects || {})) {
    if (project.hidden) {
      hiddenCount += Object.keys(project.apps || {}).length;
      continue;
    }
    for (const [appId, app] of Object.entries(project.apps || {})) {
      if (seenApps.has(`${identity}#${appId}`)) continue;
      if (app.hidden) {
        hiddenCount += 1;
        continue;
      }
      inactiveProjects.push({
        identity,
        name: project.name || inferredName(identity),
        favorite: project.favorite === true || app.favorite === true,
        hidden: false,
        app: {
          id: appId,
          name: app.name || labelFromId(appId),
          favorite: app.favorite === true,
          hidden: false,
          links: app.links || [],
          originPreference: app.originPreference || "localhost",
          health: app.health || {},
          match: app.match || {},
        },
      });
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
    inactiveProjects: inactiveProjects.sort(compareProjects),
    hiddenCount,
    settings: settingsSummary(settings),
  };
}

export function findCurrentInstanceByOpaqueKey(snapshot, opaqueKey) {
  if (!opaqueKey) return null;
  for (const instance of [
    ...(snapshot?.projects || []).flatMap((project) => project.instances || []),
    ...(snapshot?.unmatchedInstances || []),
  ]) {
    if (instance.opaqueKey === opaqueKey) return instance;
  }
  return null;
}

// Groups instances by project identity, then by "shape" (same page title + same relative cwd)
// within that identity. Two instances with the same shape are treated as duplicate listeners for
// one app, not two different apps — see the auto-promotion comment above for why that matters.
function groupByIdentityShape(instances) {
  const groups = new Map();
  for (const instance of instances) {
    const identity = instance.project?.identity;
    if (!identity) continue;
    if (!groups.has(identity)) groups.set(identity, { shapes: new Set(), byShape: new Map() });
    const group = groups.get(identity);
    const shapeKey = instanceShapeKey(instance);
    group.shapes.add(shapeKey);
    if (!group.byShape.has(shapeKey)) group.byShape.set(shapeKey, []);
    group.byShape.get(shapeKey).push(instance);
  }
  return groups;
}

// No title means there's nothing reliable to compare, so an untitled instance never counts as a
// duplicate of anything else — each gets its own unique key instead of silently grouping under a
// shared blank title.
function instanceShapeKey(instance) {
  if (!instance.title) return `untitled:${instance.key}`;
  return `${instance.title}::${instance.matchSignature?.relativeCwd ?? ""}`;
}

function ensureProject(map, identity, settings, instance) {
  if (!map.has(identity)) {
    map.set(identity, {
      identity,
      name: settings.name || inferredName(identity, instance.project.projectRoot),
      favorite: settings.favorite === true,
      hidden: settings.hidden === true,
      identityKind: instance.project.identityKind,
      confidence: instance.project.confidence,
      evidence: instance.project.evidence,
      repositoryId: instance.project.repositoryId ?? null,
      rootId: instance.project.rootId ?? null,
      instances: [],
    });
  }
  return map.get(identity);
}

function settingsSummary(settings) {
  const hidden = [];
  for (const [identity, project] of Object.entries(settings.projects || {})) {
    const projectName = project.name || inferredName(identity);
    if (project.hidden) {
      hidden.push({ kind: "project", identity, name: projectName, favorite: project.favorite === true });
    }
    for (const [appId, app] of Object.entries(project.apps || {})) {
      if (!app.hidden) continue;
      hidden.push({
        kind: "app",
        identity,
        name: projectName,
        favorite: project.favorite === true || app.favorite === true,
        app: {
          id: appId,
          name: app.name || labelFromId(appId),
          favorite: app.favorite === true,
          links: app.links || [],
          originPreference: app.originPreference || "localhost",
          health: app.health || {},
          match: app.match || {},
        },
      });
    }
  }
  return {
    aliases: Object.entries(settings.aliases || {}).map(([from, to]) => ({ from, to })),
    associations: Object.entries(settings.associations || {}).map(([key, association]) => ({ key, ...association })),
    hidden,
  };
}

function sortProject(project) {
  project.instances = project.instances.sort(compareInstances);
  return project;
}

function compareProjects(a, b) {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
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

function withOpaqueKey(instance, projectIdentity, appId) {
  return {
    ...instance,
    opaqueKey: opaqueKeyFor({
      associationKey: instance.associationKey,
      projectIdentity,
      appId,
      origin: instance.origin,
    }),
  };
}

function opaqueKeyFor(value) {
  return "lk_" + createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 22);
}

import { createHash } from "node:crypto";
import path from "node:path";
import { defaultSettings, resolveProjectAlias } from "./settings.mjs";
import { providerUrlForRepositoryId } from "../repositories/identity.mjs";

export function buildLocalhosterSnapshot({
  discovery,
  settings = defaultSettings(),
  now = new Date(),
  refresh = { state: "idle", startedAt: null, error: null },
} = {}) {
  const activeByProject = new Map();
  const unmatchedInstances = [];
  const composeProjectsByName = new Map();
  const seenApps = new Set();
  let hiddenCount = 0;
  const shapeGroups = groupByIdentityShape(discovery.instances || []);

  for (const instance of discovery.instances || []) {
    // A Compose-labeled instance has its own resolvable identity — the project that spawned the
    // container — independent of whether lsof/git could resolve a filesystem identity for the
    // host-side listener process. Grouping here first means a Postgres/Traefik/proxy container with
    // low-confidence process identity (the common case: Docker Desktop's `com.docker.backend` fronts
    // every published port) still lands under its real project instead of "Unrecognized listeners".
    if (instance.docker?.composeProject) {
      const projectName = instance.docker.composeProject;
      if (!composeProjectsByName.has(projectName)) {
        const projectSettings = settings.composeProjects?.[projectName] || {};
        const gitInfo = discovery.composeProjectGit?.get(projectName) || null;
        composeProjectsByName.set(projectName, {
          identity: `compose:${projectName}`,
          name: projectSettings.name || projectName,
          favorite: projectSettings.favorite === true,
          hidden: projectSettings.hidden === true,
          repoPath: projectSettings.repoPath || null,
          git: gitInfo?.git || null,
          repositoryId: gitInfo?.repositoryId || null,
          // "manual" when settings.composeProjects[name].repoPath was set and used, "auto" when
          // resolveIdentity instead ran against the working_dir label from `docker ps`, null when
          // neither resolved (e.g. a compose project with no git repo at all).
          resolvedFrom: gitInfo?.resolvedFrom || null,
          providerUrl: gitInfo?.repositoryId ? providerUrlForRepositoryId(gitInfo.repositoryId) : null,
          instances: [],
        });
      }
      const project = composeProjectsByName.get(projectName);
      if (project.hidden) {
        hiddenCount += 1;
        continue;
      }
      project.instances.push(withOpaqueKey(instance, `compose:${projectName}`, null));
      continue;
    }
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

  const projects = [...activeByProject.values()].sort(compareProjects).map(sortProject);
  const composeProjects = [...composeProjectsByName.values()]
    .map((project) => ({ ...project, containers: groupByContainer(project.instances) }))
    .sort(compareProjects);

  return {
    generatedAt: toIso(now),
    refresh,
    settingsRevision: settings.revision,
    capabilities: discovery.capabilities,
    warnings: discovery.warnings || [],
    projects,
    composeProjects,
    unmatchedInstances: unmatchedInstances.sort(compareInstances),
    // Repository-keyed view over the same instances the three collections above hold. Built
    // alongside them during the migration (localhoster-repository-card-merge) so existing consumers
    // keep working while the portal moves over; the legacy three are removed once nothing reads them.
    repositories: buildRepositories({ projects, composeProjects, unmatchedInstances }),
    inactiveProjects: inactiveProjects.sort(compareProjects),
    hiddenCount,
    settings: settingsSummary(settings),
  };
}

export function findCurrentInstanceByOpaqueKey(snapshot, opaqueKey) {
  if (!opaqueKey) return null;
  for (const instance of [
    ...(snapshot?.projects || []).flatMap((project) => project.instances || []),
    ...(snapshot?.composeProjects || []).flatMap((project) => project.containers.flatMap((c) => c.instances)),
    ...(snapshot?.unmatchedInstances || []),
  ]) {
    if (instance.opaqueKey === opaqueKey) return instance;
  }
  return null;
}

// One row per container, not one per published port — a single Traefik/Postgres container that
// publishes several host ports (e.g. 80/443/8080 on one proxy) is one operational unit, and
// showing it as three identical-looking rows misrepresents it as three containers.
function groupByContainer(instances) {
  const byContainer = new Map();
  for (const instance of instances) {
    const containerId = instance.docker.containerId;
    if (!byContainer.has(containerId)) {
      byContainer.set(containerId, {
        containerId,
        name: instance.docker.composeService || instance.docker.name,
        image: instance.docker.image,
        state: instance.docker.state,
        instances: [],
      });
    }
    byContainer.get(containerId).instances.push(instance);
  }
  return [...byContainer.values()]
    .map((container) => ({ ...container, instances: container.instances.sort(compareInstances) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// One card per repository, merging what the three legacy collections split by discovery mechanism.
// A repository that runs a Compose stack, a dev server, and a tunnel previously produced three
// unrelated cards in three sections; they share a repositoryId and belong together.
//
// Only a real repositoryId groups. `process:` identities resolve to null (canonicalRepositoryId
// returns null for them — no repository exists to be a member of) and stay unmatched, as do
// Compose projects whose repo never resolved.
function buildRepositories({ projects, composeProjects, unmatchedInstances }) {
  const byRepository = new Map();

  const ensure = (repositoryId, source) => {
    if (!byRepository.has(repositoryId)) {
      byRepository.set(repositoryId, {
        repositoryId,
        // git: ids are portable across machines and promotable to other pages; local: ids are
        // stable but path-derived, so they stay on this surface only.
        identityKind: repositoryId.startsWith("git:") ? "git" : "local",
        providerUrl: providerUrlForRepositoryId(repositoryId),
        name: source.name,
        favorite: false,
        git: null,
        composeGroups: [],
        members: [],
      });
    }
    return byRepository.get(repositoryId);
  };

  for (const project of projects) {
    if (!project.repositoryId) continue;
    const entry = ensure(project.repositoryId, project);
    entry.favorite = entry.favorite || project.favorite === true;
    entry.git = entry.git || project.git || null;
    for (const instance of project.instances) {
      entry.members.push(toMember(instance, project.identity));
    }
  }

  for (const composeProject of composeProjects) {
    if (!composeProject.repositoryId) continue;
    const entry = ensure(composeProject.repositoryId, composeProject);
    entry.favorite = entry.favorite || composeProject.favorite === true;
    entry.git = entry.git || composeProject.git || null;
    // A Compose stack is one deploy unit — `docker compose down` stops every container at once —
    // so it stays a named sub-group rather than flattening 11 Supabase containers into the member
    // list ahead of the single dev server the user actually cares about.
    // Carries the whole compose-project record (plus its own aggregate) so the portal renders the
    // sub-group with the same card it used when this was a top-level entry.
    entry.composeGroups.push({
      ...composeProject,
      cpuPercentOfHost: sumCpuPercentOfHost(composeProject.instances),
    });
  }

  for (const instance of unmatchedInstances) {
    const repositoryId = instance.project?.repositoryId;
    if (!repositoryId) continue;
    const entry = ensure(repositoryId, {
      name: inferredName(instance.project.identity, instance.project.projectRoot),
    });
    entry.git = entry.git || instance.project.git || null;
    entry.members.push(toMember(instance, instance.project.identity));
  }

  for (const entry of byRepository.values()) {
    entry.members = collapseByPid(entry.members);
    entry.duplicateGroups = findStaleDuplicates(entry.members);
    entry.members.sort(compareMembers);
    entry.composeGroups.sort((a, b) => a.name.localeCompare(b.name));
    // Every member counts toward the aggregate today. Tool processes that resolve to a repository
    // only by inherited working directory (a tunnel, a stray `npx`) arguably should not — their CPU
    // tracks their own traffic, not application load — but no field currently separates them from a
    // real dev server: on live data ngrok and a Next.js server agree on probe status, title,
    // identity, confidence, and relative cwd, differing only in process command name. Excluding them
    // needs a real signal rather than a name list; see the plan doc's open questions.
    entry.cpuPercentOfHost = sumValues([
      ...entry.composeGroups.map((group) => group.cpuPercentOfHost),
      ...entry.members.map((member) => member.cpuPercentOfHost),
    ]);
  }

  return [...byRepository.values()].sort(compareRepositories);
}

// One process listening on several ports is one member, not several. A dev server commonly binds a
// main port plus an HMR/websocket port; rendering those as sibling members overstated what was
// running (localhostr_web showed three "members" that were two processes). PID is exact here — no
// heuristic needed — so the extra ports become metadata on the surviving member.
//
// The survivor is the port that answered with a page title: that is the one a user opens, and the
// untitled siblings are the infrastructure ports behind it.
function collapseByPid(members) {
  const byPid = new Map();
  const collapsed = [];
  for (const member of members) {
    // Containers are already one row per container upstream, and Docker's published ports do not
    // share a host PID the way a dev server's do.
    const pid = member.kind === "listener" ? member.instance?.process?.pid : null;
    if (pid == null) {
      collapsed.push(member);
      continue;
    }
    if (!byPid.has(pid)) {
      byPid.set(pid, { primary: member, siblings: [] });
      collapsed.push(member);
      continue;
    }
    const group = byPid.get(pid);
    // Prefer a titled port as the visible member; otherwise keep the lowest-numbered one, which is
    // conventionally the primary bind.
    const incomingWins = isEntrypoint(member) && !isEntrypoint(group.primary);
    const loser = incomingWins ? group.primary : member;
    if (incomingWins) {
      collapsed[collapsed.indexOf(group.primary)] = member;
      group.primary = member;
    }
    group.siblings.push(loser);
  }
  for (const { primary, siblings } of byPid.values()) {
    if (!siblings.length) continue;
    // Non-interactive: these are facts about the process, not things to click.
    primary.secondaryPorts = siblings
      .map((sibling) => sibling.port)
      .sort((a, b) => a - b);
  }
  return collapsed;
}

// A port that answered the HTTP probe with a page title is user-facing; an untitled one is an API,
// a socket, or a service another process talks to. This is what separates menugoats' web app from
// its Supabase containers without naming either.
function isEntrypoint(member) {
  return Boolean(member.instance?.title);
}

// Stale duplicates are already detected upstream: same-shape instances under one identity are
// collapsed to a single visible card and their ports recorded on `duplicatePorts` (see the
// duplicate handling around the shape-group pass). This surfaces that existing signal at repository
// level so the merged card can warn once, rather than re-deriving it.
//
// Note this is a different condition from collapseByPid: that folds ONE process holding several
// ports (normal — a dev server plus its HMR socket), while this reports SEVERAL processes serving
// the same thing (a leftover you probably want to kill).
function findStaleDuplicates(members) {
  const groups = [];
  for (const member of members) {
    const ports = member.instance?.duplicatePorts || [];
    if (ports.length > 1) {
      groups.push({ name: member.name, ports: [...ports].sort((a, b) => a - b) });
    }
  }
  return groups;
}

function toMember(instance, projectIdentity) {
  return {
    kind: instance.docker ? "container" : "listener",
    projectIdentity,
    // Whether this port is something a user opens (it answered with a page title) or infrastructure
    // behind one. Drives which members get a permanent, always-visible slot on the card.
    entrypoint: Boolean(instance.title),
    // Other ports held by the same process, shown as metadata rather than as separate members.
    secondaryPorts: [],
    // The full instance record, so the portal can render a member with the same card it always
    // used — merging regroups instances, it does not change what an instance is.
    instance,
    opaqueKey: instance.opaqueKey,
    associationKey: instance.associationKey,
    name: memberName(instance),
    port: instance.bind.port,
    origin: instance.origin,
    status: instance.status,
    health: instance.health,
    docker: instance.docker,
    app: instance.app ?? null,
    // Percent of the whole machine, not of one core. `docker stats` reports CPU relative to a single
    // core, which is not summable across containers — cpuPercentOfHost is the normalized field, and
    // summing the raw per-core value produced meaningless totals (161% for one 11-container project).
    cpuPercentOfHost: instance.processMetrics?.cpuPercentOfHost ?? null,
    residentMemoryKb: instance.processMetrics?.residentMemoryKb ?? null,
  };
}

function memberName(instance) {
  return instance.app?.name
    || instance.docker?.composeService
    || instance.docker?.name
    || instance.title
    || instance.process?.command
    || `Port ${instance.bind.port}`;
}

function sumCpuPercentOfHost(instances) {
  return sumValues(instances.map((instance) => instance.processMetrics?.cpuPercentOfHost ?? null));
}

// Null when nothing reported a usable number, so an unmeasured card renders as "unknown" rather
// than claiming a confident 0%.
function sumValues(values) {
  const present = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!present.length) return null;
  return present.reduce((total, value) => total + value, 0);
}

// Entrypoints first: the point of the card is that opening the app is one click from page load, so
// the ports a user actually visits must never sort below infrastructure.
function compareMembers(a, b) {
  if (a.entrypoint !== b.entrypoint) return a.entrypoint ? -1 : 1;
  return a.name.localeCompare(b.name) || a.port - b.port;
}

// Favorites first, then portable git-backed repositories ahead of path-derived local ones. Offline
// ordering within a group is unchanged — it still falls out of the member sort.
function compareRepositories(a, b) {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
  if (a.identityKind !== b.identityKind) return a.identityKind === "git" ? -1 : 1;
  return a.name.localeCompare(b.name) || a.repositoryId.localeCompare(b.repositoryId);
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
      providerUrl: instance.project.repositoryId ? providerUrlForRepositoryId(instance.project.repositoryId) : null,
      rootId: instance.project.rootId ?? null,
      // Git context is per-root, so every instance under one project reports the same value; take it
      // from the first instance that has one rather than duplicating it on each.
      git: instance.project.git ?? null,
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

export function snapshotHash(snapshot) {
  return JSON.stringify({
    revision: snapshot.settingsRevision,
    refresh: snapshot.refresh?.state,
    capabilities: snapshot.capabilities,
    warnings: snapshot.warnings,
    projects: snapshot.projects,
    unmatched: snapshot.unmatchedInstances,
    inactive: snapshot.inactiveProjects,
  });
}

export function filterSnapshot(snapshot, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return snapshot;
  return {
    ...snapshot,
    projects: snapshot.projects
      .map((project) => ({
        ...project,
        instances: project.instances.filter((instance) => matchesInstance(project, instance, needle)),
      }))
      .filter((project) => project.instances.length),
    unmatchedInstances: snapshot.unmatchedInstances.filter((instance) => matchesInstance({ name: "Other instances" }, instance, needle)),
    inactiveProjects: snapshot.inactiveProjects.filter((project) => [project.name, project.identity, project.app?.name].some((value) => includes(value, needle))),
  };
}

export function snapshotCounts(snapshot) {
  const active = snapshot.projects.reduce((sum, project) => sum + project.instances.length, 0);
  return {
    active,
    projects: snapshot.projects.length,
    unmatched: snapshot.unmatchedInstances.length,
    inactive: snapshot.inactiveProjects.length,
  };
}

export function statusText(instance) {
  if (instance.tls === "untrusted") return "TLS untrusted";
  if (instance.status) return `HTTP ${instance.status}`;
  return "Unknown";
}

export function currentLinks(snapshot, projectIdentity, appId) {
  const project = snapshot.projects.find((item) => item.identity === projectIdentity);
  const app = project?.instances.find((instance) => instance.app?.id === appId)?.app;
  if (app) return app.links.map(({ id, label, path }) => ({ id, label, path }));
  const inactive = snapshot.inactiveProjects.find((item) => item.identity === projectIdentity && item.app?.id === appId);
  return inactive?.app?.links || [];
}

function matchesInstance(project, instance, needle) {
  return [
    project.name,
    project.identity,
    instance.app?.name,
    instance.origin,
    instance.title,
    instance.process?.command,
    String(instance.process?.pid || ""),
    String(instance.bind?.port || ""),
    ...(instance.app?.links || []).flatMap((link) => [link.label, link.path]),
  ].some((value) => includes(value, needle));
}

function includes(value, needle) {
  return String(value || "").toLowerCase().includes(needle);
}

export function snapshotHash(snapshot) {
  return JSON.stringify({
    revision: snapshot.settingsRevision,
    refresh: snapshot.refresh?.state,
    capabilities: snapshot.capabilities,
    warnings: snapshot.warnings,
    projects: snapshot.projects,
    unmatched: snapshot.unmatchedInstances,
    inactive: snapshot.inactiveProjects,
    hidden: snapshot.hiddenCount || 0,
    settings: snapshot.settings,
  });
}

const HEALTH_LABELS = {
  healthy: "Healthy",
  degraded: "Degraded",
  unhealthy: "Unhealthy",
  starting: "Starting",
  unknown: "Unknown",
  inactive: "Inactive",
};

// The normalized health state is the headline; the raw HTTP code moves to the tooltip detail below,
// since "Healthy" answers the question a dashboard is actually asked.
export function statusText(instance) {
  const state = instance.health?.state;
  if (state && HEALTH_LABELS[state]) return HEALTH_LABELS[state];
  if (instance.tls === "untrusted") return "TLS untrusted";
  if (instance.status) return `HTTP ${instance.status}`;
  return "Unknown";
}

export function statusDetail(instance) {
  const parts = [];
  if (instance.tls === "untrusted") parts.push("TLS untrusted");
  else if (instance.status) parts.push(`HTTP ${instance.status}`);
  if (instance.health?.reason) parts.push(instance.health.reason.replace(/-/g, " "));
  return parts.join(" · ") || "no probe result";
}

export function healthState(instance) {
  return instance.health?.state || null;
}

export function currentLinks(snapshot, projectIdentity, appId) {
  const app = currentAppSettings(snapshot, projectIdentity, appId);
  return app?.links?.map(({ id, label, path }) => ({ id, label, path })) || [];
}

export function currentProjectSettings(snapshot, projectIdentity) {
  const project = snapshot.projects.find((item) => item.identity === projectIdentity);
  if (project) return project;
  const inactive = snapshot.inactiveProjects.find((item) => item.identity === projectIdentity);
  if (inactive) return inactive;
  const hidden = snapshot.settings?.hidden?.find((item) => item.identity === projectIdentity);
  return hidden || null;
}

export function currentAppSettings(snapshot, projectIdentity, appId) {
  const project = snapshot.projects.find((item) => item.identity === projectIdentity);
  const app = project?.instances.find((instance) => instance.app?.id === appId)?.app;
  if (app) return app;
  const inactive = snapshot.inactiveProjects.find((item) => item.identity === projectIdentity && item.app?.id === appId);
  if (inactive?.app) return inactive.app;
  const hidden = snapshot.settings?.hidden?.find((item) => item.identity === projectIdentity && item.app?.id === appId);
  return hidden?.app || null;
}

export function csvList(value) {
  if (!Array.isArray(value)) return "";
  return value.join(", ");
}

export function parseCsvList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}


export const SETTINGS_VERSION = 2;
export const LEGACY_SETTINGS_VERSION = 1;
export const DEFAULT_PREFERENCES = { showNonHttp: false, historyRetentionDays: 14 };

export function defaultSettings() {
  return { version: SETTINGS_VERSION, revision: 1, projects: {}, associations: {}, aliases: {}, preferences: { ...DEFAULT_PREFERENCES } };
}

export function normalizeRoutePath(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("link path must be a local path or loopback URL");
  }
  if (value.startsWith("//")) throw new Error("protocol-relative URLs are not allowed");
  if (value.startsWith("/")) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("link path must begin with /");
  }
  if (url.username || url.password) throw new Error("credentials are not allowed in link URLs");
  if (!["http:", "https:"].includes(url.protocol) || !isLoopbackHost(url.hostname)) {
    throw new Error("link URL host must be loopback");
  }
  return `${url.pathname || "/"}${url.search}${url.hash}`;
}

export function validateSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("settings must be an object");
  const keys = Object.keys(settings).sort();
  const allowed = ["aliases", "associations", "preferences", "projects", "revision", "version"];
  for (const key of keys) {
    if (!allowed.includes(key)) throw new Error(`unknown localhoster settings field: ${key}`);
  }
  if (settings.version !== SETTINGS_VERSION) throw new Error(`unsupported localhoster settings version: ${settings.version}`);
  if (!Number.isInteger(settings.revision) || settings.revision < 1) throw new Error("settings revision must be a positive integer");
  validateProjects(settings.projects);
  validateAssociations(settings.associations);
  validateAliases(settings.aliases);
  validatePreferences(settings.preferences);
  return settings;
}

export function validateLegacySettings(settings) {
  validateObjectKeys(settings, ["associations", "projects", "revision", "version"], "localhoster settings");
  if (!Number.isInteger(settings.revision) || settings.revision < 1) throw new Error("settings revision must be a positive integer");
  validateProjects(settings.projects);
  validateAssociations(settings.associations);
}

export function resolveProjectAlias(settings, identity) {
  let current = safeIdentity(identity);
  const seen = new Set([current]);
  for (;;) {
    const next = settings?.aliases?.[current];
    if (!next) return current;
    if (seen.has(next)) throw new Error("settings aliases must not contain cycles");
    seen.add(next);
    current = next;
  }
}

export function assertAliasGraph(aliases) {
  for (const identity of Object.keys(aliases)) {
    const seen = new Set([identity]);
    let next = aliases[identity];
    while (next) {
      if (seen.has(next)) throw new Error("settings aliases must not contain cycles");
      seen.add(next);
      next = aliases[next];
    }
  }
}

export function normalizeHealth(health) {
  validateHealth(health);
  return {
    ...(health.path != null ? { path: normalizeRoutePath(health.path) } : {}),
    ...(health.acceptedStatuses != null ? { acceptedStatuses: [...health.acceptedStatuses] } : {}),
  };
}

export function normalizeMatch(match) {
  validateMatch(match);
  return Object.fromEntries(Object.entries(match).map(([key, values]) => [key, values.map((value) => value.trim().slice(0, 120))]));
}

export function safeIdentity(value) {
  if (typeof value !== "string" || !/^(git|path|process|roborepo):/.test(value)) throw new Error("invalid project identity");
  return value;
}

export function safeId(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value)) throw new Error("invalid id");
  return value;
}

export function safeLabel(value, label) {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} is invalid`);
  return value.trim().slice(0, 80);
}

export function safeBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

export function validateObjectKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`unknown ${label} field: ${key}`);
  }
}

export function slugify(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export function labelFromId(value) {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (s) => s.toUpperCase());
}

function validateProjects(projects) {
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) throw new Error("settings projects must be an object");
  for (const [identity, project] of Object.entries(projects)) {
    safeIdentity(identity);
    if (!project || typeof project !== "object" || Array.isArray(project)) throw new Error("settings project must be an object");
    validateObjectKeys(project, ["apps", "favorite", "hidden", "name"], "settings project");
    if (project.name != null) safeLabel(project.name, "project name");
    if (project.favorite != null) safeBoolean(project.favorite, "project favorite");
    if (project.hidden != null) safeBoolean(project.hidden, "project hidden");
    if (!project.apps || typeof project.apps !== "object" || Array.isArray(project.apps)) throw new Error("settings project apps must be an object");
    for (const [appId, app] of Object.entries(project.apps)) validateApp(appId, app);
  }
}

function validateApp(appId, app) {
  safeId(appId);
  if (!app || typeof app !== "object" || Array.isArray(app)) throw new Error("settings app must be an object");
  validateObjectKeys(app, ["favorite", "health", "hidden", "links", "match", "name", "originPreference"], "settings app");
  if (app.name != null) safeLabel(app.name, "app name");
  if (app.favorite != null) safeBoolean(app.favorite, "app favorite");
  if (app.hidden != null) safeBoolean(app.hidden, "app hidden");
  if (app.originPreference != null && !["localhost", "127.0.0.1", "::1"].includes(app.originPreference)) throw new Error("invalid origin preference");
  if (!Array.isArray(app.links)) throw new Error("settings app links must be an array");
  const seen = new Set();
  for (const link of app.links) {
    const id = safeId(link.id);
    if (seen.has(id)) throw new Error(`duplicate link id: ${id}`);
    seen.add(id);
    safeLabel(link.label, "link label");
    normalizeRoutePath(link.path);
  }
  if (app.match != null) validateMatch(app.match);
  if (app.health != null) validateHealth(app.health);
}

function validateHealth(health) {
  if (!health || typeof health !== "object" || Array.isArray(health)) throw new Error("settings app health must be an object");
  validateObjectKeys(health, ["acceptedStatuses", "path"], "settings app health");
  if (health.path != null) normalizeRoutePath(health.path);
  if (health.acceptedStatuses != null) {
    if (!Array.isArray(health.acceptedStatuses) || !health.acceptedStatuses.every((status) => Number.isInteger(status) && status >= 100 && status <= 599)) {
      throw new Error("settings app health acceptedStatuses must contain HTTP status codes");
    }
  }
}

function validateMatch(match) {
  if (!match || typeof match !== "object" || Array.isArray(match)) throw new Error("settings app match must be an object");
  validateObjectKeys(match, ["path", "process", "title"], "settings app match");
  for (const [key, values] of Object.entries(match)) {
    if (!Array.isArray(values) || !values.every((value) => typeof value === "string" && value.trim() && !/[\u0000-\u001f\u007f]/.test(value))) {
      throw new Error(`settings app match ${key} must be an array of strings`);
    }
  }
}

function validateAssociations(associations) {
  if (!associations || typeof associations !== "object" || Array.isArray(associations)) {
    throw new Error("settings associations must be an object");
  }
  for (const [key, association] of Object.entries(associations)) {
    safeId(key);
    if (!association || typeof association !== "object" || Array.isArray(association)) throw new Error("settings association must be an object");
    validateObjectKeys(association, ["appId", "projectIdentity"], "settings association");
    safeIdentity(association.projectIdentity);
    safeId(association.appId);
  }
}

function validateAliases(aliases) {
  if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) throw new Error("settings aliases must be an object");
  for (const [from, to] of Object.entries(aliases)) {
    safeIdentity(from);
    safeIdentity(to);
    if (from === to) throw new Error("alias cannot point to itself");
  }
  assertAliasGraph(aliases);
}

function validatePreferences(preferences) {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) throw new Error("settings preferences must be an object");
  validateObjectKeys(preferences, ["historyRetentionDays", "showNonHttp"], "settings preferences");
  if (typeof preferences.showNonHttp !== "boolean") throw new Error("settings showNonHttp preference must be boolean");
  if (!Number.isInteger(preferences.historyRetentionDays) || preferences.historyRetentionDays < 1 || preferences.historyRetentionDays > 365) {
    throw new Error("settings historyRetentionDays preference must be between 1 and 365");
  }
}

function isLoopbackHost(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const SETTINGS_VERSION = 1;

export function settingsPathFor(stateRoot) {
  return path.join(stateRoot, "localhoster", "settings.json");
}

export function defaultSettings() {
  return { version: SETTINGS_VERSION, revision: 1, projects: {}, associations: {} };
}

export function loadSettings({ stateRoot, fsApi = fs } = {}) {
  const filePath = settingsPathFor(stateRoot);
  try {
    return validateSettings(JSON.parse(fsApi.readFileSync(filePath, "utf8")));
  } catch (err) {
    if (err && err.code === "ENOENT") return defaultSettings();
    if (err instanceof SyntaxError) throw new Error("localhoster settings contain malformed JSON");
    throw err;
  }
}

export function writeSettings({ stateRoot, settings, fsApi = fs } = {}) {
  const filePath = settingsPathFor(stateRoot);
  const dir = path.dirname(filePath);
  fsApi.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.settings.${process.pid}.${Date.now()}.tmp`);
  fsApi.writeFileSync(temp, `${JSON.stringify(validateSettings(settings), null, 2)}\n`);
  fsApi.renameSync(temp, filePath);
  return settings;
}

export function updateSettings({ stateRoot, input, fsApi = fs } = {}) {
  const current = loadSettings({ stateRoot, fsApi });
  if (!input || input.revision !== current.revision) {
    const error = new Error("localhoster settings revision conflict");
    error.code = "REVISION_CONFLICT";
    error.current = current;
    throw error;
  }

  const next = structuredClone(current);
  applyMutation(next, input);
  next.revision += 1;
  writeSettings({ stateRoot, settings: next, fsApi });
  return next;
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
  const allowed = ["associations", "projects", "revision", "version"];
  for (const key of keys) {
    if (!allowed.includes(key)) throw new Error(`unknown localhoster settings field: ${key}`);
  }
  if (settings.version !== SETTINGS_VERSION) throw new Error(`unsupported localhoster settings version: ${settings.version}`);
  if (!Number.isInteger(settings.revision) || settings.revision < 1) throw new Error("settings revision must be a positive integer");
  validateProjects(settings.projects);
  if (!settings.associations || typeof settings.associations !== "object" || Array.isArray(settings.associations)) {
    throw new Error("settings associations must be an object");
  }
  return settings;
}

function applyMutation(settings, input) {
  if (input.type === "project") return mutateProject(settings, input);
  if (input.type === "links") return mutateLinks(settings, input);
  if (input.type === "association") return mutateAssociation(settings, input);
  throw new Error("unknown localhoster settings mutation");
}

function mutateProject(settings, input) {
  const project = ensureProject(settings, input.projectIdentity);
  if (input.name != null) project.name = safeLabel(input.name, "project name");
  if (input.appId) {
    const app = ensureApp(project, input.appId);
    if (input.appName != null) app.name = safeLabel(input.appName, "app name");
    if (input.originPreference != null) {
      if (!["localhost", "127.0.0.1", "::1"].includes(input.originPreference)) throw new Error("invalid origin preference");
      app.originPreference = input.originPreference;
    }
  }
}

function mutateLinks(settings, input) {
  const project = ensureProject(settings, input.projectIdentity);
  const app = ensureApp(project, input.appId || "web");
  if (!Array.isArray(input.links)) throw new Error("links mutation requires links array");
  const seen = new Set();
  app.links = input.links.map((link) => {
    const id = safeId(link.id || slugify(link.label) || randomUUID());
    if (seen.has(id)) throw new Error(`duplicate link id: ${id}`);
    seen.add(id);
    return { id, label: safeLabel(link.label, "link label"), path: normalizeRoutePath(link.path) };
  });
}

function mutateAssociation(settings, input) {
  const key = safeId(input.associationKey);
  if (input.remove) {
    delete settings.associations[key];
    return;
  }
  settings.associations[key] = {
    projectIdentity: safeIdentity(input.projectIdentity),
    appId: safeId(input.appId || "web"),
  };
}

function validateProjects(projects) {
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) throw new Error("settings projects must be an object");
  for (const [identity, project] of Object.entries(projects)) {
    safeIdentity(identity);
    if (!project || typeof project !== "object" || Array.isArray(project)) throw new Error("settings project must be an object");
    if (project.name != null) safeLabel(project.name, "project name");
    if (!project.apps || typeof project.apps !== "object" || Array.isArray(project.apps)) throw new Error("settings project apps must be an object");
    for (const [appId, app] of Object.entries(project.apps)) validateApp(appId, app);
  }
}

function validateApp(appId, app) {
  safeId(appId);
  if (!app || typeof app !== "object" || Array.isArray(app)) throw new Error("settings app must be an object");
  if (app.name != null) safeLabel(app.name, "app name");
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
}

function ensureProject(settings, identity) {
  const key = safeIdentity(identity);
  settings.projects[key] ||= { apps: {} };
  settings.projects[key].apps ||= {};
  return settings.projects[key];
}

function ensureApp(project, appId) {
  const key = safeId(appId);
  project.apps[key] ||= { name: labelFromId(key), originPreference: "localhost", links: [] };
  project.apps[key].links ||= [];
  return project.apps[key];
}

function safeIdentity(value) {
  if (typeof value !== "string" || !/^(git|path|process|roborepo):/.test(value)) throw new Error("invalid project identity");
  return value;
}

function safeId(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value)) throw new Error("invalid id");
  return value;
}

function safeLabel(value, label) {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} is invalid`);
  return value.trim().slice(0, 80);
}

function slugify(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function labelFromId(value) {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (s) => s.toUpperCase());
}

function isLoopbackHost(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

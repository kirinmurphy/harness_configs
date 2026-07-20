import fs from "node:fs";
import path from "node:path";

export function normalizeGitRemote(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let host;
  let repoPath;
  const scpLike = trimmed.match(/^(?:[^@/\s]+@)?([^:\s]+):(.+)$/);
  if (scpLike && !trimmed.includes("://")) {
    host = scpLike[1];
    repoPath = scpLike[2];
  } else {
    try {
      const url = new URL(trimmed);
      host = url.hostname;
      repoPath = url.pathname.replace(/^\/+/, "");
    } catch {
      return null;
    }
  }

  if (!host || !repoPath) return null;
  repoPath = repoPath
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  if (!repoPath || repoPath.includes("..")) return null;
  return `git:${host.toLowerCase()}/${repoPath}`;
}

export function findProjectRoot(startDir, { fsApi = fs, pathApi = path } = {}) {
  if (!startDir || typeof startDir !== "string") return null;
  let current = pathApi.resolve(startDir);
  for (;;) {
    const gitPath = pathApi.join(current, ".git");
    if (exists(fsApi, gitPath)) return current;
    const parent = pathApi.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function resolveProjectIdentity(cwd, commandName, options = {}) {
  const { fsApi = fs, pathApi = path } = options;
  const realCwd = realpathSafe(fsApi, pathApi.resolve(cwd || ""));
  const projectRoot = findProjectRoot(realCwd, { fsApi, pathApi });
  if (projectRoot) {
    const remote = readGitRemote(projectRoot, { fsApi, pathApi });
    if (remote) {
      return {
        identity: remote,
        identityKind: "git",
        confidence: "high",
        projectRoot,
        evidence: "Git remote",
      };
    }
    return {
      identity: `path:${realpathSafe(fsApi, projectRoot)}`,
      identityKind: "path",
      confidence: "medium",
      projectRoot,
      evidence: "project directory",
    };
  }

  return {
    identity: `process:${realCwd}:${safeCommandName(commandName)}`,
    identityKind: "process",
    confidence: "low",
    projectRoot: null,
    evidence: "process working directory",
  };
}

function readGitRemote(projectRoot, { fsApi, pathApi }) {
  const gitPath = pathApi.join(projectRoot, ".git");
  let configPath = pathApi.join(gitPath, "config");
  try {
    const stat = fsApi.statSync(gitPath);
    if (stat.isFile()) {
      const content = fsApi.readFileSync(gitPath, "utf8");
      const match = content.match(/^gitdir:\s*(.+)$/m);
      if (match) {
        const gitDir = pathApi.resolve(projectRoot, match[1].trim());
        configPath = pathApi.join(gitDir, "config");
      }
    }
  } catch {}

  try {
    const config = fsApi.readFileSync(configPath, "utf8");
    const origin = remoteUrlFromConfig(config);
    return normalizeGitRemote(origin);
  } catch {
    return null;
  }
}

function remoteUrlFromConfig(config) {
  let inOrigin = false;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[remote ")) {
      inOrigin = /^\[remote\s+"origin"\]$/.test(line);
      continue;
    }
    if (inOrigin) {
      const match = line.match(/^url\s*=\s*(.+)$/);
      if (match) return match[1].trim();
    }
  }
  return null;
}

function realpathSafe(fsApi, value) {
  try {
    return fsApi.realpathSync(value);
  } catch {
    return value;
  }
}

function exists(fsApi, filePath) {
  try {
    fsApi.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function safeCommandName(value) {
  return String(value || "unknown").replace(/[^\w.-]/g, "_").slice(0, 80);
}

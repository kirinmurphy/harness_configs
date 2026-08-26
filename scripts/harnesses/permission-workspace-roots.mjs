import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function appendPathSegment(root, segment) {
  return `${root.replace(/[\\/]+$/, "")}/${segment}`;
}

function projectRootForPlansConfig(configPath) {
  return path.resolve(path.dirname(configPath), "..", "..");
}

export function findPermissionPlansConfig(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, "docs", "plans", "plans-config.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function repoNameForWorktreeRoot(worktreeRoot, projectRoot) {
  const expandedRoot = path.resolve(worktreeRoot.replace(/^~(?=$|\/|\\)/, os.homedir()));
  const relative = path.relative(expandedRoot, projectRoot);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    const [repoName] = relative.split(path.sep);
    if (repoName) return repoName;
  }
  return path.basename(projectRoot);
}

export function loadPermissionWorkspaceRoots(input) {
  const options = typeof input === "string" ? { configPath: input } : (input ?? {});
  const configPath = options.configPath;
  if (!configPath) return [];
  const projectRoot = options.projectRoot ?? projectRootForPlansConfig(configPath);
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const roots = [];
    if (typeof config.worktreeRoot === "string" && config.worktreeRoot.trim()) {
      const root = config.worktreeRoot.trim();
      roots.push(appendPathSegment(root, repoNameForWorktreeRoot(root, projectRoot)));
    }
    if (Array.isArray(config.workspaceRoots)) {
      for (const root of config.workspaceRoots) {
        if (typeof root === "string" && root.trim()) roots.push(root.trim());
      }
    }
    return [...new Set(roots)];
  } catch {
    return [];
  }
}

export function loadPermissionWorkspaceRootsForCwd(cwd = process.cwd()) {
  const configPath = findPermissionPlansConfig(cwd);
  if (!configPath) return [];
  return loadPermissionWorkspaceRoots({ configPath, projectRoot: projectRootForPlansConfig(configPath) });
}

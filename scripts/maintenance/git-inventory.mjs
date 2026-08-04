#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_DEPTH = 3;
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "target",
  ".cache",
  ".Trash",
  "Dropbox",
]);
const JUNK_PATTERNS = [
  "node_modules/**",
  ".next/**",
  "dist/**",
  "build/**",
  "coverage/**",
  "target/**",
];

export async function gitInventory(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const root = await resolveRoot(options.root);
  const repos = discoverRepos(root, { maxDepth: options.maxDepth });
  const records = repos
    .map((repoPath) => inspectRepo(repoPath, root, options))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const filtered = options.includeClean ? records : records.filter((repo) => !isClean(repo));
  const inventory = {
    root,
    generatedAt: new Date().toISOString(),
    options: {
      fetch: options.fetch,
      includeClean: options.includeClean,
      maxDepth: options.maxDepth,
    },
    summary: summarize(records),
    repos: filtered,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
    return;
  }

  process.stdout.write(renderMarkdown(inventory));
}

function parseArgs(argv) {
  const options = {
    root: null,
    fetch: false,
    json: false,
    markdown: false,
    includeClean: false,
    maxDepth: DEFAULT_MAX_DEPTH,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fetch") options.fetch = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--markdown") options.markdown = true;
    else if (arg === "--include-clean") options.includeClean = true;
    else if (arg === "--max-depth") {
      const raw = argv[i + 1];
      if (!raw) throw new Error("--max-depth requires a value");
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--max-depth must be a non-negative integer");
      }
      options.maxDepth = parsed;
      i += 1;
    } else if (arg.startsWith("--max-depth=")) {
      const raw = arg.slice("--max-depth=".length);
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--max-depth must be a non-negative integer");
      }
      options.maxDepth = parsed;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag: ${arg}`);
    } else if (!options.root) {
      options.root = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }

  if (!options.json && !options.markdown) options.markdown = true;
  if (options.json && options.markdown) throw new Error("choose either --json or --markdown");
  return options;
}

async function resolveRoot(initialRoot) {
  if (initialRoot) return validateRoot(initialRoot);
  if (!process.stdin.isTTY) {
    throw new Error("target root is required when stdin is not interactive");
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await rl.question("Folder to scan: ")).trim();
      if (!answer) {
        process.stderr.write("Path required.\n");
        continue;
      }
      try {
        return validateRoot(answer);
      } catch (err) {
        process.stderr.write(`${err.message}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

function validateRoot(root) {
  const absolute = path.resolve(root);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    throw new Error(`folder does not exist: ${absolute}`);
  }
  if (!stat.isDirectory()) throw new Error(`not a folder: ${absolute}`);
  return absolute;
}

function discoverRepos(root, { maxDepth }) {
  const repos = [];

  function visit(dir, depth) {
    if (hasGitDir(dir)) {
      repos.push(dir);
      return;
    }
    if (depth >= maxDepth) return;

    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries
      .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((entry) => visit(path.join(dir, entry.name), depth + 1));
  }

  visit(root, 0);
  return repos;
}

function hasGitDir(dir) {
  try {
    fs.lstatSync(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

function inspectRepo(repoPath, root, options) {
  const errors = [];
  if (options.fetch) {
    const fetch = git(repoPath, ["fetch", "--all", "--prune"]);
    if (!fetch.ok) errors.push(`fetch failed: ${fetch.note}`);
  }

  const currentBranch = currentBranchName(repoPath, errors);
  const remote = gitValue(repoPath, ["config", "--get", "remote.origin.url"]);
  const upstream = gitValue(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const status = statusCounts(repoPath, errors);
  const currentAheadBehind = upstream
    ? aheadBehind(repoPath, "HEAD", upstream, errors)
    : { ahead: null, behind: null, status: "no_upstream" };
  const localBranches = localBranchNames(repoPath, errors);
  const mergedBranches = currentBranch
    ? new Set(gitLines(repoPath, ["branch", "--merged", currentBranch]).map(cleanBranchLine))
    : new Set();
  const branches = localBranches.map((branch) =>
    inspectBranch(repoPath, branch, {
      currentBranch,
      currentDirty: status.dirty,
      hasRemote: Boolean(remote),
      mergedBranches,
    }, errors),
  );
  const trackedJunk = trackedJunkCandidates(repoPath, errors);

  return {
    path: repoPath,
    relativePath: path.relative(root, repoPath) || ".",
    currentBranch,
    remoteOriginUrl: remote || null,
    upstream: upstream || null,
    status,
    currentAheadBehind,
    branches,
    trackedJunk,
    errors,
  };
}

function inspectBranch(repoPath, branch, context, errors) {
  const upstream = gitValue(repoPath, ["for-each-ref", "--format=%(upstream:short)", `refs/heads/${branch}`]);
  const branchAheadBehind = upstream
    ? aheadBehind(repoPath, branch, upstream, errors)
    : { ahead: null, behind: null, status: "no_upstream" };
  const unpushedCommits = gitNumber(repoPath, ["rev-list", "--count", branch, "--not", "--remotes"], errors);
  const isCurrent = branch === context.currentBranch;
  const mergedIntoCurrent = isCurrent || context.mergedBranches.has(branch);
  const actions = [];

  if (
    isCurrent &&
    (context.currentDirty > 0 ||
      !context.hasRemote ||
      !upstream ||
      (branchAheadBehind.ahead || 0) > 0 ||
      (branchAheadBehind.behind || 0) > 0)
  ) {
    actions.push("current_sync_issue");
  }
  if (unpushedCommits > 0) actions.push("unpushed_branch");
  if (!isCurrent && !mergedIntoCurrent) actions.push("unmerged_branch");
  if (
    upstream &&
    !isCurrent &&
    mergedIntoCurrent &&
    (branchAheadBehind.behind || 0) > 0 &&
    (branchAheadBehind.ahead || 0) === 0
  ) {
    actions.push("stale_remote_tracking");
  }

  return {
    name: branch,
    upstream: upstream || null,
    ahead: branchAheadBehind.ahead,
    behind: branchAheadBehind.behind,
    unpushedCommits,
    mergedIntoCurrent,
    branchAction: actions[0] || null,
    branchActions: actions,
  };
}

function currentBranchName(repoPath, errors) {
  const branch = gitValue(repoPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch) return branch;
  const hash = gitValue(repoPath, ["rev-parse", "--short", "HEAD"]);
  if (hash) return `(detached:${hash})`;
  errors.push("could not resolve current branch");
  return null;
}

function statusCounts(repoPath, errors) {
  const result = git(repoPath, ["status", "--porcelain"]);
  if (!result.ok) {
    errors.push(`status failed: ${result.note}`);
    return { dirty: 0, staged: 0, unstaged: 0, untracked: 0 };
  }

  const lines = result.stdout.split("\n").filter(Boolean);
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const line of lines) {
    const x = line[0];
    const y = line[1];
    if (x === "?" && y === "?") {
      untracked += 1;
      continue;
    }
    if (x && x !== " ") staged += 1;
    if (y && y !== " ") unstaged += 1;
  }

  return { dirty: lines.length, staged, unstaged, untracked };
}

function localBranchNames(repoPath, errors) {
  const result = git(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  if (!result.ok) {
    errors.push(`branch list failed: ${result.note}`);
    return [];
  }
  return result.stdout.split("\n").filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function trackedJunkCandidates(repoPath, errors) {
  const candidates = new Set();
  ["*.DS_Store", "* .DS_Store", ...JUNK_PATTERNS].forEach((pattern) => {
    const result = git(repoPath, ["ls-files", pattern]);
    if (!result.ok) {
      errors.push(`tracked junk scan failed for ${pattern}: ${result.note}`);
      return;
    }
    result.stdout.split("\n").filter(Boolean).forEach((file) => candidates.add(file));
  });
  return [...candidates].sort((a, b) => a.localeCompare(b));
}

function aheadBehind(repoPath, left, right, errors) {
  const result = git(repoPath, ["rev-list", "--left-right", "--count", `${left}...${right}`]);
  if (!result.ok) {
    errors.push(`ahead/behind failed for ${left}...${right}: ${result.note}`);
    return { ahead: null, behind: null, status: "error" };
  }
  const [aheadRaw, behindRaw] = result.stdout.trim().split(/\s+/);
  return {
    ahead: Number.parseInt(aheadRaw, 10) || 0,
    behind: Number.parseInt(behindRaw, 10) || 0,
    status: "ok",
  };
}

function gitValue(repoPath, args) {
  const result = git(repoPath, args);
  return result.ok ? result.stdout.trim() || null : null;
}

function gitLines(repoPath, args) {
  const result = git(repoPath, args);
  return result.ok ? result.stdout.split("\n").filter(Boolean) : [];
}

function gitNumber(repoPath, args, errors) {
  const result = git(repoPath, args);
  if (!result.ok) {
    errors.push(`${args.join(" ")} failed: ${result.note}`);
    return 0;
  }
  return Number.parseInt(result.stdout.trim(), 10) || 0;
}

function git(repoPath, args) {
  const result = spawnSync("git", args, {
    cwd: repoPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    note: (result.stderr || result.stdout || result.error?.message || `exit ${result.status}`).trim(),
  };
}

function cleanBranchLine(line) {
  return line.replace(/^\*\s*/, "").trim();
}

function summarize(records) {
  return {
    totalRepos: records.length,
    reposWithIssues: records.filter((repo) => !isClean(repo)).length,
    currentBranchSyncIssues: records.filter(hasCurrentSyncIssue).length,
    localOnlyOrUnpushedBranches: records.reduce(
      (sum, repo) => sum + repo.branches.filter((branch) => branch.branchActions.includes("unpushed_branch")).length,
      0,
    ),
    unmergedBranches: records.reduce(
      (sum, repo) => sum + repo.branches.filter((branch) => branch.branchActions.includes("unmerged_branch")).length,
      0,
    ),
    reposWithNoRemote: records.filter((repo) => !repo.remoteOriginUrl).length,
    reposWithTrackedJunk: records.filter((repo) => repo.trackedJunk.length > 0).length,
    reposWithErrors: records.filter((repo) => repo.errors.length > 0).length,
    cleanRepos: records.filter(isClean).length,
  };
}

function isClean(repo) {
  return (
    !hasCurrentSyncIssue(repo) &&
    repo.branches.every((branch) => branch.branchActions.length === 0) &&
    repo.trackedJunk.length === 0 &&
    repo.errors.length === 0
  );
}

function hasCurrentSyncIssue(repo) {
  return repo.branches.some((branch) => branch.branchActions.includes("current_sync_issue"));
}

function renderMarkdown(inventory) {
  const lines = [
    "# Git Inventory",
    "",
    `Root: \`${inventory.root}\``,
    `Generated: ${inventory.generatedAt}`,
    "",
    "## Summary Counts",
    "",
    `- Total repos: ${inventory.summary.totalRepos}`,
    `- Repos with issues: ${inventory.summary.reposWithIssues}`,
    `- Current branch sync issues: ${inventory.summary.currentBranchSyncIssues}`,
    `- Local-only / unpushed branches: ${inventory.summary.localOnlyOrUnpushedBranches}`,
    `- Unmerged branches: ${inventory.summary.unmergedBranches}`,
    `- Repos with no remote: ${inventory.summary.reposWithNoRemote}`,
    `- Repos with tracked junk candidates: ${inventory.summary.reposWithTrackedJunk}`,
    `- Repos with git errors: ${inventory.summary.reposWithErrors}`,
    `- Clean repos: ${inventory.summary.cleanRepos}`,
  ];

  appendCurrentBranchIssues(lines, inventory.repos);
  appendUnpushedBranches(lines, inventory.repos);
  appendUnmergedBranches(lines, inventory.repos);
  appendReposWithNoRemote(lines, inventory.repos);
  appendTrackedJunk(lines, inventory.repos);
  appendRepoErrors(lines, inventory.repos);
  if (inventory.options.includeClean) appendCleanRepos(lines, inventory.repos);

  return `${lines.join("\n")}\n`;
}

function appendCurrentBranchIssues(lines, repos) {
  lines.push("", "## Current Branch Sync Issues", "");
  const issueRepos = repos.filter(hasCurrentSyncIssue);
  if (issueRepos.length === 0) {
    lines.push("- None");
    return;
  }
  issueRepos.forEach((repo) => {
    const current = repo.branches.find((branch) => branch.name === repo.currentBranch);
    lines.push(
      `- \`${repo.relativePath}\`: branch \`${repo.currentBranch || "unknown"}\`, remote ${formatNullable(repo.remoteOriginUrl)}, upstream ${formatNullable(repo.upstream)}, dirty ${repo.status.dirty} (${repo.status.staged} staged, ${repo.status.unstaged} unstaged, ${repo.status.untracked} untracked), ahead ${formatCount(current?.ahead)}, behind ${formatCount(current?.behind)}`,
    );
  });
}

function appendUnpushedBranches(lines, repos) {
  lines.push("", "## Local-Only / Unpushed Branches", "");
  const rows = branchRows(repos, "unpushed_branch");
  if (rows.length === 0) {
    lines.push("- None");
    return;
  }
  rows.forEach(({ repo, branch }) => {
    lines.push(`- \`${repo.relativePath}\`: \`${branch.name}\` has ${branch.unpushedCommits} commit(s) not on any remote`);
  });
}

function appendUnmergedBranches(lines, repos) {
  lines.push("", "## Unmerged Branches", "");
  const rows = branchRows(repos, "unmerged_branch");
  if (rows.length === 0) {
    lines.push("- None");
    return;
  }
  rows.forEach(({ repo, branch }) => {
    lines.push(`- \`${repo.relativePath}\`: \`${branch.name}\` not merged into \`${repo.currentBranch || "current"}\``);
  });
}

function appendReposWithNoRemote(lines, repos) {
  lines.push("", "## Repos With No Remote", "");
  const noRemote = repos.filter((repo) => !repo.remoteOriginUrl);
  if (noRemote.length === 0) {
    lines.push("- None");
    return;
  }
  noRemote.forEach((repo) => lines.push(`- \`${repo.relativePath}\``));
}

function appendTrackedJunk(lines, repos) {
  lines.push("", "## Tracked Junk Candidates", "");
  const withJunk = repos.filter((repo) => repo.trackedJunk.length > 0);
  if (withJunk.length === 0) {
    lines.push("- None");
    return;
  }
  withJunk.forEach((repo) => {
    lines.push(`- \`${repo.relativePath}\`: ${repo.trackedJunk.map((file) => `\`${file}\``).join(", ")}`);
  });
}

function appendRepoErrors(lines, repos) {
  const withErrors = repos.filter((repo) => repo.errors.length > 0);
  if (withErrors.length === 0) return;
  lines.push("", "## Git Error Notes", "");
  withErrors.forEach((repo) => {
    lines.push(`- \`${repo.relativePath}\`: ${repo.errors.join("; ")}`);
  });
}

function appendCleanRepos(lines, repos) {
  lines.push("", "## Clean Repos", "");
  const cleanRepos = repos.filter(isClean);
  if (cleanRepos.length === 0) {
    lines.push("- None");
    return;
  }
  cleanRepos.forEach((repo) => lines.push(`- \`${repo.relativePath}\``));
}

function branchRows(repos, action) {
  return repos.flatMap((repo) =>
    repo.branches
      .filter((branch) => branch.branchActions.includes(action))
      .map((branch) => ({ repo, branch })),
  );
}

function formatNullable(value) {
  return value ? `\`${value}\`` : "`null`";
}

function formatCount(value) {
  return value == null ? "unknown" : String(value);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  gitInventory().catch((err) => {
    process.stderr.write(`git-inventory: ${err.message}\n`);
    process.exitCode = 1;
  });
}

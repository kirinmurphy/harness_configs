#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { collectBranchSyncFacts } from "../../modules/repositories/branch-sync.mjs";
import { refreshRemote, pushBranchToUpstream } from "../../modules/repositories/git-remote-operations.mjs";
import { selectMenu, confirmYesNo, makePrompter, waitForEnter } from "../cli/skill-lib.mjs";

const DEFAULT_MAX_DEPTH = 3;
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "target", ".cache", ".Trash", "Dropbox"]);

export async function remoteSyncCheck(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.menu) return runRemoteSyncMenu(options);
  const result = await collectRemoteSync(options);

  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (options.markdown) process.stdout.write(renderMarkdown(result));
  else if (options.table) process.stdout.write(renderTable(result));
  else process.stdout.write(renderCompact(result));

  if (result.refreshFailures.length > 0) process.exitCode = 1;
}

export async function collectRemoteSync(options) {
  const root = await resolveRoot(options.root);
  const repos = discoverRepos(root, { maxDepth: options.maxDepth });
  const records = [];
  const refreshFailures = [];

  for (const repoPath of repos) {
    const relativePath = path.relative(root, repoPath) || ".";
    const before = await collectBranchSyncFacts(repoPath);
    if (!before.provider.ok) {
      refreshFailures.push({
        path: repoPath,
        relativePath,
        failures: [{ remote: "local git inspection", error: before.provider.reason }],
      });
      continue;
    }
    const remotes = distinctTrackedRemotes(before.branches);
    const failures = [];
    for (const remote of remotes) {
      const refreshed = await refreshRemote(repoPath, remote);
      if (!refreshed.ok) failures.push(refreshed);
    }
    if (failures.length > 0) {
      refreshFailures.push({ path: repoPath, relativePath, failures });
      continue;
    }
    const after = await collectBranchSyncFacts(repoPath);
    if (!after.provider.ok) {
      refreshFailures.push({
        path: repoPath,
        relativePath,
        failures: [{ remote: "local git inspection", error: after.provider.reason }],
      });
      continue;
    }
    const branches = safetyBranches(after.branches);
    if (branches.length > 0 || options.includeClean) {
      records.push({ path: repoPath, relativePath, fetchedAt: after.fetchedAt, branches });
    }
  }

  return {
    root,
    generatedAt: new Date().toISOString(),
    options: { includeClean: options.includeClean, maxDepth: options.maxDepth },
    summary: {
      totalRepos: repos.length,
      reposWithAheadBranches: records.filter((repo) => repo.branches.length > 0).length,
      aheadBranches: records.reduce((sum, repo) => sum + repo.branches.length, 0),
      refreshFailures: refreshFailures.length,
    },
    repos: records,
    refreshFailures,
  };
}

async function runRemoteSyncMenu(options) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("--menu requires an interactive TTY");
  let result = await collectRemoteSync({ ...options, includeClean: false });
  for (;;) {
    const repo = await selectRepository(result);
    if (!repo) break;
    result = await repositoryMenu(result, repo, options);
  }
  writeInteractiveResult({ status: "ok", notice: { text: "Remote sync check complete", level: "success" } });
}

async function selectRepository(result) {
  const items = [
    ...result.repos.map((repo) => ({
      label: repoLabel(repo),
      desc: `${repo.branches.length} branch${repo.branches.length === 1 ? "" : "es"} ahead`,
      value: repo,
    })),
  ];
  if (result.refreshFailures.length) {
    items.push({ header: "Could not verify remote state" });
    result.refreshFailures.forEach((repo) => items.push({
      label: repoLabel(repo),
      desc: repo.failures.map((failure) => `${failure.remote}: ${failure.error}`).join("; "),
      value: null,
    }));
  }
  items.push({ header: "Navigation" }, { label: "Back", value: null });
  return selectMenu("Remote Sync Check\n", items);
}

async function repositoryMenu(result, repo, options) {
  for (;;) {
    const branchLines = repo.branches
      .map((branch) => `  ${branch.name} — ${branch.ahead} ahead${branch.behind ? ` / ${branch.behind} behind` : ""}`)
      .join("\n");
    const title = `${repoLabel(repo)}\n\n${branchLines}\n`;
    const action = await selectMenu(title, [
      { header: "Actions" },
      { label: "Show unpushed commits", value: "commits" },
      { label: "Open shell in repo", value: "shell" },
      { label: "Copy checkout command", value: "copy" },
      { label: "Push branch to upstream", value: "push" },
      { header: "Navigation" },
      { label: "Back", value: null },
    ]);
    if (!action) return result;
    if (action === "shell") await openShell(repo.path);
    if (action === "commits") await showCommits(repo);
    if (action === "copy") await copyCheckout(repo);
    if (action === "push") await pushBranch(repo);
    result = await collectRemoteSync({ ...options, includeClean: false });
    const refreshed = result.repos.find((candidate) => candidate.path === repo.path);
    if (!refreshed) return result;
    repo = refreshed;
  }
}

async function chooseBranch(repo, title) {
  return selectMenu(title, [
    ...repo.branches.map((branch) => ({
      label: branch.name,
      desc: `${branch.ahead} ahead${branch.behind ? ` / ${branch.behind} behind` : ""}`,
      value: branch,
    })),
    { header: "Navigation" },
    { label: "Back", value: null },
  ]);
}

async function showCommits(repo) {
  const branch = await chooseBranch(repo, "Show unpushed commits\n");
  if (!branch) return;
  const { runGitProcess } = await import("../../modules/repositories/git-exec.mjs");
  const result = await runGitProcess(repo.path, ["log", "--oneline", `${branch.upstream}..${branch.name}`]);
  process.stdout.write(`\n${result.ok ? result.stdout : result.error}\n`);
  await waitForEnter();
}

async function copyCheckout(repo) {
  const branch = await chooseBranch(repo, "Copy checkout command\n");
  if (!branch) return;
  const command = `cd ${shellQuote(repo.path)} && git switch ${shellQuote(branch.name)}`;
  const pbcopy = spawn("pbcopy", { stdio: ["pipe", "ignore", "ignore"] });
  pbcopy.stdin.end(command);
  const ok = await new Promise((resolve) => pbcopy.on("exit", (status) => resolve(status === 0)));
  process.stdout.write(ok ? "\nCheckout command copied.\n" : `\n${command}\n`);
  await waitForEnter();
}

async function pushBranch(repo) {
  const branch = await chooseBranch(repo, "Push branch to upstream\n");
  if (!branch) return;
  const refreshed = await refreshRemote(repo.path, branch.upstreamRemote);
  if (!refreshed.ok) {
    process.stdout.write(`\nCould not refresh ${branch.upstreamRemote}: ${refreshed.error}\n`);
    await waitForEnter();
    return;
  }
  const facts = await collectBranchSyncFacts(repo.path);
  const current = facts.branches.find((candidate) => candidate.name === branch.name);
  if (!current || current.trackingState !== "ok" || current.ahead <= 0) {
    process.stdout.write("\nBranch is no longer ahead.\n");
    await waitForEnter();
    return;
  }
  if (current.behind > 0) {
    process.stdout.write(`\n${current.name} is ${current.behind} behind ${current.upstream}; reconcile manually before pushing.\n`);
    await waitForEnter();
    return;
  }
  const prompter = makePrompter();
  try {
    const ok = await confirmYesNo(prompter, `Push ${current.name} to ${current.upstream}?`, false);
    if (!ok) return;
  } finally {
    prompter.close?.();
  }
  const pushed = await pushBranchToUpstream(repo.path, current.name, current);
  process.stdout.write(pushed.ok ? "\nPush complete.\n" : `\nPush failed: ${pushed.error}\n`);
  await waitForEnter();
}

async function openShell(cwd) {
  const shell = process.env.SHELL || "/bin/sh";
  await new Promise((resolve) => spawn(shell, { cwd, stdio: "inherit" }).on("exit", resolve));
}

function safetyBranches(branches) {
  return branches.filter((branch) =>
    branch.trackingState === "ok" &&
    branch.upstreamRemote !== "." &&
    branch.ahead > 0
  );
}

function distinctTrackedRemotes(branches) {
  return [...new Set(branches
    .filter((branch) => branch.upstreamRemote && branch.upstreamRemote !== ".")
    .map((branch) => branch.upstreamRemote))].sort();
}

function renderCompact(result) {
  const lines = ["Remote Sync Check", `Root: ${result.root}`, "", "Local branches with commits ahead of remote"];
  appendAhead(lines, result);
  appendFailures(lines, result);
  return `${lines.join("\n")}\n`;
}

function renderMarkdown(result) {
  return renderCompact(result);
}

function renderTable(result) {
  const lines = ["Repository\tBranch\tAhead\tBehind\tUpstream"];
  result.repos.forEach((repo) => repo.branches.forEach((branch) => {
    lines.push(`${repo.relativePath}\t${branch.name}\t${branch.ahead}\t${branch.behind}\t${branch.upstream}`);
  }));
  return `${lines.join("\n")}\n`;
}

function appendAhead(lines, result) {
  const repos = result.repos.filter((repo) => repo.branches.length > 0);
  if (!repos.length) {
    lines.push("", "None.");
    return;
  }
  repos.forEach((repo, index) => {
    lines.push("", `${index + 1}) ${repoLabel(repo)}`);
    repo.branches.forEach((branch) => lines.push(`   - ${branch.name} — ${branch.ahead} ahead${branch.behind ? ` / ${branch.behind} behind` : ""}`));
  });
}

function appendFailures(lines, result) {
  if (!result.refreshFailures.length) return;
  lines.push("", "Could not verify remote state");
  result.refreshFailures.forEach((repo, index) => {
    lines.push("", `${index + 1}) ${repoLabel(repo)}`);
    repo.failures.forEach((failure) => lines.push(`   - ${failure.remote} — ${failure.error}`));
  });
}

function parseArgs(argv) {
  const options = {
    root: null,
    json: false,
    markdown: false,
    table: false,
    compact: false,
    menu: false,
    includeClean: false,
    maxDepth: DEFAULT_MAX_DEPTH,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--markdown") options.markdown = true;
    else if (arg === "--table") options.table = true;
    else if (arg === "--compact") options.compact = true;
    else if (arg === "--menu") options.menu = true;
    else if (arg === "--include-clean") options.includeClean = true;
    else if (arg === "--max-depth") {
      options.maxDepth = parseDepth(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith("--max-depth=")) {
      options.maxDepth = parseDepth(arg.slice("--max-depth=".length));
    } else if (arg === "--fetch") {
      throw new Error("--fetch was removed; remote-sync-check always refreshes remotes");
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag: ${arg}`);
    } else if (!options.root) {
      options.root = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  const formats = [options.json, options.markdown, options.table, options.compact].filter(Boolean).length;
  if (formats === 0) options.compact = true;
  if (formats > 1) throw new Error("choose one of --json, --markdown, --table, or --compact");
  return options;
}

function parseDepth(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("--max-depth must be a non-negative integer");
  return parsed;
}

async function resolveRoot(initialRoot) {
  if (initialRoot) return validateRoot(initialRoot);
  if (!process.stdin.isTTY) throw new Error("target root is required when stdin is not interactive");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Folder to scan: ");
    return validateRoot(answer.trim());
  } finally {
    rl.close();
  }
}

function validateRoot(root) {
  const absolute = path.resolve(expandHomePath(root));
  const stat = fs.statSync(absolute);
  if (!stat.isDirectory()) throw new Error(`not a folder: ${absolute}`);
  return absolute;
}

function expandHomePath(input) {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function discoverRepos(root, { maxDepth }) {
  const repos = [];
  const visit = (dir, depth) => {
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
  };
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

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function repoLabel(repo) {
  return repo.relativePath === "." ? "." : `./${repo.relativePath}`;
}

function writeInteractiveResult(payload) {
  const file = process.env.ROBOREPO_INTERACTIVE_RESULT_FILE;
  if (!file) return;
  fs.writeFileSync(file, JSON.stringify(payload));
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  remoteSyncCheck().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}

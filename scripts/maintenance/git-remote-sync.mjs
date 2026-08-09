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
    summary: summarizeRemoteSync(repos.length, records, refreshFailures),
    repos: records,
    refreshFailures,
  };
}

async function runRemoteSyncMenu(options) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("--menu requires an interactive TTY");
  let result = await withScanIndicator(() => collectRemoteSync({ ...options, includeClean: false }));
  for (;;) {
    const selected = await selectRepository(result);
    if (!selected) break;
    if (selected.kind === "failure") {
      await navigate(() => showRefreshFailure(selected.repo));
      continue;
    }
    result = await navigate(() => repositoryMenu(result, selected.repo));
  }
  writeInteractiveResult({ status: "ok", notice: { text: "Remote sync check complete", level: "success" } });
}

async function selectRepository(result) {
  const items = [
    ...result.repos.map((repo) => ({
      label: repoLabel(repo),
      desc: `${repo.branches.length} branch${repo.branches.length === 1 ? "" : "es"} ahead`,
      value: { kind: "repo", repo },
    })),
  ];
  if (result.repos.length === 0 && result.refreshFailures.length === 0) {
    items.push({ header: "No branches found out of sync" });
  }
  if (result.refreshFailures.length) {
    items.push({ header: "Could not verify remote state" });
    result.refreshFailures.forEach((repo) => items.push({
      label: repoLabel(repo),
      desc: `${repo.failures.length} verification failure${repo.failures.length === 1 ? "" : "s"}`,
      value: { kind: "failure", repo },
    }));
  }
  items.push({ header: "Navigation" }, { label: "Back", value: null });
  return selectMenu("Remote Sync Check\n", items);
}

async function showRefreshFailure(repo) {
  const lines = [
    repoLabel(repo),
    repo.path,
    "",
    "Could not verify remote state",
    "",
    ...repo.failures.flatMap((failure) => [
      `${failure.remote}:`,
      failure.error,
      "",
      failureHint(failure.error),
      "",
      ...failureCommands(repo.path, failure),
      "",
    ]),
  ];
  process.stdout.write(`\n${lines.join("\n").trimEnd()}\n`);
  await waitForEnter();
}

function failureCommands(repoPath, failure) {
  if (failure.remote === "local git inspection") {
    return [
      `Inspect: cd ${shellQuote(repoPath)} && git status --short --branch`,
      `Retry: cd ${shellQuote(repoPath)} && git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads`,
    ];
  }
  return [
    `Inspect: cd ${shellQuote(repoPath)} && git remote -v`,
    `Retry: cd ${shellQuote(repoPath)} && git fetch ${shellQuote(failure.remote)}`,
  ];
}

function failureHint(error) {
  const text = String(error || "").toLowerCase();
  if (text.includes("repository not found")) return "Likely cause: remote URL points to a missing, renamed, private, or unauthorized repository.";
  if (text.includes("could not read from remote repository")) return "Likely cause: SSH/auth access or remote URL is not valid from this machine.";
  if (text.includes("could not resolve host") || text.includes("failed to connect")) return "Likely cause: network, DNS, VPN, or remote host connectivity.";
  if (text.includes("not a git repository")) return "Likely cause: local path is not a valid Git repository or its .git metadata is broken.";
  if (text.includes("command failed")) return "Likely cause: git fetch exited non-zero; retry the shown command for the full Git diagnostic.";
  return "Likely cause: git fetch could not verify this remote; retry the shown command for the full Git diagnostic.";
}

async function repositoryMenu(result, repo) {
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
    if (!action) return navigate(() => result);
    if (action === "shell") await navigate(() => openShell(repo.path));
    if (action === "commits") await navigate(() => showCommits(repo));
    if (action === "copy") await navigate(() => copyCheckout(repo));
    if (action === "push") {
      const pushed = await navigate(() => pushBranch(repo));
      if (!pushed) continue;
      result = await withScanIndicator(() => refreshRepoRecord(result, repo));
      const refreshed = result.repos.find((candidate) => candidate.path === repo.path);
      if (!refreshed) return result;
      repo = refreshed;
    }
  }
}

async function refreshRepoRecord(result, repo) {
  const before = await collectBranchSyncFacts(repo.path);
  if (!before.provider.ok) {
    return finalizeRemoteSyncResult({
      ...result,
      generatedAt: new Date().toISOString(),
      repos: result.repos.filter((candidate) => candidate.path !== repo.path),
      refreshFailures: upsertRefreshFailure(result.refreshFailures, {
        path: repo.path,
        relativePath: repo.relativePath,
        failures: [{ remote: "local git inspection", error: before.provider.reason }],
      }),
    });
  }
  const failures = [];
  for (const remote of distinctTrackedRemotes(before.branches)) {
    const refreshed = await refreshRemote(repo.path, remote);
    if (!refreshed.ok) failures.push(refreshed);
  }
  if (failures.length > 0) {
    return finalizeRemoteSyncResult({
      ...result,
      generatedAt: new Date().toISOString(),
      repos: result.repos.filter((candidate) => candidate.path !== repo.path),
      refreshFailures: upsertRefreshFailure(result.refreshFailures, {
        path: repo.path,
        relativePath: repo.relativePath,
        failures,
      }),
    });
  }
  const after = await collectBranchSyncFacts(repo.path);
  if (!after.provider.ok) {
    return finalizeRemoteSyncResult({
      ...result,
      generatedAt: new Date().toISOString(),
      repos: result.repos.filter((candidate) => candidate.path !== repo.path),
      refreshFailures: upsertRefreshFailure(result.refreshFailures, {
        path: repo.path,
        relativePath: repo.relativePath,
        failures: [{ remote: "local git inspection", error: after.provider.reason }],
      }),
    });
  }
  const nextRepo = { ...repo, fetchedAt: after.fetchedAt, branches: safetyBranches(after.branches) };
  const nextRepos = nextRepo.branches.length > 0
    ? result.repos.map((candidate) => candidate.path === repo.path ? nextRepo : candidate)
    : result.repos.filter((candidate) => candidate.path !== repo.path);
  const nextRefreshFailures = result.refreshFailures.filter((candidate) => candidate.path !== repo.path);
  return finalizeRemoteSyncResult({
    ...result,
    generatedAt: new Date().toISOString(),
    repos: nextRepos,
    refreshFailures: nextRefreshFailures,
  });
}

function finalizeRemoteSyncResult(result) {
  return {
    ...result,
    summary: summarizeRemoteSync(result.summary.totalRepos, result.repos, result.refreshFailures),
  };
}

function summarizeRemoteSync(totalRepos, repos, refreshFailures) {
  return {
    totalRepos,
    reposWithAheadBranches: repos.filter((candidate) => candidate.branches.length > 0).length,
    aheadBranches: repos.reduce((sum, candidate) => sum + candidate.branches.length, 0),
    refreshFailures: refreshFailures.length,
  };
}

function upsertRefreshFailure(refreshFailures, failure) {
  return [
    ...refreshFailures.filter((candidate) => candidate.path !== failure.path),
    failure,
  ];
}

async function chooseBranch(repo, title) {
  return selectMenu(`${repoLabel(repo)}\n${repo.path}\n\n${title}\n`, [
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
  const branch = await chooseBranch(repo, "Show unpushed commits");
  if (!branch) return;
  const { runGitProcess } = await import("../../modules/repositories/git-exec.mjs");
  const range = `${branch.upstream}..${branch.name}`;
  const result = await runGitProcess(repo.path, [
    "log",
    "--stat",
    "--decorate",
    "--date=short",
    "--pretty=format:%h %ad %an%n%s%n",
    range,
  ]);
  const checkoutCommand = `cd ${shellQuote(repo.path)} && git switch ${shellQuote(branch.name)}`;
  const pushCommand = `git push ${shellQuote(branch.upstreamRemote)} ${shellQuote(branch.name)}:${shellQuote(branch.upstreamRemoteRef)}`;
  const details = [
    repoLabel(repo),
    repo.path,
    "",
    `${branch.name} -> ${branch.upstream}`,
    `${branch.ahead} ahead${branch.behind ? ` / ${branch.behind} behind` : ""}`,
    "",
    `Checkout: ${checkoutCommand}`,
    `Push: ${pushCommand}`,
    "",
    result.ok ? result.stdout : result.error,
  ].join("\n");
  process.stdout.write(`\n${details.trimEnd()}\n`);
  await waitForEnter();
}

async function copyCheckout(repo) {
  const branch = await chooseBranch(repo, "Copy checkout command");
  if (!branch) return;
  const command = `cd ${shellQuote(repo.path)} && git switch ${shellQuote(branch.name)}`;
  const pbcopy = spawn("pbcopy", { stdio: ["pipe", "ignore", "ignore"] });
  const copied = waitForChildResult(pbcopy);
  try {
    pbcopy.stdin.end(command);
  } catch {
    // Launch errors are reported by waitForChildResult and fall back to printing the command.
  }
  const result = await copied;
  process.stdout.write(result.ok ? "\nCheckout command copied.\n" : `\n${command}\n`);
  await waitForEnter();
}

async function pushBranch(repo) {
  const branch = await chooseBranch(repo, "Push branch to upstream");
  if (!branch) return false;
  const refreshed = await refreshRemote(repo.path, branch.upstreamRemote);
  if (!refreshed.ok) {
    process.stdout.write(`\nCould not refresh ${branch.upstreamRemote}: ${refreshed.error}\n`);
    await waitForEnter();
    return false;
  }
  const facts = await collectBranchSyncFacts(repo.path);
  if (!facts.provider.ok) {
    process.stdout.write(`\nCould not inspect local Git state: ${facts.provider.reason}\n`);
    await waitForEnter();
    return false;
  }
  const current = facts.branches.find((candidate) => candidate.name === branch.name);
  if (!current || current.trackingState !== "ok" || current.ahead <= 0) {
    process.stdout.write("\nBranch is no longer ahead.\n");
    await waitForEnter();
    return false;
  }
  if (current.behind > 0) {
    process.stdout.write(`\n${current.name} is ${current.behind} behind ${current.upstream}; reconcile manually before pushing.\n`);
    await waitForEnter();
    return false;
  }
  const prompter = makePrompter();
  try {
    const ok = await confirmYesNo(prompter, `Push ${current.name} to ${current.upstream}?`, false);
    if (!ok) return false;
  } finally {
    prompter.close?.();
  }
  const pushed = await pushBranchToUpstream(repo.path, current.name, current);
  process.stdout.write(pushed.ok ? "\nPush complete.\n" : `\nPush failed: ${pushed.error}\n`);
  await waitForEnter();
  return pushed.ok;
}

async function openShell(cwd) {
  const shell = process.env.SHELL || "/bin/sh";
  const result = await waitForChildResult(spawn(shell, { cwd, stdio: "inherit" }));
  if (!result.ok) {
    process.stdout.write(`\nCould not open shell: ${result.error}\n`);
    await waitForEnter();
  }
}

async function navigate(next) {
  clearInteractiveScreen();
  try {
    return await next();
  } finally {
    clearInteractiveScreen();
  }
}

function waitForChildResult(child) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("error", (error) => done({ ok: false, error: error?.message || String(error) }));
    child.once("exit", (status, signal) => done({
      ok: status === 0,
      error: signal ? `exited on ${signal}` : `exited ${status}`,
    }));
  });
}

function clearInteractiveScreen() {
  if (process.stdout.isTTY) process.stdout.write("\x1b[H\x1b[2J");
}

async function withScanIndicator(scan) {
  if (!process.stdout.isTTY) return scan();
  const frames = ["-", "\\", "|", "/"];
  let frame = 0;
  const render = () => {
    process.stdout.write(`\r${frames[frame % frames.length]} Scanning remote state...`);
    frame += 1;
  };
  render();
  const timer = setInterval(render, 120);
  try {
    return await scan();
  } finally {
    clearInterval(timer);
    process.stdout.write("\r\x1b[2K");
  }
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

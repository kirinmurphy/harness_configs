import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

export const LIFECYCLES = new Set(["backlog", "active", "completed", "archived"]);
export const PRIORITIES = new Set(["high", "medium", "low", "none"]);
const DEFAULT_IGNORED = new Set(["node_modules", ".git", "vendor", "dist", "build"]);
const MAX_DOC_BYTES = 1024 * 1024;
const MAX_REPOS = 250;
const MAX_PLANS_PER_REPO = 500;

// Per-file record cache keyed by absolute path. Each entry is invalidated the moment a file's own
// mtime changes, so edits are always picked up — this only skips the expensive re-parse + git
// shell-outs (readPlanRecord) for files that haven't changed since the last scan. Directory
// listing still runs on every call (cheap `readdirSync`), so new/removed files are always seen.
const planRecordCache = new Map();

export function settingsPath(stateRoot) {
  return path.join(stateRoot, "plan-docs", "settings.json");
}

export function readPlanSettings({ stateRoot, env = process.env } = {}) {
  const fallback = {
    schemaVersion: 1,
    discoveryRoots: env.ROBOREPO_PLAN_ROOTS ? env.ROBOREPO_PLAN_ROOTS.split(path.delimiter).filter(Boolean) : [],
    ignoredDirectories: [...DEFAULT_IGNORED],
  };
  const file = settingsPath(stateRoot);
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return normalizeSettings(data, fallback);
  } catch {
    return fallback;
  }
}

export function writePlanSettings({ stateRoot, discoveryRoots, ignoredDirectories = [...DEFAULT_IGNORED] }) {
  const settings = normalizeSettings({ schemaVersion: 1, discoveryRoots, ignoredDirectories }, null);
  fs.mkdirSync(path.dirname(settingsPath(stateRoot)), { recursive: true });
  fs.writeFileSync(settingsPath(stateRoot), JSON.stringify(settings, null, 2) + "\n");
  return settings;
}

export function normalizeSettings(data, fallback = null) {
  const roots = Array.isArray(data?.discoveryRoots) ? data.discoveryRoots : fallback?.discoveryRoots || [];
  const ignored = Array.isArray(data?.ignoredDirectories) ? data.ignoredDirectories : fallback?.ignoredDirectories || [...DEFAULT_IGNORED];
  return {
    schemaVersion: 1,
    discoveryRoots: roots.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()),
    ignoredDirectories: ignored.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()),
  };
}

export function normalizeRootInput(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("discovery root is required");
  const expanded = input.trim().replace(/^~(?=$|\/|\\)/, os.homedir());
  const resolved = path.resolve(expanded);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error("discovery root must be a readable directory");
  return resolved;
}

export function discoverRepositories(settings) {
  const ignored = new Set(settings.ignoredDirectories || [...DEFAULT_IGNORED]);
  const repositories = [];
  const errors = [];
  const seen = new Set();
  let truncated = false;

  for (const rootText of settings.discoveryRoots || []) {
    let root;
    try {
      root = normalizeRootInput(rootText);
    } catch (err) {
      errors.push({ root: rootText, error: String(err?.message || err) });
      continue;
    }
    for (const candidate of [root, ...immediateChildren(root, ignored)]) {
      if (repositories.length >= MAX_REPOS) {
        truncated = true;
        break;
      }
      const repo = candidateRepository(candidate);
      if (!repo || seen.has(repo.root)) continue;
      seen.add(repo.root);
      repositories.push(repo);
    }
  }

  return { repositories, errors, truncated };
}

export function buildPlanSnapshot({ stateRoot, env = process.env, packageState = null } = {}) {
  const settings = readPlanSettings({ stateRoot, env });
  const discovery = discoverRepositories(settings);
  const plans = [];
  const errors = [...discovery.errors];
  for (const repo of discovery.repositories) {
    try {
      plans.push(...discoverPlansInRepository(repo));
    } catch (err) {
      errors.push({ repository: repo.name, root: repo.root, error: String(err?.message || err) });
    }
  }
  const relationships = relationshipWarnings(plans);
  for (const plan of plans) {
    plan.plan.validation.warnings.push(...(relationships.get(plan.key) || []));
    plan.plan.validation.valid = plan.plan.validation.warnings.length === 0;
  }
  return {
    ok: true,
    settings,
    repositories: discovery.repositories.map((repo) => publicRepository(repo)),
    plans: plans.map(publicPlan),
    errors,
    truncated: discovery.truncated || plans.some((plan) => plan.repository.truncated),
    planDocsPackage: packageState || { available: false, enabled: false, status: "missing" },
  };
}

export function findPlanByKey(snapshot, key) {
  const plan = snapshot.plans.find((item) => item.key === key);
  if (!plan) throw new Error("unknown plan key");
  return plan;
}

export function readPlanDocument(snapshot, key) {
  const publicRecord = findPlanByKey(snapshot, key);
  if (!publicRecord.absolutePath) throw new Error("plan file path unavailable");
  const repoRoot = publicRecord.repository.root;
  const realRepo = fs.realpathSync(repoRoot);
  const realFile = fs.realpathSync(publicRecord.absolutePath);
  if (!inside(realRepo, realFile)) throw new Error("plan file escaped repository boundary");
  const stat = fs.statSync(realFile);
  const tooLarge = stat.size > MAX_DOC_BYTES;
  const markdown = tooLarge ? "" : fs.readFileSync(realFile, "utf8");
  const parsed = tooLarge ? null : parsePlanMarkdown(markdown, {
    repository: stripRepositoryRoot(publicRecord.repository),
    relativePath: publicRecord.plan.relativePath,
  });
  return {
    plan: stripPrivatePath(publicRecord),
    markdown,
    html: tooLarge ? "<p>Document is over 1 MiB and was not rendered.</p>" : renderMarkdown(markdown),
    parsed,
  };
}

export function buildPrompt(action, selectedPlans, { mode = "repository-aware" } = {}) {
  const safeAction = String(action || "review").replace(/[^a-z-]/g, "") || "review";
  const plans = selectedPlans.map((record) => record.plan ? record : stripPrivatePath(record));
  if (mode === "portable") {
    return [
      `/plan-docs ${safeAction}`,
      "",
      "Use this bounded portable plan context. Request more repository context when needed.",
      "",
      ...plans.map((item) => portablePlanSummary(item)),
    ].join("\n");
  }
  return [
    `/plan-docs ${safeAction}`,
    "",
    ...plans.map((item) => `Work with plan \`${item.plan.id || item.plan.title}\` at \`${item.plan.relativePath}\` in repository \`${item.repository.name}\`.`),
    "",
    "Verify material claims against the current repository before changing lifecycle or marking work complete.",
  ].join("\n");
}

function immediateChildren(root, ignored) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => !ignored.has(entry.name))
    .map((entry) => path.join(root, entry.name));
}

function candidateRepository(dir) {
  const hasGit = fs.existsSync(path.join(dir, ".git"));
  const hasPlans = fs.existsSync(path.join(dir, "docs", "plans"));
  if (!hasGit && !hasPlans) return null;
  const root = fs.realpathSync(dir);
  const git = gitInfo(root);
  return {
    id: stableKey(root),
    name: path.basename(root),
    root,
    gitHead: git.head,
    branch: git.branch,
    gitAvailable: git.available,
  };
}

function discoverPlansInRepository(repository) {
  const plansDir = path.join(repository.root, "docs", "plans");
  const files = [];
  const errors = [];
  let truncated = false;
  walkPlans(plansDir, repository.root, files, errors);
  files.sort();
  if (files.length > MAX_PLANS_PER_REPO) {
    files.length = MAX_PLANS_PER_REPO;
    truncated = true;
  }
  const repositoryWithState = { ...repository, truncated, errors };
  return files.map((absolutePath) => readPlanRecord(repositoryWithState, absolutePath));
}

function walkPlans(dir, repoRoot, files, errors) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code !== "ENOENT") errors.push({ path: relative(repoRoot, dir), error: String(err?.message || err) });
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name.endsWith("~") || entry.name.endsWith(".swp")) continue;
    const full = path.join(dir, entry.name);
    let real;
    try { real = fs.realpathSync(full); } catch { continue; }
    if (!inside(repoRoot, real)) continue;
    if (entry.isDirectory()) {
      walkPlans(full, repoRoot, files, errors);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
  }
}

function readPlanRecord(repository, absolutePath) {
  const relativePath = relative(repository.root, absolutePath);
  const stat = fs.statSync(absolutePath);
  const cached = planRecordCache.get(absolutePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.repositoryRoot === repository.root) {
    // Repository-level fields (truncated/errors) can change between scans even when the file
    // itself hasn't, so refresh those on the cached record instead of trusting them blindly.
    return { ...cached.record, repository };
  }
  const record = buildPlanRecord(repository, absolutePath, relativePath, stat);
  planRecordCache.set(absolutePath, { mtimeMs: stat.mtimeMs, repositoryRoot: repository.root, record });
  return record;
}

function buildPlanRecord(repository, absolutePath, relativePath, stat) {
  const tooLarge = stat.size > MAX_DOC_BYTES;
  const markdown = tooLarge ? "" : fs.readFileSync(absolutePath, "utf8");
  const parsed = tooLarge ? emptyParsed("Document is over 1 MiB and was not parsed.") : parsePlanMarkdown(markdown, { repository, relativePath });
  const lifecycle = lifecycleFromPath(relativePath);
  const git = gitFileInfo(repository.root, relativePath, parsed.frontmatter.reviewed_commit);
  const validation = validateParsedPlan(parsed, { lifecycle });
  const warnings = [...parsed.warnings, ...validation.warnings];
  if (tooLarge) warnings.push("Document is over 1 MiB and was not rendered or embedded in prompts.");
  return {
    key: stableKey(`${repository.root}:${relativePath}`),
    absolutePath,
    repository,
    plan: {
      id: parsed.frontmatter.id || "",
      title: parsed.title || path.basename(relativePath, ".md"),
      relativePath,
      lifecycle,
      readiness: validation.ready ? "ready" : "draft",
      priority: parsed.frontmatter.priority || "none",
      nextAction: parsed.frontmatter.next_action || "",
      blockers: parsed.frontmatter.blocked_by || [],
      dependencies: parsed.frontmatter.depends_on || [],
      related: parsed.frontmatter.related || [],
      reviewedCommit: parsed.frontmatter.reviewed_commit || "",
      reviewState: git.reviewState,
      modifiedAt: stat.mtime.toISOString(),
      gitLastChangedAt: git.lastChangedAt,
      gitStatus: git.status,
      taskCounts: parsed.taskCounts,
      headings: parsed.headings,
      excerpt: excerpt(markdown),
      validation: { valid: warnings.length === 0, warnings },
    },
  };
}

export function parsePlanMarkdown(markdown, context = {}) {
  const { frontmatter, body, warnings } = parseFrontmatter(markdown);
  const lines = body.split("\n");
  const headings = [];
  const tasks = [];
  let title = "";
  lines.forEach((line, index) => {
    const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (h) {
      const heading = { depth: h[1].length, text: h[2].trim(), line: index + 1 };
      headings.push(heading);
      if (!title && heading.depth === 1) title = heading.text;
    }
    const t = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line);
    if (t) tasks.push({ done: t[1].toLowerCase() === "x", text: t[2].trim(), line: index + 1 });
  });
  return {
    context,
    frontmatter,
    warnings,
    title,
    headings,
    tasks,
    taskCounts: {
      total: tasks.length,
      complete: tasks.filter((task) => task.done).length,
      remaining: tasks.filter((task) => !task.done).length,
    },
  };
}

export function parseFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) return { frontmatter: {}, body: markdown, warnings: ["Missing frontmatter."] };
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: markdown, warnings: ["Unclosed frontmatter."] };
  const raw = markdown.slice(4, end).split("\n");
  const body = markdown.slice(end + 4).replace(/^\n/, "");
  const frontmatter = {};
  const warnings = [];
  let current = null;
  raw.forEach((line, index) => {
    if (!line.trim()) return;
    const list = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (list && current) {
      frontmatter[current].push(list[1]);
      return;
    }
    const match = /^([a-zA-Z_][a-zA-Z0-9_-]*):(?:\s*(.*))?$/.exec(line);
    if (!match) {
      warnings.push(`Unsupported frontmatter syntax on line ${index + 1}.`);
      current = null;
      return;
    }
    const [, key, value = ""] = match;
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) warnings.push(`Duplicate frontmatter key: ${key}.`);
    if (value === "[]") {
      frontmatter[key] = [];
      current = null;
    } else if (value === "") {
      frontmatter[key] = arrayField(key) ? [] : "";
      current = arrayField(key) ? key : null;
    } else if (/^\[.+\]$/.test(value)) {
      warnings.push(`Unsupported inline array for ${key}; use block list or [].`);
      frontmatter[key] = [];
      current = null;
    } else {
      frontmatter[key] = value.replace(/^["']|["']$/g, "");
      current = null;
    }
  });
  return { frontmatter: normalizeFrontmatter(frontmatter, warnings), body, warnings };
}

function normalizeFrontmatter(frontmatter, warnings) {
  for (const key of ["blocked_by", "depends_on", "related"]) {
    if (frontmatter[key] === undefined) frontmatter[key] = [];
    if (!Array.isArray(frontmatter[key])) {
      warnings.push(`${key} must be an array.`);
      frontmatter[key] = [];
    }
  }
  if (frontmatter.priority && !PRIORITIES.has(frontmatter.priority)) warnings.push(`Invalid priority: ${frontmatter.priority}.`);
  if (frontmatter.id && !/^[a-z0-9][a-z0-9-]*$/.test(frontmatter.id)) warnings.push(`Invalid id: ${frontmatter.id}.`);
  return frontmatter;
}

function validateParsedPlan(parsed, { lifecycle }) {
  const headingNames = new Set(parsed.headings.map((h) => normalizeHeading(h.text)));
  const warnings = [];
  const has = (...names) => names.some((name) => headingNames.has(name));
  if (!parsed.title) warnings.push("Missing H1 title.");
  if (!parsed.frontmatter.id) warnings.push("Missing frontmatter id.");
  if (!parsed.frontmatter.priority) warnings.push("Missing frontmatter priority.");
  if (parsed.frontmatter.priority && !PRIORITIES.has(parsed.frontmatter.priority)) warnings.push("Priority must be high, medium, low, or none.");
  if (lifecycle === "unclassified") warnings.push("Plan file is unclassified; move it into a lifecycle folder.");
  if (!has("summary")) warnings.push("Missing Summary section.");
  if (!has("goals", "goal", "desired outcome", "desired outcomes")) warnings.push("Missing Goals or desired outcome section.");
  if (!has("current state", "context")) warnings.push("Missing Current state or Context section.");
  if (!has("proposed design", "implementation plan", "implementation")) warnings.push("Missing proposed design or implementation approach.");
  if (!has("validation", "acceptance criteria", "success criteria")) warnings.push("Missing Validation or acceptance criteria.");
  if ((lifecycle === "active" || lifecycle === "backlog") && !parsed.frontmatter.next_action) warnings.push("Missing next_action for actionable lifecycle.");
  if (lifecycle === "completed") {
    if (parsed.taskCounts.remaining > 0) warnings.push("Completed plan has unchecked tasks.");
    if (parsed.frontmatter.next_action) warnings.push("Completed plan still has next_action.");
    if (parsed.frontmatter.blocked_by?.length) warnings.push("Completed plan still has blockers.");
  }
  return { ready: warnings.length === 0, warnings };
}

function relationshipWarnings(plans) {
  const byRepoAndId = new Map();
  for (const record of plans) {
    if (!record.plan.id) continue;
    const key = `${record.repository.root}:${record.plan.id}`;
    if (!byRepoAndId.has(key)) byRepoAndId.set(key, []);
    byRepoAndId.get(key).push(record);
  }
  const warnings = new Map();
  for (const matches of byRepoAndId.values()) {
    if (matches.length < 2) continue;
    for (const record of matches) addWarning(warnings, record.key, `Duplicate plan id: ${record.plan.id}.`);
  }
  for (const record of plans) {
    for (const dep of record.plan.dependencies || []) {
      if (dep === record.plan.id) addWarning(warnings, record.key, "Plan depends on itself.");
      if (!byRepoAndId.has(`${record.repository.root}:${dep}`)) addWarning(warnings, record.key, `Dependency not found: ${dep}.`);
    }
  }
  return warnings;
}

function gitInfo(root) {
  const head = git(root, ["rev-parse", "--verify", "HEAD"]);
  const branch = git(root, ["branch", "--show-current"]);
  return { available: head.ok, head: head.ok ? head.stdout : null, branch: branch.ok ? branch.stdout : null };
}

function gitFileInfo(root, relativePath, reviewedCommit) {
  const last = git(root, ["log", "-1", "--format=%cI", "--", relativePath]);
  const status = git(root, ["status", "--porcelain", "--", relativePath]);
  let reviewState = "never-reviewed";
  if (reviewedCommit) {
    const head = git(root, ["rev-parse", "--verify", "HEAD"]);
    const ancestor = head.ok ? git(root, ["merge-base", "--is-ancestor", reviewedCommit, "HEAD"]) : { ok: false };
    if (!head.ok || !ancestor.ok) reviewState = "unknown";
    else reviewState = reviewedCommit === head.stdout ? "current" : "possibly-stale";
  }
  return {
    lastChangedAt: last.ok ? last.stdout : null,
    status: status.ok && status.stdout ? status.stdout : null,
    reviewState,
  };
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return { ok: result.status === 0, stdout: (result.stdout || "").trim() };
}

function renderMarkdown(markdown) {
  const { body } = parseFrontmatter(markdown);
  const html = [];
  let inList = false;
  let inCode = false;
  for (const raw of body.split("\n")) {
    if (/^```/.test(raw)) {
      html.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      html.push(escapeHtml(raw) + "\n");
      continue;
    }
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<h${h[1].length}>${inline(escapeHtml(h[2]))}</h${h[1].length}>`);
      continue;
    }
    const li = /^\s*[-*]\s+(?:\[([ xX])\]\s+)?(.+)$/.exec(line);
    if (li) {
      if (!inList) { html.push("<ul>"); inList = true; }
      const box = li[1] ? `<input type="checkbox" disabled${li[1].toLowerCase() === "x" ? " checked" : ""}> ` : "";
      html.push(`<li>${box}${inline(escapeHtml(li[2]))}</li>`);
      continue;
    }
    if (inList) { html.push("</ul>"); inList = false; }
    if (line.trim()) html.push(`<p>${inline(escapeHtml(line))}</p>`);
  }
  if (inList) html.push("</ul>");
  if (inCode) html.push("</code></pre>");
  return html.join("\n");
}

function inline(text) {
  return text.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function publicPlan(record) {
  return {
    key: record.key,
    absolutePath: record.absolutePath,
    repository: publicRepository(record.repository),
    plan: record.plan,
  };
}

function stripPrivatePath(record) {
  const { absolutePath, repository, ...rest } = record;
  return { ...rest, repository: stripRepositoryRoot(repository) };
}

function stripRepositoryRoot(repository) {
  const { root, ...publicRepo } = repository || {};
  return publicRepo;
}

function publicRepository(repo) {
  return {
    id: repo.id,
    name: repo.name,
    root: repo.root,
    gitHead: repo.gitHead,
    branch: repo.branch,
    gitAvailable: repo.gitAvailable,
  };
}

function portablePlanSummary(item) {
  return [
    `Repository: ${item.repository.name}`,
    `Path: ${item.plan.relativePath}`,
    `ID: ${item.plan.id || "(missing)"}`,
    `Lifecycle: ${item.plan.lifecycle}`,
    `Priority: ${item.plan.priority}`,
    `Next action: ${item.plan.nextAction || "(none)"}`,
    `Warnings: ${item.plan.validation.warnings.slice(0, 5).join("; ") || "none"}`,
    `Excerpt: ${item.plan.excerpt || "(none)"}`,
    "",
  ].join("\n");
}

function lifecycleFromPath(relativePath) {
  const parts = relativePath.split(/[\\/]/);
  if (parts[0] !== "docs" || parts[1] !== "plans") return "unknown";
  const lifecycle = parts[2];
  return LIFECYCLES.has(lifecycle) ? lifecycle : "unclassified";
}

function normalizeHeading(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function excerpt(markdown) {
  return markdown
    .replace(/^---[\s\S]*?\n---\n?/, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .join(" ")
    .slice(0, 500);
}

function emptyParsed(warning) {
  return { frontmatter: {}, warnings: [warning], title: "", headings: [], tasks: [], taskCounts: { total: 0, complete: 0, remaining: 0 } };
}

function arrayField(key) {
  return ["blocked_by", "depends_on", "related"].includes(key);
}

function addWarning(map, key, warning) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(warning);
}

function relative(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function stableKey(input) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolveProjectIdentity, canonicalRepositoryId, providerUrlForRepositoryId } from "../repositories/index.mjs";
import { finding, messagesOf } from "./findings.mjs";
import { validateForLifecycle } from "./lifecycle-policy.mjs";
import { buildRepairPrompt } from "./repair-prompt.mjs";
import { classifyPlanId, isExternalBlocker } from "./plan-id.mjs";
import { renderMarkdown } from "../../scripts/cli/markdown-render.mjs";

export const LIFECYCLES = new Set(["backlog", "active", "completed", "archived"]);
export const PRIORITIES = new Set(["high", "medium", "low", "none"]);
const DEFAULT_IGNORED = new Set([
  "node_modules", ".git", "vendor", "dist", "build",
  ".cache", "coverage", ".next", ".venv", "__pycache__",
]);
const MAX_DOC_BYTES = 1024 * 1024;
const MAX_REPOS = 250;
const MAX_PLANS_PER_REPO = 500;
// Repo-discovery traversal limits — guard against a misconfigured discovery root (e.g. $HOME or
// /) walking indefinitely or across the whole filesystem.
const DISCOVERY_MAX_DEPTH = 6;
// Overridable so tests can force truncation deterministically (set to 0ms against a normal-size
// tree) instead of needing a real slow scan or a huge synthetic directory tree.
const DISCOVERY_TIME_BUDGET_MS = process.env.ROBOREPO_DISCOVERY_TIME_BUDGET_MS !== undefined
  ? Number(process.env.ROBOREPO_DISCOVERY_TIME_BUDGET_MS)
  : 5000;

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
  const visitedReal = new Set(); // realpath'd dirs already descended into (symlink-cycle guard)
  let truncated = false;
  const deadline = Date.now() + DISCOVERY_TIME_BUDGET_MS;

  const addRepo = (candidate) => {
    if (repositories.length >= MAX_REPOS) {
      truncated = true;
      return true; // stop
    }
    const repo = candidateRepository(candidate);
    if (repo && !seen.has(repo.root)) {
      seen.add(repo.root);
      repositories.push(repo);
    }
    return false;
  };

  // Recursive walk from `dir`. Stops descending the moment a folder is itself an eligible repo
  // (has a .git entry) — a repo's internal subfolders are never re-scanned as repo candidates.
  const walk = (dir, depth) => {
    if (truncated) return;
    // >= not >: with a 0ms budget the deadline equals the start time, and a walk that begins within
    // the same millisecond would otherwise skip the check entirely. Identical behavior at the real
    // 5000ms budget; only makes the exhausted-budget case deterministic.
    if (Date.now() >= deadline) {
      truncated = true;
      return;
    }
    if (depth > DISCOVERY_MAX_DEPTH) return;
    let real;
    try {
      real = fs.realpathSync(dir);
    } catch {
      return;
    }
    if (visitedReal.has(real)) return; // symlink cycle guard
    visitedReal.add(real);

    // A folder counts as an eligible repo root the moment it has EITHER a .git entry or a
    // docs/plans dir (matches the pre-existing candidateRepository contract) — stop descending
    // past it either way so a repo's own subfolders are never re-scanned as repo candidates.
    if (fs.existsSync(path.join(dir, ".git")) || fs.existsSync(path.join(dir, "docs", "plans"))) {
      addRepo(dir);
      return;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // Permission-denied or otherwise unreadable mid-walk: don't abort the whole scan, just skip
      // this branch (matches walkPlans()'s existing error-tolerant pattern).
      errors.push({ root: dir, error: String(err?.message || err) });
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (ignored.has(entry.name)) continue;
      if (truncated) return;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };

  for (const rootText of settings.discoveryRoots || []) {
    let root;
    try {
      root = normalizeRootInput(rootText);
    } catch (err) {
      errors.push({ root: rootText, error: String(err?.message || err) });
      continue;
    }
    walk(root, 0);
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
  const relationships = relationshipFindings(plans);
  for (const plan of plans) {
    const validation = plan.plan.validation;
    validation.findings.push(...(relationships.get(plan.key) || []));
    validation.warnings = messagesOf(validation.findings);
    validation.valid = validation.findings.length === 0;
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

// Stable-identity lookup: plan `id` (frontmatter) survives a lifecycle move even though `key`
// (hashed from repo root + relative path) does not. `id` uniqueness is only enforced within a
// single repository (see relationshipWarnings' `${repository.root}:${plan.id}` dedup key), so a
// `repositoryId` is required to disambiguate when the same id could exist in two repos. An empty
// id ("" — the buildPlanRecord fallback for plans with no frontmatter id) never matches.
export function findPlanById(snapshot, id, repositoryId) {
  if (!id) return null;
  return snapshot.plans.find((item) => item.plan.id === id && (!repositoryId || item.repository.id === repositoryId)) || null;
}

// Builds a structured domain error every mutation throw site uses, so the CLI/route layer has one
// shape to serialize instead of pattern-matching ad hoc `.code` properties.
function domainError(code, message, { resolution, details, findings, repair, status } = {}) {
  const err = new Error(message);
  err.code = code;
  if (resolution !== undefined) err.resolution = resolution;
  if (details !== undefined) err.details = details;
  // Structured findings and the generated repair prompt ride along on readiness failures. Both
  // must also be listed in portal-routes-plans' sendDomainError and portalPostJson, which
  // whitelist error keys explicitly.
  if (findings !== undefined) err.findings = findings;
  if (repair !== undefined) err.repair = repair;
  err.status = status ?? DOMAIN_ERROR_STATUS[code] ?? 400;
  return err;
}

const DOMAIN_ERROR_STATUS = {
  INVALID_CHANGE: 400,
  STALE_PLAN: 409,
  DESTINATION_EXISTS: 409,
  LIFECYCLE_REQUIREMENTS: 422,
  PLAN_NOT_FOUND: 404,
  MOVE_FAILED: 500,
};

// Two-stage resolution shared by every mutation: locate the record the client expects by `key`
// first (the common case — nothing has moved), then re-resolve by stable `id` when the key no
// longer exists, since a lifecycle move changes `key` but not `id`. Throws PLAN_NOT_FOUND only
// when neither resolves.
function resolvePlanForMutation(snapshot, { id, key, repositoryId }) {
  const byKey = snapshot.plans.find((item) => item.key === key);
  if (byKey) return byKey;
  const byId = findPlanById(snapshot, id, repositoryId);
  if (byId) return byId;
  throw domainError("PLAN_NOT_FOUND", "This plan can no longer be found. Refresh and try again, or restore the file if it was deleted.");
}

// Validates the resolved record still matches what the client last saw. A key/lifecycle/path
// mismatch while the stable id still resolves means the file moved since the client loaded it
// (report where it is now); a straight mtime/field mismatch means it was edited in place.
// `expectedField`/`expectedValue` is the generic form any mutated scalar property can use
// (see updatePlanField); expectedLifecycle/expectedPriority stay as named params since
// movePlanLifecycle and updatePlanPriority's public contracts already key off those exact names.
function assertExpectedState(record, { key, expectedLifecycle, expectedPriority, expectedField, expectedValue, mtimeMs }) {
  const mismatches = [];
  if (key !== undefined && record.key !== key) mismatches.push(`moved to ${record.plan.relativePath}`);
  if (expectedLifecycle !== undefined && record.plan.lifecycle !== expectedLifecycle) mismatches.push(`lifecycle is now ${record.plan.lifecycle}`);
  if (expectedPriority !== undefined && record.plan.priority !== expectedPriority) mismatches.push(`priority is now ${record.plan.priority}`);
  if (expectedField !== undefined && record.plan[expectedField] !== expectedValue) mismatches.push(`${expectedField} is now ${record.plan[expectedField]}`);
  if (mtimeMs !== undefined && record.mtimeMs !== mtimeMs) mismatches.push("file changed on disk");
  if (mismatches.length === 0) return;
  throw domainError("STALE_PLAN", "This plan changed outside the portal, so the update wasn't applied.", {
    resolution: "The page will refresh to show the current state.",
    details: [...mismatches, `current lifecycle: ${record.plan.lifecycle}`, `current path: ${record.plan.relativePath}`],
  });
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
    // The shared renderer (scripts/cli/markdown-render.mjs -- also backing Config's skill popup and
    // the Telemetry guide) replaced a private mini-renderer here that had no tables, mermaid,
    // ordered lists, blockquotes, links, or horizontal rules. Frontmatter is stripped first: it is
    // plan metadata already rendered as structured drawer fields, not body prose.
    html: tooLarge
      ? "<p>Document is over 1 MiB and was not rendered.</p>"
      : renderMarkdown(parseFrontmatter(markdown).body),
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

function candidateRepository(dir) {
  const hasGit = fs.existsSync(path.join(dir, ".git"));
  const hasPlans = fs.existsSync(path.join(dir, "docs", "plans"));
  if (!hasGit && !hasPlans) return null;
  const root = fs.realpathSync(dir);
  const git = gitInfo(root);
  // Canonical repository identity shared with Localhoster/Telemetry. git repos resolve to their
  // portable git: id; non-git plan roots get an opaque local: id. The existing content-hash `id`
  // is retained for back-compat during the migration window (browser filters still key on it until
  // Phase 4's global scope lands).
  const resolved = resolveProjectIdentity(root, "plan-docs");
  const repositoryId = canonicalRepositoryId(resolved);
  return {
    id: stableKey(root),
    repositoryId,
    name: path.basename(root),
    root,
    providerUrl: providerUrlForRepositoryId(repositoryId),
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
  const parsed = tooLarge ? emptyParsed("DOCUMENT_TOO_LARGE") : parsePlanMarkdown(markdown, { repository, relativePath });
  const lifecycle = lifecycleFromPath(relativePath);
  const git = gitFileInfo(repository.root, relativePath, parsed.frontmatter.reviewed_commit);
  const validation = validateParsedPlan(parsed, { lifecycle });
  const findings = [...parsed.findings, ...validation.findings];
  if (tooLarge) findings.push(finding("DOCUMENT_TOO_LARGE_TO_RENDER"));
  const warnings = messagesOf(findings);
  return {
    key: stableKey(`${repository.root}:${relativePath}`),
    absolutePath,
    mtimeMs: stat.mtimeMs,
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
      // `warnings` is the display-string projection of `findings`, derived here so the two can
      // never drift. Existing consumers (search corpus, health filter, card badge, drawer list,
      // portable prompt summary) read the strings; the dialog and repair prompt read the findings.
      validation: { valid: findings.length === 0, findings, warnings },
    },
  };
}

export function parsePlanMarkdown(markdown, context = {}) {
  const { frontmatter, body, warnings, findings } = parseFrontmatter(markdown);
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
  // A heading "has content" when at least one non-blank line sits between it and the next
  // heading (or EOF) — used to distinguish a real section from a bare, empty heading (e.g. an
  // empty "## Verification" that satisfies has("verification") by name alone).
  headings.forEach((heading, index) => {
    const sectionEnd = headings[index + 1]?.line ?? lines.length + 1;
    heading.hasContent = lines.slice(heading.line, sectionEnd - 1).some((line) => line.trim().length > 0);
  });
  return {
    context,
    frontmatter,
    findings,
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
  const bail = (code) => {
    const findings = [finding(code)];
    return { frontmatter: {}, body: markdown, findings, warnings: messagesOf(findings) };
  };
  if (!markdown.startsWith("---\n")) return bail("MISSING_FRONTMATTER");
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return bail("UNCLOSED_FRONTMATTER");
  const raw = markdown.slice(4, end).split("\n");
  const body = markdown.slice(end + 4).replace(/^\n/, "");
  const frontmatter = {};
  const findings = [];
  let current = null;
  raw.forEach((line, index) => {
    if (!line.trim()) return;
    const list = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (list && current) {
      // Unquote the same way scalar values are. An entry gets quoted precisely when it contains a
      // colon — an external blocker reads as prose — and leaving the quotes attached would make the
      // value fail every downstream check that inspects its prefix.
      frontmatter[current].push(list[1].replace(/^["']|["']$/g, ""));
      return;
    }
    const match = /^([a-zA-Z_][a-zA-Z0-9_-]*):(?:\s*(.*))?$/.exec(line);
    if (!match) {
      findings.push(finding("UNSUPPORTED_FRONTMATTER_SYNTAX", { meta: { line: index + 1 } }));
      current = null;
      return;
    }
    const [, key, value = ""] = match;
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
      findings.push(finding("DUPLICATE_FRONTMATTER_KEY", { meta: { key } }));
    }
    if (value === "[]") {
      frontmatter[key] = [];
      current = null;
    } else if (value === "") {
      frontmatter[key] = arrayField(key) ? [] : "";
      current = arrayField(key) ? key : null;
    } else if (/^\[.*\]$/.test(value)) {
      frontmatter[key] = parseInlineArray(value);
      current = null;
    } else {
      frontmatter[key] = value.replace(/^["']|["']$/g, "");
      current = null;
    }
  });
  return {
    frontmatter: normalizeFrontmatter(frontmatter, findings),
    body,
    findings,
    warnings: messagesOf(findings),
  };
}

// Narrow scalar-only frontmatter writer: patches one `key: value` line in place, preserving key
// order, blank lines, and the entire body byte-for-byte. Appends the key (at the end of the
// frontmatter block) when it's missing entirely — a plan with no `priority:` line at all renders
// the same "none" fallback in buildPlanRecord() as one with an empty value, so the writer must be
// able to turn either into a real on-disk line. Does not support list fields (blocked_by etc).
export // YAML flow sequences (`related: [a, b]`). Both list forms are valid YAML and authors write both,
// so the parser accepts both rather than reporting one as unsupported. Splitting respects quotes,
// because a quoted entry may legitimately contain a comma — an external blocker reads as prose, not
// as an id.
function parseInlineArray(value) {
  const inner = value.slice(1, -1);
  const entries = [];
  let buffer = "";
  let quote = null;
  for (const char of inner) {
    if (quote) {
      if (char === quote) quote = null;
      else buffer += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ",") {
      entries.push(buffer);
      buffer = "";
      continue;
    }
    buffer += char;
  }
  entries.push(buffer);
  return entries.map((entry) => entry.trim()).filter(Boolean);
}

export function writeFrontmatterField(markdown, key, value) {
  if (!markdown.startsWith("---\n")) throw new Error("missing frontmatter");
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) throw new Error("unclosed frontmatter");
  const rawLines = markdown.slice(4, end).split("\n");
  const bodyAndClose = markdown.slice(end);
  const pattern = new RegExp(`^${key}:.*$`);
  let found = false;
  const updated = rawLines.map((line) => {
    if (pattern.test(line)) {
      found = true;
      return `${key}: ${value}`;
    }
    return line;
  });
  if (!found) updated.push(`${key}: ${value}`);
  return `---\n${updated.join("\n")}${bodyAndClose}`;
}

// Pure path builder for a lifecycle move destination. Filename is preserved unchanged — lifecycle
// moves never rename the file.
function resolveDestinationPath(repositoryRoot, lifecycle, filename) {
  return path.join(repositoryRoot, "docs", "plans", lifecycle, filename);
}

// Resolves the real (symlink-followed) path of a plan file expected to still be at
// `absolutePath`. Translates a missing file into STALE_PLAN rather than leaking a raw ENOENT —
// the file may have moved externally (the stable id could still resolve elsewhere on a rescan)
// or been deleted; either way it's a stale-state conflict, not a generic filesystem error.
function realpathOrStale(absolutePath) {
  try {
    return fs.realpathSync(absolutePath);
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw domainError("STALE_PLAN", "This plan changed outside the portal, so the update wasn't applied.", {
        resolution: "The page will refresh to show the current state.",
        details: ["the file is no longer at its last known location"],
      });
    }
    throw err;
  }
}

// Rebuilds and caches a full public plan record for a file already on disk at `absolutePath`,
// reusing the same buildPlanRecord/readPlanRecord path the snapshot scanner uses, so mutation
// results have the identical shape (and warnings/readiness/etc are freshly derived) as a record
// that came from a normal scan.
function rebuildPlanRecordAt(repository, absolutePath) {
  const relativePath = relative(repository.root, absolutePath);
  const stat = fs.statSync(absolutePath);
  const record = buildPlanRecord(repository, absolutePath, relativePath, stat);
  planRecordCache.set(absolutePath, { mtimeMs: stat.mtimeMs, repositoryRoot: repository.root, record });
  return publicPlan(record);
}

// Per-field validators for the generic scalar frontmatter mutation below. Only fields meant to be
// human-edited via the portal belong here — see plan-schema.md's field-by-field rules for which
// frontmatter keys are UI-editable vs. author/automated-tooling-only (id and reviewed_commit are
// never UI-edited; blocked_by/depends_on/related are arrays writeFrontmatterField can't touch).
const FIELD_VALIDATORS = {
  priority: (value) => PRIORITIES.has(value),
};

// Generic scalar frontmatter field mutation: validate the new value, confirm the record hasn't
// gone stale, patch the one frontmatter line, and return the same { change, record } shape every
// mutation in this module returns. Only fields listed in FIELD_VALIDATORS are accepted.
export function updatePlanField(snapshot, { id, key, property, value, expectedValue, mtimeMs, repositoryId }) {
  const validate = FIELD_VALIDATORS[property];
  if (!validate) throw domainError("INVALID_CHANGE", `field not editable: ${property}`);
  if (!validate(value)) throw domainError("INVALID_CHANGE", `invalid ${property}`);
  const record = resolvePlanForMutation(snapshot, { id, key, repositoryId });
  assertExpectedState(record, { key, expectedField: property, expectedValue, mtimeMs });
  if (!record.absolutePath) throw domainError("PLAN_NOT_FOUND", "plan file path unavailable");
  const repoRoot = record.repository.root;
  const realRepo = fs.realpathSync(repoRoot);
  const realFile = realpathOrStale(record.absolutePath);
  if (!inside(realRepo, realFile)) throw domainError("MOVE_FAILED", "plan file escaped repository boundary");
  const markdown = fs.readFileSync(realFile, "utf8");
  const updated = writeFrontmatterField(markdown, property, value);
  fs.writeFileSync(realFile, updated);
  planRecordCache.delete(record.absolutePath);
  const rebuilt = rebuildPlanRecordAt(record.repository, realFile);
  return {
    change: { property, previousValue: record.plan[property], newValue: value },
    record: rebuilt,
  };
}

export function updatePlanPriority(snapshot, { id, key, priority, expectedPriority, mtimeMs, repositoryId }) {
  return updatePlanField(snapshot, { id, key, property: "priority", value: priority, expectedValue: expectedPriority, mtimeMs, repositoryId });
}

// Implements the doc's 11-step lifecycle-move validation order: enum check, stable-identity
// resolution, stale-state check, repository-boundary confirmation, destination construction,
// collision check, destination-requirement validation, then the atomic rename.
export function movePlanLifecycle(snapshot, { id, key, lifecycle, expectedLifecycle, mtimeMs, repositoryId, skipDestinationValidation = false }) {
  if (!LIFECYCLES.has(lifecycle)) throw domainError("INVALID_CHANGE", `invalid lifecycle: ${lifecycle}`);
  const record = resolvePlanForMutation(snapshot, { id, key, repositoryId });
  if (record.plan.lifecycle === lifecycle) throw domainError("INVALID_CHANGE", `plan is already ${lifecycle}`);
  assertExpectedState(record, { key, expectedLifecycle, mtimeMs });
  if (!record.absolutePath) throw domainError("PLAN_NOT_FOUND", "plan file path unavailable");

  const repoRoot = record.repository.root;
  const realRepo = fs.realpathSync(repoRoot);
  const realFile = realpathOrStale(record.absolutePath);
  if (!inside(realRepo, realFile)) throw domainError("MOVE_FAILED", "plan file escaped repository boundary");

  const filename = path.basename(realFile);
  const destination = resolveDestinationPath(realRepo, lifecycle, filename);
  if (!inside(realRepo, destination)) throw domainError("MOVE_FAILED", "destination escaped repository boundary");

  const destinationOccupied = (() => {
    try {
      fs.lstatSync(destination);
      return true;
    } catch (err) {
      if (err?.code === "ENOENT") return false;
      throw err;
    }
  })();
  if (destinationOccupied) throw domainError("DESTINATION_EXISTS", "A file already exists at the destination.");

  // Non-blocking by design: the first call always validates and, if incomplete, throws
  // LIFECYCLE_REQUIREMENTS so the client can show what's missing. The client re-submits with
  // skipDestinationValidation once the user confirms "move anyway" — this is a soft warning, not
  // a hard gate, because most existing plan docs predate the plan-docs schema and can't cleanly
  // satisfy every section/next_action/verification check without a dedicated backfill pass.
  //
  // Validation reads the file from disk rather than trusting the snapshot record, so the findings
  // (and the repair prompt generated from them) always describe the document as it is right now.
  // An edit made since the page loaded is picked up here.
  if (!skipDestinationValidation) {
    const markdown = fs.readFileSync(realFile, "utf8");
    const publicRepository = stripRepositoryRoot(record.repository);
    const parsed = parsePlanMarkdown(markdown, { repository: publicRepository, relativePath: record.plan.relativePath });
    const destinationValidation = validateParsedPlan(parsed, { lifecycle });
    if (!destinationValidation.ready) {
      throw domainError("LIFECYCLE_REQUIREMENTS", `Couldn't move "${record.plan.title}" to ${capitalize(lifecycle)}.`, {
        resolution: "Complete or remove the listed items, then try again — or move anyway.",
        details: destinationValidation.warnings,
        findings: destinationValidation.findings,
        // Generated here, from this same fresh validation, rather than exposing a second endpoint
        // the client could call with its own findings — the prompt can then never describe
        // requirements different from the ones currently on screen.
        repair: {
          prompt: buildRepairPrompt({
            repository: publicRepository,
            plan: record.plan,
            sourceLifecycle: record.plan.lifecycle,
            destinationLifecycle: lifecycle,
            findings: destinationValidation.findings,
          }),
          planKey: record.key,
          planId: record.plan.id,
        },
      });
    }
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    fs.renameSync(realFile, destination);
  } catch {
    throw domainError("MOVE_FAILED", "Couldn't move the plan file. Nothing was changed.");
  }

  planRecordCache.delete(realFile);
  const rebuilt = rebuildPlanRecordAt(record.repository, destination);
  return {
    change: { property: "lifecycle", previousValue: record.plan.lifecycle, newValue: lifecycle },
    record: rebuilt,
  };
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function normalizeFrontmatter(frontmatter, findings) {
  for (const key of ["blocked_by", "depends_on", "related"]) {
    if (frontmatter[key] === undefined) frontmatter[key] = [];
    if (!Array.isArray(frontmatter[key])) {
      findings.push(finding("NON_ARRAY_FIELD", { meta: { key } }));
      frontmatter[key] = [];
    }
  }
  if (frontmatter.priority && !PRIORITIES.has(frontmatter.priority)) {
    findings.push(finding("INVALID_PRIORITY_VALUE", { meta: { value: frontmatter.priority } }));
  }
  if (frontmatter.id) {
    const idFormat = classifyPlanId(frontmatter.id);
    if (idFormat === "invalid") {
      findings.push(finding("INVALID_ID", { meta: { value: frontmatter.id } }));
    } else if (idFormat === "legacy") {
      // LEGACY(slug-ids): informational only — existing slug ids are valid and must not be
      // rewritten, since ids are the durable identity inbound references resolve against. Reports
      // which convention a plan uses; it is not a backlog item.
      findings.push(finding("LEGACY_SLUG_ID", { meta: { value: frontmatter.id } }));
    }
  }
  return frontmatter;
}

// Thin adapter over the destination-policy module — the rules themselves live in
// lifecycle-policy.mjs, which is pure and filesystem-free so the same evaluation runs from the
// scanner, from movePlanLifecycle, and from tests.
function validateParsedPlan(parsed, { lifecycle }) {
  const { ready, findings } = validateForLifecycle(parsed, { lifecycle, priorities: PRIORITIES, normalizeHeading });
  return { ready, findings, warnings: messagesOf(findings) };
}

// Cross-plan problems, which can only be evaluated once every plan in the snapshot is known —
// hence a separate pass from the per-document validators. Returns findings keyed by plan key.
function relationshipFindings(plans) {
  const byRepoAndId = new Map();
  for (const record of plans) {
    if (!record.plan.id) continue;
    const key = `${record.repository.root}:${record.plan.id}`;
    if (!byRepoAndId.has(key)) byRepoAndId.set(key, []);
    byRepoAndId.get(key).push(record);
  }
  const findings = new Map();
  for (const matches of byRepoAndId.values()) {
    if (matches.length < 2) continue;
    for (const record of matches) {
      addFinding(findings, record.key, finding("DUPLICATE_PLAN_ID", { meta: { id: record.plan.id } }));
    }
  }
  // Every id-bearing field is resolved the same way. Referential integrity is what actually catches
  // a wrong id — a format check only catches a malformed one, so a transposed character in an
  // otherwise well-formed id falls straight through it.
  const RELATIONS = [
    ["dependencies", "DEPENDENCY_NOT_FOUND", "dependency"],
    ["related", "RELATED_NOT_FOUND", "related"],
    ["blockers", "BLOCKER_NOT_FOUND", "blocker"],
  ];
  for (const record of plans) {
    for (const dep of record.plan.dependencies || []) {
      if (dep === record.plan.id) addFinding(findings, record.key, finding("SELF_DEPENDENCY"));
    }
    for (const [field, code, metaKey] of RELATIONS) {
      for (const ref of record.plan[field] || []) {
        if (!ref) continue;
        // An external blocker names something with no plan document, so there is nothing to resolve
        // against. Only `blocked_by` may carry one; depends_on/related are plan-to-plan by design.
        if (field === "blockers" && isExternalBlocker(ref)) continue;
        if (!byRepoAndId.has(`${record.repository.root}:${ref}`)) {
          addFinding(findings, record.key, finding(code, { meta: { [metaKey]: ref } }));
        }
      }
    }
  }
  return findings;
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

function publicPlan(record) {
  return {
    key: record.key,
    absolutePath: record.absolutePath,
    mtimeMs: record.mtimeMs,
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
    repositoryId: repo.repositoryId ?? null,
    name: repo.name,
    root: repo.root,
    providerUrl: repo.providerUrl ?? null,
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

function emptyParsed(code) {
  const findings = [finding(code)];
  return {
    frontmatter: {},
    findings,
    warnings: messagesOf(findings),
    title: "",
    headings: [],
    tasks: [],
    taskCounts: { total: 0, complete: 0, remaining: 0 },
  };
}

function arrayField(key) {
  return ["blocked_by", "depends_on", "related"].includes(key);
}

function addFinding(map, key, item) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(item);
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

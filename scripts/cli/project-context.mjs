// roborepo `project-context` subcommands. Deterministic repo scan that writes generated
// facts a human + the project-context skill can build on. The CLI collects facts only; the
// skill decides how to turn them into curated prose (see globals/agents/skills/project-context).
//
// MVP surface: `inventory`. `init` and `check` are planned follow-ups
// (docs/plans/project-context-v2-plan.md). Output is JSON-only by default; `--summary` also
// writes a short markdown digest. Output is deterministic (stable ordering, no timestamps) so
// it reviews cleanly in diffs.

import fs from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = 1;

const DEFAULT_DOCS_DIR = "docs/project-context";
const GENERATED_SUBDIR = "generated";
const SCAN_FILE = "repo-scan.json";
const SUMMARY_FILE = "repo-summary.md";

// Directories never worth scanning: dependency trees, build output, framework caches, VCS.
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
]);

const MAX_DEPTH = 6;

/** Resolve an optional [path] arg to an absolute path; default = cwd. Matches `index code`. */
function resolveTarget(arg) {
  return arg ? path.resolve(process.cwd(), arg) : process.cwd();
}

/** Read + parse package.json if present; null when missing or malformed. */
function readPackageJson(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Walk the repo once, collecting every file path relative to root, skipping ignored dirs and
 * descending no deeper than MAX_DEPTH. Sorted for deterministic output. One walk feeds every
 * downstream classifier so the scan stays cheap on large trees.
 */
function walkFiles(root) {
  const found = [];
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (depth >= MAX_DEPTH) continue;
        stack.push({ dir: abs, depth: depth + 1 });
      } else if (entry.isFile()) {
        found.push(path.relative(root, abs));
      }
    }
  }
  found.sort();
  return found;
}

const SOURCE_EXT = /\.(t|j)sx?$/;
const isSource = (rel) => SOURCE_EXT.test(rel);

/** First path segment ("src/foo/bar.ts" -> "src"); "" for a root-level file. */
function topSegment(rel) {
  const i = rel.indexOf(path.sep);
  return i === -1 ? "" : rel.slice(0, i);
}

/**
 * Classify scanned files into the plan's fact buckets using path + name heuristics. Heuristics
 * are intentionally conservative: a file matches at most the buckets its path clearly signals,
 * and the skill is expected to verify against the real code rather than trust these labels.
 */
function classify(files) {
  const routes = [];
  const components = [];
  const domainModules = [];
  const dataAccess = [];
  const authAndPermissions = [];
  const schemasAndValidation = [];
  const stateManagement = [];
  const tests = [];
  const docs = [];
  const configFiles = [];

  for (const rel of files) {
    const lower = rel.toLowerCase();
    const base = path.basename(lower);

    if (/\.(md|mdx|rst|txt)$/.test(base) && !base.startsWith("license")) docs.push(rel);
    if (/(^|\/)(\.github\/|dockerfile|docker-compose|\.eslintrc|tsconfig|vite\.config|next\.config|jest\.config|vitest\.config|playwright\.config|\.env\.example)/.test(lower)) {
      configFiles.push(rel);
    }

    if (!isSource(rel)) continue;

    if (/\.(test|spec)\.(t|j)sx?$/.test(base) || /(^|\/)(tests?|__tests__)\//.test(lower)) {
      tests.push(rel);
      continue;
    }
    if (/(^|\/)(pages|routes|app)\//.test(lower) || /(^|\/)route\.(t|j)sx?$/.test(lower)) routes.push(rel);
    if (/(^|\/)(components|ui|widgets)\//.test(lower) || /\.(t|j)sx$/.test(base)) components.push(rel);
    if (/(^|\/)(services|domain|lib\/domain|core)\//.test(lower)) domainModules.push(rel);
    if (/(^|\/)(api|db|database|data|repositories|queries|models)\//.test(lower)) dataAccess.push(rel);
    if (/(auth|permission|authz|ownership|role|session|rbac)/.test(lower)) authAndPermissions.push(rel);
    if (/(schema|validation|validator|zod|yup|joi|valibot)/.test(lower)) schemasAndValidation.push(rel);
    if (/(store|reducer|context|atom|recoil|zustand|redux|signal)/.test(lower)) stateManagement.push(rel);
  }

  return {
    routes,
    components,
    domainModules,
    dataAccess,
    authAndPermissions,
    schemasAndValidation,
    stateManagement,
    tests,
    docs,
    configFiles,
  };
}

/** A sorted top-level folder map with file counts, for quick human orientation. */
function folderMap(files) {
  const counts = new Map();
  for (const rel of files) {
    const seg = topSegment(rel) || "(root)";
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dir, fileCount]) => ({ dir, fileCount }));
}

/**
 * Collect declared env var NAMES only (never values) from .env.example-style files. The plan is
 * explicit: record names, never values.
 */
function envVarNames(root, files) {
  const names = new Set();
  for (const rel of files) {
    if (!/(^|\/)\.env(\.[a-z]+)?$/i.test(rel) && !/\.env\.example$/i.test(rel)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
      if (m) names.add(m[1]);
    }
  }
  return [...names].sort();
}

/** Build the deterministic scan object the plan describes (schemaVersion 1). */
function buildScan(root) {
  const pkg = readPackageJson(root);
  const files = walkFiles(root);
  const buckets = classify(files);

  const commands = pkg?.scripts
    ? Object.keys(pkg.scripts)
        .sort()
        .map((name) => ({ name, run: pkg.scripts[name] }))
    : [];

  const dependencies = {
    runtime: pkg?.dependencies ? Object.keys(pkg.dependencies).sort() : [],
    dev: pkg?.devDependencies ? Object.keys(pkg.devDependencies).sort() : [],
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    project: {
      name: pkg?.name ?? path.basename(root),
      type: detectProjectType(pkg, files),
    },
    commands,
    dependencies,
    folderMap: folderMap(files),
    routes: buckets.routes,
    components: buckets.components,
    domainModules: buckets.domainModules,
    dataAccess: buckets.dataAccess,
    authAndPermissions: buckets.authAndPermissions,
    schemasAndValidation: buckets.schemasAndValidation,
    stateManagement: buckets.stateManagement,
    tests: buckets.tests,
    docs: buckets.docs,
    configFiles: buckets.configFiles,
    envVarNames: envVarNames(root, files),
    fileCount: files.length,
  };
}

/** Best-effort framework label from deps; "unknown" when nothing recognizable. */
function detectProjectType(pkg, files) {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if (deps.next) return "next";
  if (deps["@remix-run/react"] || deps["@remix-run/node"]) return "remix";
  if (deps.react) return "react";
  if (deps.vue) return "vue";
  if (deps.svelte) return "svelte";
  if (deps.express || deps.fastify || deps.koa) return "node-server";
  if (pkg) return "node";
  if (files.some((f) => f === "Cargo.toml")) return "rust";
  if (files.some((f) => f === "go.mod")) return "go";
  if (files.some((f) => /requirements\.txt|pyproject\.toml/.test(f))) return "python";
  return "unknown";
}

/** Short human-readable digest of the scan, written only when --summary is passed. */
function buildSummary(scan) {
  const section = (title, items) =>
    items.length === 0
      ? `## ${title}\n\n_none detected_\n`
      : `## ${title}\n\n${items.slice(0, 25).map((i) => `- \`${i}\``).join("\n")}${items.length > 25 ? `\n- … ${items.length - 25} more` : ""}\n`;

  return [
    `# Repo Scan Summary`,
    ``,
    `<!-- generated by \`roborepo project-context inventory --summary\`; do not edit by hand -->`,
    ``,
    `- project: **${scan.project.name}** (${scan.project.type})`,
    `- files scanned: ${scan.fileCount}`,
    `- commands: ${scan.commands.length}`,
    `- env var names: ${scan.envVarNames.length}`,
    ``,
    section("Routes / Pages", scan.routes),
    section("Components", scan.components),
    section("Domain Modules", scan.domainModules),
    section("Data Access", scan.dataAccess),
    section("Auth & Permissions", scan.authAndPermissions),
    section("Schemas & Validation", scan.schemasAndValidation),
    section("Tests", scan.tests),
  ].join("\n");
}

export function projectContextInventory(rest) {
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const positional = rest.filter((a) => !a.startsWith("--"));
  const root = resolveTarget(positional[0]);

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`not a directory: ${root}`);
    process.exit(2);
  }

  const generatedDir = path.join(root, DEFAULT_DOCS_DIR, GENERATED_SUBDIR);
  fs.mkdirSync(generatedDir, { recursive: true });

  const scan = buildScan(root);
  const scanPath = path.join(generatedDir, SCAN_FILE);
  fs.writeFileSync(scanPath, `${JSON.stringify(scan, null, 2)}\n`);
  console.log(`wrote ${path.relative(root, scanPath)} (${scan.fileCount} files scanned)`);

  if (flags.has("--summary")) {
    const summaryPath = path.join(generatedDir, SUMMARY_FILE);
    fs.writeFileSync(summaryPath, `${buildSummary(scan)}\n`);
    console.log(`wrote ${path.relative(root, summaryPath)}`);
  }
}

import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { loadPackageCatalog } from "./package-catalog.mjs";
import {
  GENERATED_COMMAND_MARKER,
  LEGACY_GENERATED_COMMAND_MARKER,
  SLASH_COMMAND_HARNESSES,
  packageOwnerMarker,
} from "./skill-command-config.mjs";
import { resolvesIntoRepo } from "./hook-composition.mjs";

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8").replace(/\r\n/g, "\n");
}

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

function commandTarget(name) {
  return `${name}.md`;
}

function withGeneratedMarker(content, packageId) {
  const marker = `<!-- ${GENERATED_COMMAND_MARKER} -->`;
  const ownerMarker = `<!-- ${packageOwnerMarker(packageId)} -->`;
  if (content.includes(marker)) {
    const withOwner = content.includes(ownerMarker) ? content : `${content.replace(/\n*$/, "")}\n${ownerMarker}\n`;
    return withOwner.endsWith("\n") ? withOwner : `${withOwner}\n`;
  }

  const lines = content.split("\n");
  if (lines[0] === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line === "---");
    if (end > 0) {
      lines.splice(end + 1, 0, "", marker, ownerMarker);
      return `${lines.join("\n").replace(/\n*$/, "")}\n`;
    }
  }
  return `${marker}\n${ownerMarker}\n\n${content.replace(/\n*$/, "")}\n`;
}

function skillBackedCommand(command, harness) {
  return withGeneratedMarker(`---
description: ${command.description}
---

# /${command.name}

Use the \`${command.skill}\` skill for this request.

Read \`${harness.skillPath(command.skill)}\`, then follow its workflow.

Keep the skill as the source of truth; this command is only the explicit entry
point.
`, command.packageId);
}

function standaloneCommand(command) {
  return withGeneratedMarker(fs.readFileSync(command.sourceAbs, "utf8").replace(/\r\n/g, "\n"), command.packageId);
}

// Keyed by "<harness>::<packageId>" so apply/prune act on exactly one package's wrappers in one
// harness's generated tree, never touching another package's or the user's own native commands.
function expectedCommands(commands) {
  const byKey = new Map();

  for (const command of commands) {
    for (const harnessName of command.harnesses) {
      const harness = SLASH_COMMAND_HARNESSES[harnessName];
      const content = command.kind === "skill-backed" ? skillBackedCommand(command, harness) : standaloneCommand(command);
      const key = `${harnessName}::${command.packageId}`;
      if (!byKey.has(key)) byKey.set(key, new Map());
      byKey.get(key).set(commandTarget(command.name), content);
    }
  }

  return byKey;
}

function hasGeneratedMarker(filePath) {
  const content = readIfExists(filePath);
  return content !== null && (content.includes(GENERATED_COMMAND_MARKER) || content.includes(LEGACY_GENERATED_COMMAND_MARKER));
}

function renderPackageHarness(harnessName, packageId, expected, { checkOnly = false, quiet = false } = {}) {
  const relDir = SLASH_COMMAND_HARNESSES[harnessName].genDir(packageId);
  const outDir = path.join(repoRoot, relDir);
  let changed = 0;
  let failed = 0;

  if (!checkOnly) fs.mkdirSync(outDir, { recursive: true });

  for (const [fileName, content] of expected) {
    const filePath = path.join(outDir, fileName);
    const existing = readIfExists(filePath);
    if (existing !== null && existing !== content && !hasGeneratedMarker(filePath)) {
      console.error(`fail: ${relDir}/${fileName} exists and is not generated`);
      failed++;
      continue;
    }
    if (existing === content) continue;
    if (checkOnly) {
      console.error(`stale: ${relDir}/${fileName}`);
      failed++;
      continue;
    }
    fs.writeFileSync(filePath, content);
    changed++;
    if (!quiet) console.log(`render: ${relDir}/${fileName}`);
  }

  if (fs.existsSync(outDir)) {
    for (const fileName of fs.readdirSync(outDir)) {
      if (!fileName.endsWith(".md") || expected.has(fileName)) continue;
      const filePath = path.join(outDir, fileName);
      if (!hasGeneratedMarker(filePath)) continue;
      if (checkOnly) {
        console.error(`stale generated command: ${relDir}/${fileName}`);
        failed++;
        continue;
      }
      fs.unlinkSync(filePath);
      changed++;
      if (!quiet) console.log(`prune: ${relDir}/${fileName}`);
    }
  }

  return { changed, failed };
}

export function loadSlashCommandPlan() {
  const commands = slashCommandsFromPackages(loadPackageCatalog({ includeUnavailable: true }));
  return { commands, expected: expectedCommands(commands) };
}

function slashCommandsFromPackages(packages) {
  const commands = [];
  const seen = new Set();
  for (const pkg of packages) {
    for (const resource of pkg.resources || []) {
      if (resource.type === "skill") {
        for (const entrypoint of resource.entrypoints || []) {
          const command = {
            name: entrypoint.name,
            kind: "skill-backed",
            description: entrypoint.description,
            skill: resource.id,
            harnesses: entrypoint.harnesses,
            packageId: pkg.id,
          };
          addCommand(commands, seen, command, pkg.id);
        }
        continue;
      }
      if (resource.type === "slash-command") {
        addCommand(commands, seen, {
          name: resource.name,
          kind: "standalone",
          description: resource.description || pkg.description,
          sourceAbs: path.join(pkg.sourceRoot, resource.source),
          harnesses: resource.harnesses,
          packageId: pkg.id,
        }, pkg.id);
      }
    }
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

function addCommand(commands, seen, command, packageId) {
  if (seen.has(command.name)) throw new Error(`duplicate slash command from packages: ${command.name}`);
  seen.add(command.name);
  if (!command.description || command.description.includes("\n")) {
    throw new Error(`${packageId}: /${command.name} needs a one-line description`);
  }
  commands.push(command);
}

function checkCommandCollisions(commands) {
  const reservedPath = path.join(repoRoot, "manifests", "inventory", "reserved-commands.json");
  let reserved;
  try {
    reserved = new Set(JSON.parse(fs.readFileSync(reservedPath, "utf8")).reserved);
  } catch {
    return;
  }
  for (const command of commands) {
    if (reserved.has(command.name)) {
      console.warn(`warn: command /${command.name} collides with a reserved native/plugin command`);
    }
  }
}

export function renderSlashCommands({ checkOnly = false, quiet = false } = {}) {
  const { commands, expected } = loadSlashCommandPlan();
  checkCommandCollisions(commands);
  let changed = 0;
  let failed = 0;

  for (const [key, keyExpected] of expected) {
    const [harnessName, packageId] = key.split("::");
    const result = renderPackageHarness(harnessName, packageId, keyExpected, { checkOnly, quiet });
    changed += result.changed;
    failed += result.failed;
  }

  return { commands: commands.length, changed, failed };
}

// --------------------------------------------------------------------------- live install/removal
//
// Install-time composition: only an ENABLED package's generated wrapper is copied into the live
// harness commands dir (~/.claude/commands, ~/.codex/commands) — never the whole generated tree.
// Reuses the same "refuse to overwrite a non-generated file" safety property as renderPackageHarness.

function liveCommandsDir(harnessHome, harnessName) {
  return path.join(harnessHome, SLASH_COMMAND_HARNESSES[harnessName].liveDir);
}

// Package commands this package declares for a given harness, i.e. the file names it owns there.
function packageCommandNamesForHarness(pkg, harnessName) {
  const names = [];
  for (const resource of pkg.resources || []) {
    if (resource.type === "skill") {
      for (const entrypoint of resource.entrypoints || []) {
        if (entrypoint.type === "slash-command" && (entrypoint.harnesses || []).includes(harnessName)) {
          names.push(entrypoint.name);
        }
      }
    } else if (resource.type === "slash-command" && (resource.harnesses || []).includes(harnessName)) {
      names.push(resource.name);
    }
  }
  return names;
}

export function installPackageCommands(pkg, harnessHome, harnessName, { dryRun = false } = {}) {
  const names = packageCommandNamesForHarness(pkg, harnessName);
  if (names.length === 0) return;
  const genDir = path.join(repoRoot, SLASH_COMMAND_HARNESSES[harnessName].genDir(pkg.id));
  const destDir = liveCommandsDir(harnessHome, harnessName);
  if (!dryRun && resolvesIntoRepo(destDir, repoRoot)) {
    console.error(`  refusing to install commands: ${destDir} resolves into the repo tree (stale legacy symlink?)`);
    return;
  }
  for (const name of names) {
    const fileName = commandTarget(name);
    const src = path.join(genDir, fileName);
    if (!fs.existsSync(src)) {
      console.error(`  missing generated command: ${src} (run render-slash-commands.mjs)`);
      continue;
    }
    const dest = path.join(destDir, fileName);
    if (dryRun) {
      console.log(`  [dry-run] install command ${fileName} → ${dest}`);
      continue;
    }
    const existing = readIfExists(dest);
    if (existing !== null && !hasGeneratedMarker(dest)) {
      console.error(`  refusing to overwrite non-generated command: ${dest}`);
      continue;
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`  installed command: ${dest}`);
  }
}

export function removePackageCommands(pkg, harnessHome, harnessName, { dryRun = false } = {}) {
  const names = packageCommandNamesForHarness(pkg, harnessName);
  if (names.length === 0) return;
  const destDir = liveCommandsDir(harnessHome, harnessName);
  if (!dryRun && resolvesIntoRepo(destDir, repoRoot)) {
    console.error(`  refusing to remove commands: ${destDir} resolves into the repo tree (stale legacy symlink?)`);
    return;
  }
  for (const name of names) {
    const dest = path.join(destDir, commandTarget(name));
    if (!fs.existsSync(dest)) continue;
    if (!hasGeneratedMarker(dest)) {
      console.error(`  refusing to remove non-generated command: ${dest}`);
      continue;
    }
    if (dryRun) {
      console.log(`  [dry-run] remove command ${dest}`);
      continue;
    }
    fs.unlinkSync(dest);
    console.log(`  removed command: ${dest}`);
  }
}

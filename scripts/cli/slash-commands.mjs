import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { listSourceSkills } from "./skill-lib.mjs";
import {
  GENERATED_COMMAND_MARKER,
  LEGACY_GENERATED_COMMAND_MARKER,
  SKILL_INVOCATION_MANIFEST_REL,
  SLASH_COMMAND_HARNESSES,
  SLASH_COMMANDS_MANIFEST_REL,
} from "./skill-command-config.mjs";
import { validateCommands, validateSkillManifest } from "./slash-command-validation.mjs";

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), "utf8"));
}

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

function withGeneratedMarker(content) {
  const marker = `<!-- ${GENERATED_COMMAND_MARKER} -->`;
  if (content.includes(marker)) return content.endsWith("\n") ? content : `${content}\n`;

  const lines = content.split("\n");
  if (lines[0] === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line === "---");
    if (end > 0) {
      lines.splice(end + 1, 0, "", marker);
      return `${lines.join("\n").replace(/\n*$/, "")}\n`;
    }
  }
  return `${marker}\n\n${content.replace(/\n*$/, "")}\n`;
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
`);
}

function standaloneCommand(command) {
  return withGeneratedMarker(readText(command.source));
}

function expectedCommands(commands) {
  const byHarness = new Map(Object.keys(SLASH_COMMAND_HARNESSES).map((name) => [name, new Map()]));

  for (const command of commands) {
    for (const harnessName of command.harnesses) {
      const harness = SLASH_COMMAND_HARNESSES[harnessName];
      const content = command.kind === "skill-backed" ? skillBackedCommand(command, harness) : standaloneCommand(command);
      byHarness.get(harnessName).set(commandTarget(command.name), content);
    }
  }

  return byHarness;
}

function hasGeneratedMarker(filePath) {
  const content = readIfExists(filePath);
  return content !== null && (content.includes(GENERATED_COMMAND_MARKER) || content.includes(LEGACY_GENERATED_COMMAND_MARKER));
}

function renderHarness(harnessName, expected, { checkOnly = false, quiet = false } = {}) {
  const outDir = path.join(repoRoot, SLASH_COMMAND_HARNESSES[harnessName].dir);
  let changed = 0;
  let failed = 0;

  if (!checkOnly) fs.mkdirSync(outDir, { recursive: true });

  for (const [fileName, content] of expected) {
    const filePath = path.join(outDir, fileName);
    const existing = readIfExists(filePath);
    if (existing !== null && existing !== content && !hasGeneratedMarker(filePath)) {
      console.error(`fail: ${SLASH_COMMAND_HARNESSES[harnessName].dir}/${fileName} exists and is not generated`);
      failed++;
      continue;
    }
    if (existing === content) continue;
    if (checkOnly) {
      console.error(`stale: ${SLASH_COMMAND_HARNESSES[harnessName].dir}/${fileName}`);
      failed++;
      continue;
    }
    fs.writeFileSync(filePath, content);
    changed++;
    if (!quiet) console.log(`render: ${SLASH_COMMAND_HARNESSES[harnessName].dir}/${fileName}`);
  }

  if (fs.existsSync(outDir)) {
    for (const fileName of fs.readdirSync(outDir)) {
      if (!fileName.endsWith(".md") || expected.has(fileName)) continue;
      const filePath = path.join(outDir, fileName);
      if (!hasGeneratedMarker(filePath)) continue;
      if (checkOnly) {
        console.error(`stale generated command: ${SLASH_COMMAND_HARNESSES[harnessName].dir}/${fileName}`);
        failed++;
        continue;
      }
      fs.unlinkSync(filePath);
      changed++;
      if (!quiet) console.log(`prune: ${SLASH_COMMAND_HARNESSES[harnessName].dir}/${fileName}`);
    }
  }

  return { changed, failed };
}

export function loadSlashCommandPlan() {
  const sourceSkills = new Set(listSourceSkills(path.join(repoRoot, "globals", "agents", "skills")));
  const skillPolicies = validateSkillManifest(readJson(SKILL_INVOCATION_MANIFEST_REL), sourceSkills);
  const commands = validateCommands(readJson(SLASH_COMMANDS_MANIFEST_REL), sourceSkills, skillPolicies);
  return { commands, expected: expectedCommands(commands) };
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

  for (const [harnessName, harnessExpected] of expected) {
    const result = renderHarness(harnessName, harnessExpected, { checkOnly, quiet });
    changed += result.changed;
    failed += result.failed;
  }

  return { commands: commands.length, changed, failed };
}

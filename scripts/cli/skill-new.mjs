import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  initializeWorkspace,
  packageMode,
  repoRoot,
  sharedSkillsDir,
  workspaceCommandsDir,
  workspaceSkillsDir,
} from "./paths.mjs";
import { addSkillPolicy, addSlashCommand, readSkillPolicyManifest, readSlashCommandManifest } from "./skill-new-manifests.mjs";
import { resolveNewOptions } from "./skill-new-options.mjs";
import { updateReadmeForCommand, updateReadmeForHelper } from "./skill-new-readme.mjs";
import { skillTemplate, skillBackedCommandTemplate, standaloneCommandTemplate } from "./skill-new-templates.mjs";

const NATIVE_SKILL_CREATOR = path.join(
  os.homedir(), ".codex", "skills", ".system", "skill-creator", "scripts"
);
const NATIVE_INIT_SKILL = path.join(NATIVE_SKILL_CREATOR, "init_skill.py");
const NATIVE_GEN_YAML = path.join(NATIVE_SKILL_CREATOR, "generate_openai_yaml.py");

function runChecked(label, command, args, opts = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit", ...opts });
  if (result.error) throw new Error(`${label} failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit ${result.status}`);
}

function writeNewFile(filePath, content) {
  if (fs.existsSync(filePath)) throw new Error(`refusing to overwrite existing file: ${path.relative(repoRoot, filePath)}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function assertPathAvailable(filePath) {
  if (fs.existsSync(filePath)) throw new Error(`refusing to overwrite existing file: ${path.relative(repoRoot, filePath)}`);
}

function assertPathMissing(filePath) {
  if (fs.existsSync(filePath)) throw new Error(`refusing to write into existing path: ${path.relative(repoRoot, filePath)}`);
}

function hasNativeInitSkill() {
  return fs.existsSync(NATIVE_INIT_SKILL);
}

function scaffoldWithNative(name) {
  runChecked(
    "native init_skill.py",
    "python3",
    [NATIVE_INIT_SKILL, name, "--path", sharedSkillsDir],
    { env: { ...process.env, PYTHONPATH: NATIVE_SKILL_CREATOR } }
  );
}

function skillRoot() {
  return packageMode ? workspaceSkillsDir : sharedSkillsDir;
}

function formatDisplayName(name) {
  const ACRONYMS = new Set(["GH", "MCP", "API", "CI", "CLI", "LLM", "PDF", "PR", "UI", "URL", "SQL"]);
  const BRANDS = { openai: "OpenAI", openapi: "OpenAPI", github: "GitHub", sqlite: "SQLite", fastapi: "FastAPI" };
  const SMALL_WORDS = new Set(["and", "or", "to", "up", "with"]);
  return name.split("-").filter(Boolean).map((word, i) => {
    const up = word.toUpperCase();
    const lo = word.toLowerCase();
    if (ACRONYMS.has(up)) return up;
    if (BRANDS[lo]) return BRANDS[lo];
    if (i > 0 && SMALL_WORDS.has(lo)) return lo;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
}

function generateShortDescription(displayName) {
  let desc = `Help with ${displayName} tasks`;
  if (desc.length < 25) desc = `Help with ${displayName} tasks and workflows`;
  if (desc.length > 64) desc = `Help with ${displayName}`;
  if (desc.length > 64) desc = `${displayName} helper`;
  return desc.slice(0, 64);
}

function ensureOpenAIYaml(skillDir, name) {
  const yamlPath = path.join(skillDir, "agents", "openai.yaml");
  if (fs.existsSync(yamlPath)) return;

  if (fs.existsSync(NATIVE_GEN_YAML)) {
    runChecked(
      "generate_openai_yaml.py",
      "python3",
      [NATIVE_GEN_YAML, skillDir, "--name", name],
      { env: { ...process.env, PYTHONPATH: NATIVE_SKILL_CREATOR } }
    );
    return;
  }

  const displayName = formatDisplayName(name);
  const shortDescription = generateShortDescription(displayName);
  const yaml = `interface:\n  display_name: "${displayName}"\n  short_description: "${shortDescription}"\n`;
  fs.mkdirSync(path.dirname(yamlPath), { recursive: true });
  fs.writeFileSync(yamlPath, yaml);
  console.log("[OK] Created agents/openai.yaml");
}

function preflightSkillNew(opts) {
  if (packageMode) {
    initializeWorkspace();
    if (opts.kind === "auto" || opts.kind === "skill-command") {
      assertPathMissing(path.join(sharedSkillsDir, opts.name));
      assertPathMissing(path.join(skillRoot(), opts.name));
    }
    if (opts.kind === "standalone") {
      assertPathAvailable(path.join(repoRoot, "globals", "claude", "commands", `${opts.command}.md`));
      assertPathAvailable(path.join(repoRoot, "globals", "codex", "commands", `${opts.command}.md`));
      assertPathAvailable(path.join(workspaceCommandsDir, `${opts.command}.md`));
    }
    return;
  }

  if (opts.kind === "auto" || opts.kind === "skill-command") {
    assertPathMissing(path.join(skillRoot(), opts.name));
    if (readSkillPolicyManifest().skills.some((skill) => skill.skill === opts.name)) {
      throw new Error(`skill policy already exists: ${opts.name}`);
    }
  }

  if (opts.kind === "skill-command" || opts.kind === "standalone") {
    if (readSlashCommandManifest().commands.some((command) => command.name === opts.command)) {
      throw new Error(`slash command already exists: ${opts.command}`);
    }
  }

  if (opts.kind === "standalone") {
    assertPathAvailable(path.join(repoRoot, "globals", "commands", `${opts.command}.md`));
  }
}

export async function skillNew(args) {
  const opts = await resolveNewOptions(args);
  preflightSkillNew(opts);

  if (opts.kind === "auto" || opts.kind === "skill-command") {
    const skillDir = path.join(skillRoot(), opts.name);
    if (!packageMode && hasNativeInitSkill()) {
      scaffoldWithNative(opts.name);
    } else {
      writeNewFile(path.join(skillDir, "SKILL.md"), skillTemplate(opts.name, opts.description));
    }
    ensureOpenAIYaml(skillDir, opts.name);
    if (packageMode) {
      console.log(`package mode: custom skill written to ${skillDir}`);
    } else {
      addSkillPolicy({
        name: opts.name,
        risk: opts.risk,
        explicitCommand: opts.kind === "skill-command",
        description: opts.description,
      });
    }
    if (opts.kind === "auto") {
      if (!packageMode) updateReadmeForHelper({ name: opts.name, description: opts.description, category: opts.category });
    }
  }

  if (opts.kind === "skill-command") {
    if (packageMode) {
      writeNewFile(
        path.join(workspaceCommandsDir, `${opts.command}.md`),
        skillBackedCommandTemplate(opts.command, opts.name, opts.description),
      );
    }
    if (!packageMode) addSlashCommand({
      name: opts.command,
      kind: "skill-backed",
      description: opts.description,
      skill: opts.name,
      harnesses: opts.harnesses,
    });
    if (!packageMode) updateReadmeForCommand({ name: opts.command, description: opts.description });
  }

  if (opts.kind === "standalone") {
    const sourceRel = packageMode
      ? path.join("commands", `${opts.command}.md`)
      : path.join("globals", "commands", `${opts.command}.md`);
    const sourceAbs = packageMode ? path.join(workspaceCommandsDir, `${opts.command}.md`) : path.join(repoRoot, sourceRel);
    writeNewFile(sourceAbs, standaloneCommandTemplate(opts.command, opts.description));
    if (!packageMode) addSlashCommand({
      name: opts.command,
      kind: "standalone",
      description: opts.description,
      source: sourceRel,
      harnesses: opts.harnesses,
    });
    if (!packageMode) updateReadmeForCommand({ name: opts.command, description: opts.description });
  }

  if (packageMode) {
    console.log("");
    console.log(`created ${opts.kind}: ${opts.kind === "standalone" ? `/${opts.command}` : opts.name}`);
    console.log("workspace custom content is portable and app built-ins were not modified.");
    return;
  }

  runChecked("skill link-internal", "bash", [path.join(repoRoot, "scripts", "build", "link-skills.sh"), "--quiet"]);
  runChecked("skill link-globals", "bash", [path.join(repoRoot, "scripts", "build", "link-global-skills.sh")]);
  runChecked("slash command render", process.execPath, [
    path.join(repoRoot, "scripts", "build", "render-slash-commands.mjs"),
    "--quiet",
  ]);

  console.log("");
  console.log(`created ${opts.kind}: ${opts.kind === "standalone" ? `/${opts.command}` : opts.name}`);
  console.log("next: edit the generated body, then run:");
  console.log("  scripts/doctor.sh --quiet");
}

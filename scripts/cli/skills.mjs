// roborepo `skill` subcommands: link this repo's .codex/skills into existing .claude/.codex, and
// export the shared harness skills into a consumer repo (+ a shareable zip).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  listSourceSkills,
  resolveClientSkillDirs,
  copyDir,
  timestamp,
  makePrompter,
  confirmYesNo,
  askOverrideSkip,
  writeZip,
  linkLocalSkills,
} from "./skill-lib.mjs";
import { repoRoot, sharedSkillsDir } from "./paths.mjs";
import { addSkillPolicy } from "./skill-new-manifests.mjs";

function runChecked(label, command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error) throw new Error(`${label} failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit ${result.status}`);
}

export function skillAdopt(args) {
  const name = args[0];
  if (!name) {
    console.error("usage: roborepo skill adopt <name>");
    process.exit(2);
  }

  const codexSrc = path.join(os.homedir(), ".codex", "skills", name);
  const claudeSrc = path.join(os.homedir(), ".claude", "skills", name);

  let src;
  for (const candidate of [codexSrc, claudeSrc]) {
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isDirectory() && !stat.isSymbolicLink()) { src = candidate; break; }
    } catch { /* not found */ }
  }

  if (!src) {
    console.error(`no unmanaged skill '${name}' found in ~/.codex/skills/ or ~/.claude/skills/`);
    console.error("only real directories (not managed symlinks) can be adopted");
    process.exit(1);
  }

  const dest = path.join(sharedSkillsDir, name);
  if (fs.existsSync(dest)) {
    console.error(`globals/agents/skills/${name} already exists — skill already adopted or name collision`);
    process.exit(1);
  }

  if (!fs.existsSync(path.join(src, "SKILL.md"))) {
    console.error(`${src} has no SKILL.md — not a valid skill directory`);
    process.exit(1);
  }

  copyDir(src, dest);
  console.log(`adopted: ${src} -> globals/agents/skills/${name}`);

  fs.rmSync(src, { recursive: true, force: true });

  addSkillPolicy({ name, risk: "low", explicitCommand: false, description: `adopted skill` });

  runChecked("skill link-globals", "bash", [path.join(repoRoot, "scripts", "build", "link-global-skills.sh")]);
  runChecked("slash command render", process.execPath, [
    path.join(repoRoot, "scripts", "build", "render-slash-commands.mjs"),
    "--quiet",
  ]);

  console.log("");
  console.log(`skill '${name}' adopted into globals/agents/skills/${name}`);
  console.log("next: review SKILL.md, update description in manifests/inventory/skill-invocation.json, then:");
  console.log("  scripts/doctor.sh --quiet");
}

async function resolveSkillInstallTargets(repo, { dryRun = false, uninstall = false } = {}) {
  // Skills live in .codex/skills/<name>/ (Codex reads there directly).
  // Only .claude/skills/<name> needs a symlink; .codex is the source, not a link target.
  const targets = [
    { name: "Claude", root: path.join(repo, ".claude") },
  ];
  const existing = targets.filter((target) => fs.existsSync(target.root));
  const missing = targets.filter((target) => !fs.existsSync(target.root));

  if (missing.length === 0 || uninstall) return existing.map((target) => target.root);

  const prompter = makePrompter();
  if (!prompter.ask) return existing.map((target) => target.root);

  const selected = [...existing];
  for (const target of missing) {
    const include = await confirmYesNo(prompter, `Symlink skills to ${target.name}?`, true);
    if (include) selected.push(target);
  }
  prompter.close();

  if (!dryRun) {
    for (const target of selected) fs.mkdirSync(target.root, { recursive: true });
  }
  return selected.map((target) => target.root);
}

export async function skillLink(flags, commandName = "skill symlink-repo") {
  for (const f of flags) {
    if (f === "--dry-run" || f === "--uninstall") continue;
    console.error(`unknown flag for "${commandName}": ${f}`);
    process.exit(2);
  }

  const dryRun = flags.has("--dry-run");
  const uninstall = flags.has("--uninstall");
  const repo = process.cwd();
  const codexRoot = path.join(repo, ".codex");
  const srcDir = path.join(repo, ".codex", "skills");

  if (!fs.existsSync(codexRoot)) {
    console.error(`no .codex directory found at ${codexRoot}`);
    console.error(`move repo skills into .codex/skills/<skill-name>/SKILL.md first, then run:`);
    console.error(`  roborepo ${commandName}`);
    process.exit(1);
  }

  if (!fs.existsSync(srcDir)) {
    console.error(`no .codex/skills directory found at ${srcDir}`);
    console.error(`move repo skills into .codex/skills/<skill-name>/SKILL.md first, then run:`);
    console.error(`  roborepo ${commandName}`);
    process.exit(1);
  }

  const targetRoots = await resolveSkillInstallTargets(repo, { dryRun, uninstall });
  const t = linkLocalSkills(repo, { dryRun, uninstall, targetRoots });
  const dry = dryRun ? " (dry-run)" : "";
  console.log("");
  if (t.targetDirs === 0) {
    console.log(`0 existing target folder(s) found (.claude); no skill links installed${dry}.`);
    console.log(`Create .claude/ first, then re-run (Codex reads .codex/skills/ directly):`);
    console.log(`  roborepo ${commandName}`);
    return;
  }
  if (uninstall) {
    console.log(`${t.unlinked} link(s) removed${dry}, ${t.pruned} pruned, ${t.conflicts} conflict(s).`);
  } else {
    let line =
      `${t.skills} skill(s): ${t.linked} linked${dry}, ${t.ok} already ok, ` +
      `${t.pruned} pruned, ${t.conflicts} conflict(s)`;
    if (t.denied > 0) line += `, ${t.denied} denied (OS refused symlink)`;
    console.log(`${line}.`);
    console.log("");
    console.log("Reminder: added a skill to .codex/skills/<name>/SKILL.md? Re-run");
    console.log(`  roborepo ${commandName}`);
    console.log("so existing Claude and transitional .codex/skills links pick it up.");
  }
}

export async function skillExport(flags, commandName = "skill export-to-local") {
  const assumeYes = flags.has("--yes");
  let onConflict = "skip";
  for (const f of flags) {
    if (f === "--yes") continue;
    if (f.startsWith("--on-conflict=")) {
      onConflict = f.slice("--on-conflict=".length);
      continue;
    }
    console.error(`unknown flag for "${commandName}": ${f}`);
    process.exit(2);
  }
  if (!["skip", "override"].includes(onConflict)) {
    console.error(`--on-conflict must be skip or override`);
    process.exit(2);
  }

  const cwd = process.cwd();

  // Guard: never run the exporter from inside the roborepo source repo itself — it
  // would copy the shared skills back over their own source and drop a zip in the repo root.
  if (path.resolve(cwd) === path.resolve(repoRoot)) {
    console.error(`refusing to export into the roborepo source repo (${cwd}).`);
    console.error(`cd into the TARGET repo first, then run: roborepo ${commandName}`);
    process.exit(1);
  }

  const prompter = makePrompter();
  const interactive = Boolean(prompter.ask);
  if (!interactive && !assumeYes) {
    console.error(`non-interactive: pass --yes and optionally --on-conflict=skip|override`);
    prompter.close();
    process.exit(2);
  }

  const proceed = assumeYes
    ? true
    : await confirmYesNo(prompter, `Download skills into the current folder (${cwd})?`, true);
  if (!proceed) {
    console.log("");
    console.log("Re-run this command from the ROOT of the target repo:");
    console.log(`  cd /path/to/your/repo && roborepo ${commandName}`);
    prompter.close();
    return;
  }

  const dests = resolveClientSkillDirs(cwd, { create: true });
  console.log(`destinations: ${dests.map((d) => path.relative(cwd, d) || d).join(", ")}`);

  const skills = listSourceSkills(sharedSkillsDir);
  if (skills.length === 0) {
    console.error(`no shared skills found under ${sharedSkillsDir}`);
    prompter.close();
    process.exit(1);
  }
  const ts = timestamp();
  const bundleName = `global_agent_skills_${ts}`;
  const zipPath = path.join(cwd, `${bundleName}.zip`);
  writeZip(
    zipPath,
    skills.map((name) => ({ srcDir: path.join(sharedSkillsDir, name), nameInZip: `${bundleName}/${name}` })),
  );
  console.log(`bundled ${skills.length} skill(s) -> ${path.basename(zipPath)} (shareable artifact)`);

  let copied = 0;
  let skipped = 0;
  let overridden = 0;

  for (const dest of dests) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of skills) {
      const src = path.join(sharedSkillsDir, name);
      const target = path.join(dest, name);

      if (!fs.existsSync(target)) {
        copyDir(src, target);
        console.log(`copy: ${path.relative(cwd, target)}`);
        copied++;
        continue;
      }

      const choice = interactive ? await askOverrideSkip(prompter, name) : onConflict;
      if (choice === "override") {
        const archiveDir = path.join(dest, "archived");
        fs.mkdirSync(archiveDir, { recursive: true });
        const backup = path.join(archiveDir, `${name}_backup_${ts}`);
        fs.renameSync(target, backup);
        copyDir(src, target);
        console.log(`override: ${path.relative(cwd, target)} (old -> ${path.relative(cwd, backup)})`);
        overridden++;
      } else {
        console.log(`skip: ${path.relative(cwd, target)} (kept existing)`);
        skipped++;
      }
    }
  }

  prompter.close();
  console.log("");
  console.log(`done: ${copied} copied, ${overridden} overridden, ${skipped} skipped.`);
  console.log(`shareable bundle left at: ${path.basename(zipPath)}`);
}

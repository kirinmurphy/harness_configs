import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import {
  SKILL_INVOCATIONS,
  SKILL_INVOCATION_MANIFEST_REL,
  SKILL_RISKS,
  SLASH_COMMAND_HARNESSES,
  SLASH_COMMAND_HARNESS_NAMES,
  SLASH_COMMAND_KINDS,
  SLASH_COMMANDS_MANIFEST_REL,
} from "./skill-command-config.mjs";

function validateName(name, label) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`${label}: invalid name "${name}"`);
}

export function validateSkillManifest(manifest, sourceSkills) {
  if (!manifest || !Array.isArray(manifest.skills)) {
    throw new Error(`${SKILL_INVOCATION_MANIFEST_REL}: missing skills array`);
  }

  const seen = new Set();
  const policies = new Map();
  for (const entry of manifest.skills) {
    const skill = entry?.skill;
    if (typeof skill !== "string" || skill.trim() === "") {
      throw new Error(`${SKILL_INVOCATION_MANIFEST_REL}: skill must be a string`);
    }
    if (seen.has(skill)) throw new Error(`${SKILL_INVOCATION_MANIFEST_REL}: duplicate skill entry: ${skill}`);
    seen.add(skill);
    if (!sourceSkills.has(skill)) throw new Error(`${SKILL_INVOCATION_MANIFEST_REL}: unknown skill: ${skill}`);
    if (!SKILL_RISKS.includes(entry.risk)) {
      throw new Error(`${SKILL_INVOCATION_MANIFEST_REL}: ${skill} risk must be ${SKILL_RISKS.join(", ")}`);
    }
    if (!SKILL_INVOCATIONS.includes(entry.invocation)) {
      throw new Error(`${SKILL_INVOCATION_MANIFEST_REL}: ${skill} invocation must be ${SKILL_INVOCATIONS.join(" or ")}`);
    }
    if (typeof entry.explicit_command !== "boolean") {
      throw new Error(`${SKILL_INVOCATION_MANIFEST_REL}: ${skill} explicit_command must be true or false`);
    }
    if (entry.invocation === "manual" && !entry.explicit_command) {
      throw new Error(`${SKILL_INVOCATION_MANIFEST_REL}: ${skill} invocation=manual requires explicit_command=true`);
    }
    policies.set(skill, { explicitCommand: entry.explicit_command, invocation: entry.invocation });
  }

  for (const skill of sourceSkills) {
    if (!seen.has(skill)) throw new Error(`${SKILL_INVOCATION_MANIFEST_REL}: missing skill entry: ${skill}`);
  }

  return policies;
}

function validateHarnesses(commandName, harnesses) {
  if (!Array.isArray(harnesses) || harnesses.length === 0) {
    throw new Error(`${SLASH_COMMANDS_MANIFEST_REL}: ${commandName} needs at least one harness`);
  }
  const seen = new Set();
  for (const harness of harnesses) {
    if (!SLASH_COMMAND_HARNESSES[harness]) {
      throw new Error(`${SLASH_COMMANDS_MANIFEST_REL}: ${commandName} unknown harness: ${harness}`);
    }
    if (seen.has(harness)) throw new Error(`${SLASH_COMMANDS_MANIFEST_REL}: ${commandName} duplicate harness: ${harness}`);
    seen.add(harness);
  }
}

export function validateCommands(manifest, sourceSkills, skillPolicies) {
  if (!manifest || !Array.isArray(manifest.commands)) {
    throw new Error(`${SLASH_COMMANDS_MANIFEST_REL}: missing commands array`);
  }

  const seen = new Set();
  const commandBackedSkills = new Set();
  const commands = [];

  for (const command of manifest.commands) {
    const name = String(command?.name ?? "").replace(/^\//, "");
    validateName(name, SLASH_COMMANDS_MANIFEST_REL);
    if (seen.has(name)) throw new Error(`${SLASH_COMMANDS_MANIFEST_REL}: duplicate command: ${name}`);
    seen.add(name);

    const kind = command.kind;
    if (!SLASH_COMMAND_KINDS.includes(kind)) {
      throw new Error(`${SLASH_COMMANDS_MANIFEST_REL}: ${name} kind must be ${SLASH_COMMAND_KINDS.join(" or ")}`);
    }
    const description = String(command.description ?? "").trim();
    if (description === "" || description.includes("\n")) {
      throw new Error(`${SLASH_COMMANDS_MANIFEST_REL}: ${name} needs a one-line description`);
    }
    validateHarnesses(name, command.harnesses);

    if (kind === "skill-backed") {
      if (!sourceSkills.has(command.skill)) {
        throw new Error(`${SLASH_COMMANDS_MANIFEST_REL}: ${name} references unknown skill: ${command.skill}`);
      }
      if (!skillPolicies.get(command.skill)?.explicitCommand) {
        throw new Error(
          `${SLASH_COMMANDS_MANIFEST_REL}: ${name} references ${command.skill}, but ${SKILL_INVOCATION_MANIFEST_REL} has explicit_command=false`,
        );
      }
      commandBackedSkills.add(command.skill);
      commands.push({ name, kind, description, skill: command.skill, harnesses: command.harnesses });
      continue;
    }

    if (typeof command.source !== "string" || command.source.trim() === "") {
      throw new Error(`${SLASH_COMMANDS_MANIFEST_REL}: ${name} standalone command needs source`);
    }
    const sourcePath = path.join(repoRoot, command.source);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`${SLASH_COMMANDS_MANIFEST_REL}: ${name} source missing: ${command.source}`);
    }
    commands.push({ name, kind, description, source: command.source, harnesses: command.harnesses });
  }

  for (const [skill, policy] of skillPolicies) {
    if (policy.explicitCommand && !commandBackedSkills.has(skill)) {
      throw new Error(`${SKILL_INVOCATION_MANIFEST_REL}: ${skill} has explicit_command=true but no skill-backed slash command`);
    }
  }

  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

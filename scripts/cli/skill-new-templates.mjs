export function skillTemplate(name, description) {
  return `---
name: ${name}
description: ${description}
---

# ${name}

Use this skill when ${description.charAt(0).toLowerCase()}${description.slice(1)}

## Workflow

1. Confirm the request matches this skill.
2. Inspect the repo for existing patterns.
3. Apply the smallest useful workflow.
4. Report what changed or what should happen next.
`;
}

export function standaloneCommandTemplate(name, description) {
  return `---
description: ${description}
---

# /${name}

${description}

## Workflow

1. Confirm the command intent.
2. Run the command-specific workflow.
3. Report the result and any required follow-up.
`;
}

export function skillBackedCommandTemplate(command, skill, description) {
  return `---
description: ${description}
---

# /${command}

Use the \`${skill}\` skill for this request.

Read the installed \`${skill}\` skill, then follow its workflow.

Keep the skill as the source of truth; this command is only the explicit entry
point.
`;
}

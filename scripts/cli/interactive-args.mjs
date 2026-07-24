import { makePrompter, selectMenu } from "./skill-lib.mjs";

export async function resolveInteractiveArgs(node) {
  const needed = (node.arguments || []).filter((arg) => arg.required);
  if (needed.length === 0) return [];

  const prompter = makePrompter();
  if (!prompter.ask) {
    console.error(node.usage || "missing required arguments");
    return null;
  }
  try {
    const out = [];
    for (const arg of needed) {
      const value = await promptForArg(prompter, arg);
      if (!value) return null;
      out.push(value);
    }
    return out;
  } finally {
    prompter.close();
  }
}

async function promptForArg(prompter, arg) {
  if (arg.interactive?.choices?.length) {
    return selectMenu(`${arg.interactive.prompt}:`, arg.interactive.choices.map((choice) => ({
      label: choice,
      value: choice,
    })));
  }
  return prompter.ask(`${arg.interactive?.prompt || arg.name}: `);
}

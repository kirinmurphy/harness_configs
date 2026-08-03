import { makePrompter, selectMenu } from "./skill-lib.mjs";
import {
  NEW_KIND_ITEMS,
  README_CATEGORY_HEADINGS,
  SKILL_NEW_KINDS,
  SKILL_RISKS,
  isKnownSlashCommandHarness,
} from "./skill-command-config.mjs";
import { knownHarnessIds } from "./rules-render.mjs";

function slugify(value, label) {
  const slug = String(value ?? "")
    .trim()
    .replace(/^\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`${label} must contain letters or numbers and may use hyphens`);
  }
  return slug;
}

function parseList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNewArgs(args) {
  const opts = {
    kind: null,
    name: null,
    command: null,
    description: null,
    risk: "low",
    category: "code",
    harnesses: knownHarnessIds(),
    provided: new Set(),
  };

  for (const arg of args) {
    if (arg.startsWith("--kind=")) {
      opts.kind = arg.slice("--kind=".length);
      opts.provided.add("kind");
    } else if (arg.startsWith("--name=")) {
      opts.name = arg.slice("--name=".length);
      opts.provided.add("name");
    } else if (arg.startsWith("--command=")) {
      opts.command = arg.slice("--command=".length);
      opts.provided.add("command");
    } else if (arg.startsWith("--description=")) {
      opts.description = arg.slice("--description=".length);
      opts.provided.add("description");
    } else if (arg.startsWith("--risk=")) {
      opts.risk = arg.slice("--risk=".length);
      opts.provided.add("risk");
    } else if (arg.startsWith("--category=")) {
      opts.category = arg.slice("--category=".length);
      opts.provided.add("category");
    } else if (arg.startsWith("--harnesses=")) {
      opts.harnesses = parseList(arg.slice("--harnesses=".length));
      opts.provided.add("harnesses");
    }
    else {
      console.error(`unknown flag for "skill new": ${arg}`);
      process.exit(2);
    }
  }

  return opts;
}

async function askRequired(prompter, current, question) {
  if (current !== null && current !== undefined && String(current).trim() !== "") return current;
  if (!prompter.ask) {
    console.error(`missing required value: ${question}`);
    process.exit(2);
  }
  for (;;) {
    const answer = await prompter.ask(`${question}: `);
    if (answer.trim() !== "") return answer.trim();
  }
}

function validateOptionSets(opts) {
  if (opts.kind !== "skill-command" && opts.provided.has("command")) {
    console.error("--command only applies to skill-command");
    process.exit(2);
  }
  if (opts.kind === "standalone" && opts.provided.has("risk")) {
    console.error("--risk only applies to auto and skill-command");
    process.exit(2);
  }
  if (opts.kind !== "standalone" && !SKILL_RISKS.includes(opts.risk)) {
    console.error(`--risk must be ${SKILL_RISKS.join(", ")}`);
    process.exit(2);
  }
  if (opts.kind !== "auto" && opts.provided.has("category")) {
    console.error("--category only applies to auto helper skills");
    process.exit(2);
  }
  if (opts.kind === "auto" && !README_CATEGORY_HEADINGS[opts.category]) {
    console.error(`--category must be one of: ${Object.keys(README_CATEGORY_HEADINGS).join(", ")}`);
    process.exit(2);
  }
  if (opts.kind === "auto" && opts.provided.has("harnesses")) {
    console.error("--harnesses only applies to skill-command and standalone");
    process.exit(2);
  }

  if (opts.kind === "auto") return;
  const seenHarnesses = new Set();
  for (const harness of opts.harnesses) {
    if (!isKnownSlashCommandHarness(harness)) {
      console.error(`--harnesses values must be: ${knownHarnessIds().join(", ")}`);
      process.exit(2);
    }
    if (seenHarnesses.has(harness)) {
      console.error(`--harnesses contains duplicate value: ${harness}`);
      process.exit(2);
    }
    seenHarnesses.add(harness);
  }
}

export async function resolveNewOptions(args) {
  const opts = parseNewArgs(args);
  const prompter = makePrompter();

  if (!opts.kind) {
    opts.kind = await selectMenu("What are you adding?", NEW_KIND_ITEMS);
    if (opts.kind === null) {
      console.log("cancelled.");
      process.exit(0);
    }
  }
  if (!SKILL_NEW_KINDS.includes(opts.kind)) {
    console.error(`--kind must be ${SKILL_NEW_KINDS.join(", ")}`);
    process.exit(2);
  }

  opts.name = slugify(await askRequired(prompter, opts.name, opts.kind === "standalone" ? "Command name" : "Skill name"), "name");
  if (opts.kind === "skill-command") {
    opts.command = slugify(await askRequired(prompter, opts.command ?? opts.name, "Slash command name"), "command");
  } else if (opts.kind === "standalone") {
    opts.command = opts.name;
  }
  opts.description = String(await askRequired(prompter, opts.description, "One-line description")).trim();
  if (opts.description.includes("\n")) {
    console.error("description must be one line");
    process.exit(2);
  }

  validateOptionSets(opts);
  prompter.close();
  delete opts.provided;
  return opts;
}

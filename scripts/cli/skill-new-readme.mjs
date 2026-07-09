import fs from "node:fs";
import { README_CATEGORY_HEADINGS, README_PATH } from "./skill-command-config.mjs";

function markdownCell(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function ensureReadmeHelperSection(readme, category) {
  const heading = README_CATEGORY_HEADINGS[category];
  const marker = `##### ${heading}`;
  if (readme.includes(marker)) return readme;

  const commandsIndex = readme.indexOf("\n### Commands");
  if (commandsIndex < 0) throw new Error("README.md missing ### Commands section");

  const section = `##### ${heading}

| | |
| --- | --- |

`;
  return `${readme.slice(0, commandsIndex)}\n${section}${readme.slice(commandsIndex + 1)}`;
}

function nextReadmeHeadingIndex(readme, start) {
  const matches = [...readme.slice(start).matchAll(/\n#{3,5} /g)];
  if (matches.length === 0) return readme.length;
  return start + matches[0].index;
}

function insertReadmeTableRow(readme, sectionHeading, row) {
  const headingIndex = readme.indexOf(sectionHeading);
  if (headingIndex < 0) throw new Error(`README.md missing ${sectionHeading}`);
  const sectionEnd = nextReadmeHeadingIndex(readme, headingIndex + sectionHeading.length);
  const section = readme.slice(headingIndex, sectionEnd);
  if (section.includes(row.split("|")[1].trim())) return readme;

  const lines = section.split("\n");
  let insertAt = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("|")) {
      insertAt = i + 1;
      break;
    }
  }
  if (insertAt < 0) throw new Error(`README.md section ${sectionHeading} has no table`);
  lines.splice(insertAt, 0, row);
  return `${readme.slice(0, headingIndex)}${lines.join("\n")}${readme.slice(sectionEnd)}`;
}

export function updateReadmeForHelper({ name, description, category }) {
  let readme = fs.readFileSync(README_PATH, "utf8");
  readme = ensureReadmeHelperSection(readme, category);
  const row = `| ${markdownCell(name)} | ${markdownCell(description)} |`;
  readme = insertReadmeTableRow(readme, `##### ${README_CATEGORY_HEADINGS[category]}`, row);
  fs.writeFileSync(README_PATH, readme);
}

export function updateReadmeForCommand({ name, description }) {
  let readme = fs.readFileSync(README_PATH, "utf8");
  const row = `| \`/${markdownCell(name)}\` | ${markdownCell(description)} |`;
  readme = insertReadmeTableRow(readme, "### Commands", row);
  fs.writeFileSync(README_PATH, readme);
}

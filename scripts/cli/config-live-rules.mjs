import fs from "node:fs";
import path from "node:path";
import { harnessHome } from "./paths.mjs";
import { renderMarkdown } from "./markdown-render.mjs";

export const LIVE_RULE_FILES = {
  claude: path.join(harnessHome.claude, "CLAUDE.md"),
  codex: path.join(harnessHome.codex, "AGENTS.md"),
};

function readText(filePath, fallback = "") {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return fallback; }
}

function stripGeneratedRulesPreamble(content) {
  const lines = content.split("\n");
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== "# Generated Harness Rules") {
      kept.push(lines[i]);
      continue;
    }
    while (
      i + 1 < lines.length &&
      (
        lines[i + 1].trim() === "" ||
        lines[i + 1].startsWith("Generated from ") ||
        lines[i + 1].startsWith("Enabled packages ") ||
        lines[i + 1].startsWith("Do not edit ")
      )
    ) {
      i += 1;
    }
  }
  return collapseDuplicateCavemanCommunication(kept.join("\n")).replace(/\n{3,}/g, "\n\n");
}

function collapseDuplicateCavemanCommunication(content) {
  let seen = false;
  const normalized = [
    "## Communication",
    "",
    "Use caveman full by default. Terse, no filler, fragments OK.",
    "",
    "Switch to normal mode only when the user explicitly says `normal mode` or `stop caveman`.",
  ].join("\n");
  return content.replace(
    /## Communication\s*\n+Use caveman full by default\. Terse, no filler, fragments OK\.\s*\n+Switch to normal mode only when the user explicitly says `normal mode` or `stop caveman`\./g,
    () => {
      if (seen) return "";
      seen = true;
      return normalized;
    },
  );
}

export function readLiveRulesFile(harness) {
  const filePath = LIVE_RULE_FILES[harness];
  if (!filePath) return { installed: false, path: null, content: "", html: "" };
  const content = stripGeneratedRulesPreamble(readText(filePath, ""));
  return {
    installed: fs.existsSync(filePath),
    path: filePath,
    content,
    html: renderMarkdown(content),
  };
}

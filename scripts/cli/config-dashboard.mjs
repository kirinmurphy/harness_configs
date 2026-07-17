import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";

const CONFIG_INDEX = path.join(repoRoot, "portal", "config", "index.html");

export function configHtml() {
  return fs.readFileSync(CONFIG_INDEX, "utf8");
}

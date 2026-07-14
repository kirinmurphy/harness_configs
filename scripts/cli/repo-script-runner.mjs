import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot, requireDevelopmentCheckout } from "./paths.mjs";

const RUNTIMES = {
  bash: (script, args) => ["bash", [script, ...args]],
  node: (script, args) => [process.execPath, [script, ...args]],
};

export function runRepoCommand(commandConfig, args) {
  if (!commandConfig?.path || !RUNTIMES[commandConfig.runtime]) {
    console.error("invalid repo command config");
    process.exit(1);
  }

  const script = path.join(repoRoot, commandConfig.path);
  if (!fs.existsSync(script)) {
    console.error(`missing script: ${script}`);
    process.exit(1);
  }
  if (commandConfig.requiresDevelopmentCheckout) {
    requireDevelopmentCheckout(commandConfig.path);
  }

  const [command, commandArgs] = RUNTIMES[commandConfig.runtime](script, args);
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  if (result.error) {
    console.error(`failed to run ${commandConfig.path}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

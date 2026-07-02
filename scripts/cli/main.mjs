#!/usr/bin/env node
// roborepo CLI orchestrator. User-facing usage/menu text and repo script targets live in
// manifests/platform/cli-commands.json; command implementations live in sibling modules.

import fs from "node:fs";
import path from "node:path";
import { selectMenu } from "./skill-lib.mjs";
import { repoRoot } from "./paths.mjs";
import { runRepoCommand } from "./repo-script-runner.mjs";
import { skillLink, skillExport, skillAdopt, skillNative, skillInspect } from "./skills.mjs";
import { skillNew } from "./skill-new.mjs";
import { skillAudit } from "./skill-audit.mjs";
import { indexCode, indexDocs, watchCode, runCmd } from "./index.mjs";
import { mcpAdd, mcpApply } from "./mcp.mjs";
import { projectContextCheck, projectContextInventory } from "./project-context.mjs";
import { maybeRunPresetOnboarding, presetsCommand } from "./presets.mjs";
import { telemetryCommand, serveCommand } from "./telemetry.mjs";
import { enablePackage, disablePackage } from "./packages.mjs";
import { configCommand } from "./config.mjs";
import { experimentalCommand } from "./package-catalog.mjs";

const argv = await maybeRunPresetOnboarding(process.argv.slice(2));
const cliCatalog = JSON.parse(fs.readFileSync(path.join(repoRoot, "manifests", "platform", "cli-commands.json"), "utf8"));

// --------------------------------------------------------------------------- help

function usage() {
  console.log(`roborepo — harness config CLI\n\nusage:\n  ${cliCatalog.usage.join("\n  ")}`);
}

function usageError() {
  usage();
  process.exit(2);
}

// --------------------------------------------------------------------------- menu

async function interactiveMenu() {
  const choice = await selectMenu("roborepo — choose an action:", cliCatalog.menu);
  if (choice === null) {
    console.log("cancelled.");
    return;
  }
  // "run" from the menu has no command to run; guide the user instead of erroring.
  if (Array.isArray(choice) && choice.length === 1 && choice[0] === "run") {
    console.log("usage: roborepo run <cmd> [args...]");
    return;
  }
  if (Array.isArray(choice) && choice.length === 2 && choice[0] === "mcp" && choice[1] === "add") {
    console.log("usage: roborepo mcp add <name-or-url> [--scope=user|local|project] [--name=<name>]");
    return;
  }
  if (Array.isArray(choice) && choice.length === 2 && choice[0] === "skill" && choice[1] === "adopt") {
    console.log("usage: roborepo skill adopt <name>");
    return;
  }
  if (Array.isArray(choice) && choice.length === 2 && choice[0] === "skill" && choice[1] === "inspect") {
    console.log("usage: roborepo skill inspect <name>");
    return;
  }
  await dispatch(choice);
}

// --------------------------------------------------------------------------- dispatch

async function dispatch(args) {
  const [cat, sub, ...rest] = args;
  const flags = new Set(rest);

  switch (cat) {
    case undefined:
      return interactiveMenu();

    case "-h":
    case "--help":
      return usage();

    case "skill":
      if (sub === "export-to-project") return skillExport(new Set(rest), `skill ${sub}`);
      if (sub === "new") return skillNew(rest);
      if (sub === "adopt") return skillAdopt(rest);
      if (sub === "link-project") {
        return skillLink(flags, `skill ${sub}`);
      }
      if (sub === "sync-global") {
        if (rest.length > 0) {
          console.error(`unknown flag for "skill ${sub}": ${rest.join(" ")}`);
          return usageError();
        }
        return runRepoCommand(cliCatalog.repoScripts["skill sync-global"], rest);
      }
      if (sub === "render-commands") return runRepoCommand(cliCatalog.repoScripts["skill render-commands"], rest);
      if (sub === "audit") return skillAudit(rest);
      if (sub === "inspect") return skillInspect(rest);
      if (sub === "native") return skillNative(rest);
      console.error(`unknown: roborepo skill ${sub ?? ""}`.trim());
      return usageError();

    case "index":
      if (sub === "code") return indexCode(rest);
      if (sub === "docs") return indexDocs(rest);
      console.error(`unknown: roborepo index ${sub ?? ""}`.trim());
      return usageError();

    case "mcp":
      if (sub === "add") return mcpAdd(rest);
      if (sub === "apply") return mcpApply({ dryRun: rest.includes("--dry-run") });
      console.error(`unknown: roborepo mcp ${sub ?? ""}`.trim());
      return usageError();

    case "project-context":
      if (sub === "inventory") return projectContextInventory(rest);
      if (sub === "check") return projectContextCheck(rest);
      console.error(`unknown: roborepo project-context ${sub ?? ""}`.trim());
      return usageError();

    case "onboard":
      return presetsCommand(["onboard", ...rest]);

    // First-install welcome page + 4-option menu. Invoked by scripts/install/main.sh after core
    // install, never by users directly (deliberately absent from usage/menu). One menu option calls
    // `onboard`; onboarding is no longer auto-run by install.
    case "onboard-intro":
      return presetsCommand(["intro", ...rest]);

    // Alias of `serve --detach`: starts the portal in the background and opens it in the browser.
    case "web":
      return serveCommand(["--detach", ...[sub, ...rest].filter(Boolean)], { allowPortFallback: true });

    // `bundle` / `presets` are internal install-time verbs (run by scripts/install/main.sh), not
    // user-facing — deliberately absent from usage/menu in cli-commands.json. Kept dispatchable so
    // install and back-compat callers still work. Users manage the platform via update/uninstall and
    // features via enable/disable.
    case "bundle":
      return presetsCommand(sub === undefined ? ["bundle"] : ["bundle", sub, ...rest]);

    case "presets":
      return presetsCommand(sub === undefined ? [] : [sub, ...rest]);

    case "telemetry":
      return telemetryCommand(sub === undefined ? [] : [sub, ...rest]);

    case "serve":
      return serveCommand([sub, ...rest].filter(Boolean));

    case "enable":
      return enablePackage(sub === undefined ? rest : [sub, ...rest]);

    case "disable":
      return disablePackage(sub === undefined ? rest : [sub, ...rest]);

    case "config":
      return configCommand(sub === undefined ? [] : [sub, ...rest]);

    case "experimental":
      return experimentalCommand(sub === undefined ? [] : [sub, ...rest]);

    case "watch":
      if (sub === "code") return watchCode(rest);
      console.error(`unknown: roborepo watch ${sub ?? ""}`.trim());
      return usageError();

    case "run":
      return runCmd(sub === undefined ? [] : [sub, ...rest]);

    // Lifecycle verbs -> existing bash scripts. The first install always happens via the shell
    // bootstrap (scripts/install/main.sh) — that's how roborepo lands on PATH — so the CLI
    // only ever re-applies: `update` re-runs that same script to pick up new config.
    case "update": {
      const { runUpdateWithReport } = await import("./update-report.mjs");
      return runUpdateWithReport(cliCatalog.repoScripts.update, [sub, ...rest].filter(Boolean));
    }
    case "repair":
      return runRepoCommand(cliCatalog.repoScripts.repair, [sub, ...rest].filter(Boolean));
    case "uninstall":
      return runRepoCommand(cliCatalog.repoScripts.uninstall, [sub, ...rest].filter(Boolean));
    case "doctor":
      return runRepoCommand(cliCatalog.repoScripts.doctor, [sub, ...rest].filter(Boolean));
    case "verify":
      return runRepoCommand(cliCatalog.repoScripts.verify, [sub, ...rest].filter(Boolean));
    case "rules":
      if (sub === "render") {
        const { renderHomeRules } = await import("./rules-render.mjs");
        return renderHomeRules({ dryRun: flags.has("--dry-run") });
      }
      if (sub === "check-home") {
        const { checkHomeRules } = await import("./rules-render.mjs");
        process.exit(checkHomeRules() ? 0 : 1);
      }
      return runRepoCommand(cliCatalog.repoScripts.rules, [sub, ...rest].filter(Boolean));
    case "permissions":
      return runRepoCommand(cliCatalog.repoScripts.permissions, [sub, ...rest].filter(Boolean));

    default:
      console.error(`unknown command: ${args.join(" ")}`);
      usage();
      process.exit(2);
  }
}

dispatch(argv).catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

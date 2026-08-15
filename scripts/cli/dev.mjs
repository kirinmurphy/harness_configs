// Development-checkout-only tooling. Everything here operates on `local/`, which package.json's
// `files` never publishes — so in an npm install the scripts these commands drive do not exist.
//
// WHY A GATE IS STILL NEEDED: manifests/ DOES ship. The command definitions for `roborepo dev *`
// therefore reach an npm user even though local/ does not, and without a check they would fail with
// a bare `missing script:` path error. requireDevelopmentCheckout() turns that into a clear
// statement of why the command is unavailable.
//
// NOT THE SAME AS `kind: "internal"`. That flag is about VISIBILITY — internal commands are hidden
// from menus and help but still run fine on end-user machines (`setup`, `bundle`, `onboard-intro`
// are all install-time commands that must). This module is about AVAILABILITY: these commands
// cannot work off a dev checkout at all. Orthogonal axes; easy to conflate.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot, requireDevelopmentCheckout } from "./paths.mjs";
import { serveCommand, webStopCommand } from "./telemetry.mjs";

const FIXTURE_SCRIPT = path.join("local", "dev-fixtures", "localhoster-test-data.mjs");
const FIXTURE_ACTIONS = new Set(["start", "stop", "status"]);

// The fixture runs as a child process rather than an import: it is a standalone script under
// local/ with its own CLI contract, and shelling out keeps that contract the single entrypoint
// whether a human or this orchestrator invokes it.
function runFixture(action) {
  requireDevelopmentCheckout(FIXTURE_SCRIPT);
  const script = path.join(repoRoot, FIXTURE_SCRIPT);
  if (!fs.existsSync(script)) {
    console.error(`missing dev fixture script: ${script}`);
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [script, action], { stdio: "inherit" });
  if (result.error) {
    console.error(`failed to run the dev fixture: ${result.error.message}`);
    process.exit(1);
  }
  return result.status ?? 1;
}

export function devFixtureCommand(args) {
  const action = args[0] || "status";
  if (!FIXTURE_ACTIONS.has(action)) {
    console.error("usage: roborepo dev fixture <start|stop|status>");
    process.exit(2);
  }
  process.exit(runFixture(action));
}

// `dev start`/`dev stop` orchestrate the dev environment by calling the SAME commands a human
// would — the fixture script and `web`/`web stop`. There is deliberately no `dev portal` wrapper:
// `web --detach` now adopts a healthy portal instead of killing it, so a wrapper would add nothing
// but a second place for port logic to drift out of sync.
export async function devCommand(args) {
  requireDevelopmentCheckout("roborepo dev");
  const action = args[0] || "status";
  const rest = args.slice(1);

  if (action === "start") {
    runFixture("start");
    await serveCommand([...rest, "--detach", "--no-open"]);
    return;
  }
  if (action === "stop") {
    // Portal first: it is the process that holds a port, so stopping it before tearing down the
    // fixture avoids a window where the portal renders a stack that is already gone.
    webStopCommand(rest);
    runFixture("stop");
    return;
  }
  if (action === "status") {
    runFixture("status");
    return;
  }
  console.error("usage: roborepo dev <start|stop|status>");
  process.exit(2);
}

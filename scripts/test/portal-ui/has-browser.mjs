#!/usr/bin/env node
// Exit 0 if the Playwright Chromium browser is installed on this machine, 1 otherwise.
// Used by scripts/test/ci.sh to gate the portal UI suite (the same availability-gate pattern as
// `command -v docker` / `command -v pwsh` for the container and Windows installer suites).
//
// `chromium.executablePath()` resolves to the browser that Playwright will actually launch from
// the ms-playwright cache, so an existence check on it is the honest "can we run the suite" test —
// unlike, say, checking that the `playwright` npm package is present (it is: it's a devDependency).

import fs from "node:fs";
import { chromium } from "@playwright/test";

process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1);

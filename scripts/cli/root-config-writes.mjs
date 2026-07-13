import fs from "node:fs";
import path from "node:path";
import { checkDrift, recordWrite } from "./root-config-state.mjs";
import { rootConfigActive, rootConfigBaseline } from "./paths.mjs";

export function writeRootConfig(harness, filePath, content) {
  const shouldRecord = shouldRecordRootConfigWrite(harness, filePath);
  const nextContent = normalizeRootConfigContent(harness, content);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, nextContent);
  if (shouldRecord) recordRootConfigWriteIfActive(harness, filePath);
}

export function recordRootConfigWriteIfActive(harness, filePath) {
  const active = rootConfigActive[harness];
  if (!active) return;
  if (path.resolve(filePath) !== path.resolve(active)) return;
  recordWrite(harness, filePath);
}

function shouldRecordRootConfigWrite(harness, filePath) {
  const active = rootConfigActive[harness];
  if (!active || path.resolve(filePath) !== path.resolve(active)) return false;
  if (!fs.existsSync(filePath)) return true;

  const status = checkDrift(harness, filePath).status;
  if (status === "clean" || status === "missing") return true;
  if (status === "drifted") return false;

  try {
    return fs.readFileSync(filePath, "utf8") === fs.readFileSync(rootConfigBaseline[harness], "utf8");
  } catch {
    return false;
  }
}

function normalizeRootConfigContent(harness, content) {
  if (harness !== "claude") return content;
  try {
    const settings = JSON.parse(content || "{}");
    delete settings.model;
    return `${JSON.stringify(settings, null, 2)}\n`;
  } catch {
    return content;
  }
}

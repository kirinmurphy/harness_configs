import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { experimentalStatePath } from "./state-paths.mjs";

export const PACKAGES_PATH = path.join(repoRoot, "manifests", "inventory", "packages.json");
export const EXPERIMENTAL_PACKAGES_ENV = "LOAD_EXPERIMENTAL_PACKAGES";

const PENDING_STATUS = "pending";

function readExperimentalState() {
  try {
    return JSON.parse(fs.readFileSync(experimentalStatePath, "utf8"));
  } catch {
    return {};
  }
}

function writeExperimentalState(enabled) {
  fs.mkdirSync(path.dirname(experimentalStatePath), { recursive: true });
  fs.writeFileSync(experimentalStatePath, JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2) + "\n");
}

export function experimentalPackagesEnabled(env = process.env) {
  return env[EXPERIMENTAL_PACKAGES_ENV] === "true" || readExperimentalState().enabled === true;
}

export function experimentalCommand(args) {
  const [sub] = args;
  switch (sub) {
    case "enable":
      writeExperimentalState(true);
      console.log("experimental packages enabled");
      return;
    case "disable":
      writeExperimentalState(false);
      console.log("experimental packages disabled");
      return;
    case "status":
      console.log(experimentalPackagesEnabled() ? "enabled" : "disabled");
      return;
    default:
      console.error("usage: roborepo experimental enable|disable|status");
      process.exit(2);
  }
}

export function readPackageManifest() {
  return JSON.parse(fs.readFileSync(PACKAGES_PATH, "utf8"));
}

export function isPackageAvailable(pkg, env = process.env) {
  return pkg.status !== PENDING_STATUS || experimentalPackagesEnabled(env);
}

export function loadPackageCatalog({ includeUnavailable = false, env = process.env } = {}) {
  const packages = readPackageManifest().packages || [];
  return includeUnavailable ? packages : packages.filter((pkg) => isPackageAvailable(pkg, env));
}

export function findPackageInManifest(pkgId) {
  return (readPackageManifest().packages || []).find((pkg) => pkg.id === pkgId) || null;
}

export function unavailablePackageReason(pkg, env = process.env) {
  if (isPackageAvailable(pkg, env)) return null;
  if (pkg.status === PENDING_STATUS) {
    return "pending package: run `roborepo experimental enable` to expose it";
  }
  return `unavailable package status: ${pkg.status}`;
}

export function unavailablePackageMessage(pkgId, env = process.env) {
  const pkg = findPackageInManifest(pkgId);
  return pkg ? unavailablePackageReason(pkg, env) : `unknown package: ${pkgId}`;
}

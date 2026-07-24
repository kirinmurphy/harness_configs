import { pathToFileURL } from "node:url";
import { repoRoot } from "./paths.mjs";

export async function loadExport({ modulePath, exportName }) {
  const mod = await import(pathToFileURL(`${repoRoot}/${modulePath}`).href);
  if (typeof mod[exportName] !== "function") throw new Error(`missing export ${exportName} in ${modulePath}`);
  return mod[exportName];
}

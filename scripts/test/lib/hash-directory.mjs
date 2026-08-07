import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function hashDirectory(root) {
  const hash = crypto.createHash("sha256");
  const entries = [];
  walk(root, root, entries);
  entries.sort();
  for (const relPath of entries) {
    hash.update(relPath);
    hash.update(fs.readFileSync(path.join(root, relPath)));
  }
  return hash.digest("hex");
}

function walk(root, dir, entries) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, full, entries);
    } else if (entry.isFile()) {
      entries.push(path.relative(root, full));
    }
  }
}

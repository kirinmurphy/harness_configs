import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function hashDirectory(root) {
  const hash = crypto.createHash("sha256");
  const rootStat = fs.lstatSync(root);
  const entries = [{ type: "dir", relPath: ".", mode: rootStat.mode }];
  walk(root, root, entries);
  entries.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  for (const entry of entries) {
    updateField(hash, entry.type);
    updateField(hash, entry.relPath);
    updateField(hash, String(entry.mode));
    if (entry.type === "symlink") {
      updateField(hash, entry.target);
    } else if (entry.type === "file") {
      updateField(hash, entry.content);
    }
  }
  return hash.digest("hex");
}

function walk(root, dir, entries) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const relPath = path.relative(root, full);
    const stat = fs.lstatSync(full);
    if (stat.isDirectory()) {
      entries.push({ type: "dir", relPath, mode: stat.mode });
      walk(root, full, entries);
    } else if (stat.isSymbolicLink()) {
      entries.push({ type: "symlink", relPath, mode: stat.mode, target: fs.readlinkSync(full) });
    } else if (stat.isFile()) {
      entries.push({ type: "file", relPath, mode: stat.mode, content: fs.readFileSync(full) });
    }
  }
}

function updateField(hash, value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(buf.length);
  hash.update(length);
  hash.update(buf);
}

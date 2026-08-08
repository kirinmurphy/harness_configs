import fs from "node:fs";
import path from "node:path";

export function scanForString(root, needle) {
  const matches = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        let text;
        try {
          text = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        if (text.includes(needle)) matches.push(path.relative(root, full));
      }
    }
  }
  return matches;
}

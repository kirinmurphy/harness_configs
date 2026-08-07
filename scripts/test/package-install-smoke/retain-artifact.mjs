import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function retainArtifact({ repoRoot, outputDir, tarballPath, tarballName }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const destTarball = path.join(outputDir, tarballName);
  fs.copyFileSync(tarballPath, destTarball);

  const checksum = crypto.createHash("sha256").update(fs.readFileSync(destTarball)).digest("hex");
  fs.writeFileSync(path.join(outputDir, `${tarballName}.sha256`), `${checksum}  ${tarballName}\n`);

  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();

  const manifest = {
    name: pkg.name,
    version: pkg.version,
    sourceCommit: commit,
    tarball: tarballName,
    sha256: checksum,
    smokeCommands: ["version", "setup", "workspace status", "config apply", "doctor"],
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outputDir, "install-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`retained tarball: ${destTarball}`);
  console.log(`checksum: ${checksum}`);
  console.log(`source commit: ${commit}`);
  console.log("");
  console.log("Transfer to the new Mac, cd into the transferred directory, then:");
  console.log(`  shasum -a 256 -c ${tarballName}.sha256`);
  console.log(`  npm install -g ./${tarballName}`);
  console.log("Roll back with:");
  console.log(`  npm uninstall -g ${pkg.name}`);
}

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { packTarball } from "../package-install-smoke/tarball.mjs";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const packageName = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).name;

export function dockerSandboxConfig() {
  return {
    image: process.env.ROBOREPO_CLEAN_MACHINE_IMAGE || "node:22-bookworm-slim",
    probeTimeoutMs: Number(process.env.ROBOREPO_CLEAN_MACHINE_PROBE_TIMEOUT_MS || 5_000),
    strict: process.env.ROBOREPO_CLEAN_MACHINE_STRICT === "1",
    timeoutMs: Number(process.env.ROBOREPO_CLEAN_MACHINE_TIMEOUT_MS || 300_000),
    tmpRoot: process.env.ROBOREPO_CLEAN_MACHINE_TMPDIR || "/tmp",
  };
}

export function requireDockerOrSkip({ label, image, strict }) {
  const { probeTimeoutMs } = dockerSandboxConfig();
  const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
    timeout: probeTimeoutMs,
  });
  if (docker.status !== 0) {
    const message = `skip: ${label} (Docker daemon unavailable)`;
    if (strict) throw new Error(`${message}\n${docker.stderr || docker.stdout}`);
    console.log(message);
    return false;
  }

  const imageCheck = spawnSync("docker", ["image", "inspect", image], { encoding: "utf8", timeout: probeTimeoutMs });
  if (imageCheck.status !== 0 && !strict) {
    console.log(`skip: ${label} (${image} image not present; set ROBOREPO_CLEAN_MACHINE_STRICT=1 to pull/run)`);
    return false;
  }

  return true;
}

export async function withPackedPackage(callback) {
  const { tmpRoot } = dockerSandboxConfig();
  const sandbox = fs.mkdtempSync(path.join(tmpRoot, "roborepo-clean-machine-"));
  const packDest = path.join(sandbox, "pack");
  fs.mkdirSync(packDest, { recursive: true });

  try {
    const packed = packTarball(repoRoot, packDest);
    return await callback({ sandbox, packDest, ...packed });
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

export function runDockerScript({ label, packDest, script }) {
  const { image, timeoutMs } = dockerSandboxConfig();
  const args = ["run", "--rm", "--network=none", "-v", `${packDest}:/artifacts:ro`, image, "sh", "-lc", script];

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new assert.AssertionError({ message: `${label} failed (${error.name}: ${error.message})` }));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      const exit = timedOut ? `timeout after ${timeoutMs}ms` : signal ? `signal ${signal}` : `exit ${code}`;
      reject(new assert.AssertionError({ message: `${label} failed (${exit})\n${stdout}${stderr}` }));
    });
  });
}

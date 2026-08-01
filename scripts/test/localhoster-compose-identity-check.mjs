#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  discoverInstances,
} from "../../modules/localhoster/index.mjs";

// A Compose-labeled container with a published port, so `discoverInstances`'s Docker-corroboration
// path keeps the listener even though there's no lsof/HTTP-probe data behind it in these tests.
const composeContainer = ({ workingDir = null, project = "myapp" } = {}) => ({
  containerId: "abc123",
  name: "myapp-web-1",
  image: "myapp-web",
  state: "running",
  composeProject: project,
  composeService: "web",
  workingDir,
  publishedPorts: [{ hostPort: 15432, containerPort: 5432, protocol: "tcp" }],
});

// Minimal lsof output for a listener on the container's published host port, so the instance
// survives discovery's per-listener pass and Docker enrichment has something to attach to.
const lsofRecord = {
  pid: 999,
  command: "com.docker.backend",
  address: "*",
  port: 15432,
  bindScope: "wildcard",
};

const baseOptions = {
  platform: "darwin",
  probeHttp: null, // Docker corroboration alone is enough to keep the instance; no HTTP probing needed for these cases.
  collectGit: async (root) => ({ root, branch: "main", dirty: false, provider: { ok: true, reason: null } }),
  runGit: async () => ({ stdout: "" }),
  collectProcess: async () => new Map(),
  discoverListenerRecords: undefined, // not an option of discoverInstances; left out intentionally
};

// discoverInstances doesn't take `discoverListenerRecords` as an override — it always calls the
// real one, driven by `runCommand`. Fixture-match on the lsof-style args it issues so the listener
// on port 15432 resolves without a real `lsof` binary.
async function runCommand(command, args) {
  if (command === "lsof" && args.includes("-iTCP")) {
    return { stdout: `p999\nc${lsofRecord.command}\nn*:${lsofRecord.port}` };
  }
  if (command === "lsof") {
    return { stdout: "" }; // per-pid cwd lookup — no cwd, so identity falls back to process-level
  }
  throw new Error(`unexpected runCommand invocation: ${command} ${args.join(" ")}`);
}

// Case 1: no manual repoPath, working_dir resolves to a real repo (identityKind "git"/"path") ->
// resolvedFrom "auto".
{
  const result = await discoverInstances({
    ...baseOptions,
    runCommand,
    discoverDocker: async () => ({ warnings: [], containers: [composeContainer({ workingDir: "/repo/myapp" })] }),
    resolveIdentity: (cwd) => {
      if (cwd === "/repo/myapp") {
        return { identity: "git:github.com/x/myapp", identityKind: "git", confidence: "high", projectRoot: "/repo/myapp", evidence: "Git remote" };
      }
      return { identity: `process:${cwd}:unknown`, identityKind: "process", confidence: "low", projectRoot: null, evidence: "process working directory" };
    },
    settings: { composeProjects: {} },
  });
  const entry = result.composeProjectGit.get("myapp");
  assert.equal(entry?.resolvedFrom, "auto");
  assert.equal(entry?.repositoryId, "git:github.com/x/myapp");
}

// Case 2: manual repoPath set AND working_dir present -> resolvedFrom "manual", and the
// working_dir path is never even attempted.
{
  const result = await discoverInstances({
    ...baseOptions,
    runCommand,
    discoverDocker: async () => ({ warnings: [], containers: [composeContainer({ workingDir: "/should/not/be/used" })] }),
    resolveIdentity: (cwd) => {
      if (cwd === "/should/not/be/used") throw new Error("working_dir must not be resolved when a manual repoPath is set");
      if (cwd === "/repo/myapp-manual") {
        return { identity: "git:github.com/x/myapp-manual", identityKind: "git", confidence: "high", projectRoot: "/repo/myapp-manual", evidence: "Git remote" };
      }
      return { identity: `process:${cwd}:unknown`, identityKind: "process", confidence: "low", projectRoot: null, evidence: "process working directory" };
    },
    settings: { composeProjects: { myapp: { repoPath: "/repo/myapp-manual" } } },
  });
  const entry = result.composeProjectGit.get("myapp");
  assert.equal(entry?.resolvedFrom, "manual");
  assert.equal(entry?.repositoryId, "git:github.com/x/myapp-manual");
}

// Case 3: working_dir resolves to identityKind "process" (no .git found anywhere in its
// ancestry) -> composeProjectGit has no entry for this project at all, since resolveProjectIdentity
// never fails outright and "process" is its safe no-repo-found fallback, not a real resolution.
{
  const result = await discoverInstances({
    ...baseOptions,
    runCommand,
    discoverDocker: async () => ({ warnings: [], containers: [composeContainer({ workingDir: "/tmp/not-a-repo" })] }),
    resolveIdentity: (cwd) => ({ identity: `process:${cwd}:unknown`, identityKind: "process", confidence: "low", projectRoot: null, evidence: "process working directory" }),
    settings: { composeProjects: {} },
  });
  assert.equal(result.composeProjectGit.has("myapp"), false);
}

console.log("ok: localhoster compose project identity resolution");
